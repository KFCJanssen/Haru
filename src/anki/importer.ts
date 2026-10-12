import JSZip from 'jszip'
import { decompress } from 'fzstd'
import type { Database } from 'sql.js'
import { db, uid, type Card, type CardState, type Deck, type Note, type NoteType } from '../db'
import { newCardFields } from '../scheduler'
import { getSql } from './sqlite'
import { decodeMessage, pbInt, pbMessages, pbString } from './protobuf'

/* ------------------------------------------------------------------ */
/* Parsing: .apkg bytes → plain objects                                */
/* ------------------------------------------------------------------ */

export type PackageFormat = 'legacy1' | 'legacy2' | 'latest'

export interface AnkiNoteType {
  id: number
  name: string
  kind: 'normal' | 'cloze'
  fields: string[]
  templates: { name: string; qfmt: string; afmt: string }[]
  css: string
}
export interface AnkiNote { id: number; guid: string; mid: number; fields: string[]; tags: string[] }
export interface AnkiCard {
  id: number; nid: number; did: number; ord: number
  type: number; queue: number; due: number; ivl: number; factor: number; reps: number; lapses: number
}
export interface ParsedPackage {
  format: PackageFormat
  crt: number
  noteTypes: AnkiNoteType[]
  decks: Map<number, string>
  notes: AnkiNote[]
  cards: AnkiCard[]
  /** Media file name → name of the entry inside the zip. */
  media: Map<string, string>
  zip: JSZip
}

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]
const isZstd = (b: Uint8Array) => ZSTD_MAGIC.every((m, i) => b[i] === m)
const maybeZstd = (b: Uint8Array) => (isZstd(b) ? decompress(b) : b)

function rows<T>(dbh: Database, sql: string): T[] {
  const res = dbh.exec(sql)
  if (!res.length) return []
  const { columns, values } = res[0]
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])) as T)
}

function hasTable(dbh: Database, name: string) {
  return rows<{ n: number }>(dbh, `select count(*) as n from sqlite_master where type='table' and name='${name}'`)[0]?.n > 0
}

function readNoteTypes(dbh: Database): AnkiNoteType[] {
  const modern = hasTable(dbh, 'notetypes') && rows<{ n: number }>(dbh, 'select count(*) as n from notetypes')[0].n > 0
  if (!modern) {
    const { models } = rows<{ models: string }>(dbh, 'select models from col')[0]
    return Object.values(JSON.parse(models || '{}') as Record<string, {
      id: number | string; name: string; type: number; css: string
      flds: { name: string; ord: number }[]; tmpls: { name: string; ord: number; qfmt: string; afmt: string }[]
    }>).map((m) => ({
      id: Number(m.id),
      name: m.name,
      kind: m.type === 1 ? 'cloze' : 'normal',
      css: m.css ?? '',
      fields: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name),
      templates: [...m.tmpls].sort((a, b) => a.ord - b.ord).map((t) => ({ name: t.name, qfmt: t.qfmt, afmt: t.afmt })),
    }))
  }
  const fields = rows<{ ntid: number; ord: number; name: string }>(dbh, 'select ntid, ord, name from fields order by ntid, ord')
  const templates = rows<{ ntid: number; ord: number; name: string; config: Uint8Array }>(
    dbh, 'select ntid, ord, name, config from templates order by ntid, ord')
  return rows<{ id: number; name: string; config: Uint8Array }>(dbh, 'select id, name, config from notetypes').map((nt) => {
    const cfg = decodeMessage(nt.config)
    return {
      id: nt.id,
      name: nt.name,
      kind: pbInt(cfg, 1) === 1 ? 'cloze' : 'normal',
      css: pbString(cfg, 3),
      fields: fields.filter((f) => f.ntid === nt.id).map((f) => f.name),
      templates: templates.filter((t) => t.ntid === nt.id).map((t) => {
        const tc = decodeMessage(t.config)
        return { name: t.name, qfmt: pbString(tc, 1), afmt: pbString(tc, 2) }
      }),
    }
  })
}

function readDecks(dbh: Database): Map<number, string> {
  const out = new Map<number, string>()
  const modern = hasTable(dbh, 'decks') && rows<{ n: number }>(dbh, 'select count(*) as n from decks')[0].n > 0
  if (modern) {
    for (const d of rows<{ id: number; name: string }>(dbh, 'select id, name from decks')) out.set(d.id, d.name.split('\x1f').join('::'))
  } else {
    const { decks } = rows<{ decks: string }>(dbh, 'select decks from col')[0]
    for (const d of Object.values(JSON.parse(decks || '{}') as Record<string, { id: number; name: string }>)) out.set(Number(d.id), d.name)
  }
  return out
}

async function readMediaMap(zip: JSZip): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const file = zip.file('media')
  if (!file) return out
  const raw = maybeZstd(await file.async('uint8array'))
  // Legacy: JSON {"0": "name.mp3"}. Latest: protobuf MediaEntries.
  const text = new TextDecoder().decode(raw)
  if (text.trimStart().startsWith('{')) {
    for (const [k, v] of Object.entries(JSON.parse(text) as Record<string, string>)) out.set(v, k)
  } else {
    pbMessages(decodeMessage(raw), 1).forEach((entry, i) => {
      const legacyName = entry.get(255)?.[0]
      out.set(pbString(entry, 1), String(typeof legacyName === 'number' ? legacyName : i))
    })
  }
  return out
}

export async function parseApkg(data: ArrayBuffer | Uint8Array): Promise<ParsedPackage> {
  const zip = await JSZip.loadAsync(data)
  let format: PackageFormat
  let dbBytes: Uint8Array
  if (zip.file('collection.anki21b')) {
    format = 'latest'
    dbBytes = decompress(await zip.file('collection.anki21b')!.async('uint8array'))
  } else if (zip.file('collection.anki21')) {
    format = 'legacy2'
    dbBytes = await zip.file('collection.anki21')!.async('uint8array')
  } else if (zip.file('collection.anki2')) {
    format = 'legacy1'
    dbBytes = await zip.file('collection.anki2')!.async('uint8array')
  } else {
    throw new Error('This file has no Anki collection inside. Is it an .apkg deck?')
  }

  const SQL = await getSql()
  let dbh = new SQL.Database(dbBytes)
  if (format === 'latest') {
    // Modern Anki uses a custom 'unicase' collation that plain SQLite lacks; strip it from the schema.
    dbh.exec("PRAGMA writable_schema=ON; UPDATE sqlite_master SET sql = replace(sql, 'COLLATE unicase', '') WHERE sql LIKE '%unicase%'; PRAGMA writable_schema=OFF;")
    const patched = dbh.export()
    dbh.close()
    dbh = new SQL.Database(patched)
  }
  try {
    const crt = rows<{ crt: number }>(dbh, 'select crt from col')[0]?.crt ?? 0
    const noteTypes = readNoteTypes(dbh)
    const decks = readDecks(dbh)
    const notes = rows<{ id: number; guid: string; mid: number; flds: string; tags: string }>(
      dbh, 'select id, guid, mid, flds, tags from notes',
    ).map((n) => ({ id: n.id, guid: n.guid, mid: n.mid, fields: n.flds.split('\x1f'), tags: n.tags.split(' ').filter(Boolean) }))
    const cards = rows<AnkiCard>(dbh,
      'select id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses from cards order by due, ord')
    const media = await readMediaMap(zip)
    if (format === 'latest' && notes.length === 1 && notes[0].fields[0]?.includes('Please update')) {
      throw new Error('This deck file is a placeholder. Re-export it from Anki.')
    }
    return { format, crt, noteTypes, decks, notes, cards, media, zip }
  } finally {
    dbh.close()
  }
}

/* ------------------------------------------------------------------ */
/* Saving: plain objects → Haru database                               */
/* ------------------------------------------------------------------ */

export interface ImportOptions {
  /** Keep review intervals from the file (otherwise every card starts as new). */
  keepScheduling: boolean
  onProgress?: (message: string) => void
}

export interface ImportResult {
  decks: string[]
  notesAdded: number
  notesUpdated: number
  cardsAdded: number
  mediaAdded: number
  mediaMissing: number
}

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', opus: 'audio/ogg',
  webm: 'audio/webm', flac: 'audio/flac', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', mp4: 'video/mp4',
}
const mimeFor = (name: string) => MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'

/** Media names a note refers to. */
export function mediaRefs(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\[sound:([^\]]+)\]/g)) out.push(m[1])
  for (const m of text.matchAll(/<img[^>]+src=["']?([^"' >]+)/gi)) if (!/^(https?:|data:)/i.test(m[1])) out.push(decodeURIComponent(m[1]))
  return out
}

function convertScheduling(c: AnkiCard, crt: number, now: number): Partial<Card> {
  if (c.queue === -1) return { suspended: true }
  // type 2 = review; type 1/3 = (re)learning. Anki stores review due as days since collection creation.
  if (c.type === 2 && c.ivl > 0) {
    const dueMs = (crt + c.due * 86400) * 1000
    return {
      state: 2 as CardState,
      due: dueMs,
      scheduledDays: c.ivl,
      stability: Math.max(1, c.ivl),
      difficulty: Math.min(10, Math.max(1, 11 - (c.factor || 2500) / 300)),
      reps: c.reps,
      lapses: c.lapses,
      lastReview: dueMs - c.ivl * 86400_000,
    }
  }
  if (c.type === 1 || c.type === 3) {
    return { state: 2 as CardState, due: now, scheduledDays: 1, stability: 1, difficulty: 6, reps: c.reps, lapses: c.lapses, lastReview: now - 86400_000 }
  }
  return {}
}

export async function saveParsed(pkg: ParsedPackage, opts: ImportOptions): Promise<ImportResult> {
  const now = Date.now()
  const say = opts.onProgress ?? (() => {})
  const result: ImportResult = { decks: [], notesAdded: 0, notesUpdated: 0, cardsAdded: 0, mediaAdded: 0, mediaMissing: 0 }

  // Note types
  const ntById = new Map<number, NoteType>()
  for (const nt of pkg.noteTypes) {
    const id = `anki-${nt.id}`
    const existing = await db.noteTypes.get(id)
    const rec: NoteType = {
      id, name: nt.name, fields: nt.fields, templates: nt.templates, css: nt.css, kind: nt.kind,
      origin: 'anki', updatedAt: existing ? now : now,
    }
    await db.noteTypes.put(rec)
    ntById.set(nt.id, rec)
  }

  // Decks: only those that hold cards, plus their parents.
  const usedDeckIds = new Set(pkg.cards.map((c) => c.did))
  const deckNames = new Set<string>()
  for (const did of usedDeckIds) {
    const name = pkg.decks.get(did) ?? 'Imported'
    const parts = name.split('::')
    for (let i = 1; i <= parts.length; i++) deckNames.add(parts.slice(0, i).join('::'))
  }
  const existingDecks = await db.decks.toArray()
  const deckByName = new Map(existingDecks.map((d) => [d.name, d]))
  for (const name of [...deckNames].sort()) {
    if (!deckByName.has(name)) {
      const d: Deck = { id: uid(), name, newPerDay: 15, createdAt: now, updatedAt: now }
      await db.decks.add(d)
      deckByName.set(name, d)
    }
  }
  const haruDeckFor = (did: number) => deckByName.get(pkg.decks.get(did) ?? 'Imported')!.id
  result.decks = [...deckNames].sort()

  // Notes (matched by guid so re-importing updates instead of duplicating)
  say(`Saving ${pkg.notes.length} notes…`)
  const firstCardDeck = new Map<number, number>()
  for (const c of pkg.cards) if (!firstCardDeck.has(c.nid)) firstCardDeck.set(c.nid, c.did)

  const guidList = pkg.notes.map((n) => n.guid)
  const existingNotes = await db.notes.where('guid').anyOf(guidList).toArray()
  const noteByGuid = new Map(existingNotes.map((n) => [n.guid!, n]))
  // Notes exported from Haru use the Haru note id as their guid.
  for (const n of await db.notes.bulkGet(guidList)) if (n && !noteByGuid.has(n.id)) noteByGuid.set(n.id, n)
  const haruNoteId = new Map<number, string>()
  const newNotes: Note[] = []
  const updatedNotes: Note[] = []
  for (const n of pkg.notes) {
    const nt = ntById.get(n.mid)
    if (!nt) continue
    const fields = Object.fromEntries(nt.fields.map((f, i) => [f, n.fields[i] ?? '']))
    const existing = noteByGuid.get(n.guid)
    if (existing) {
      updatedNotes.push({ ...existing, noteTypeId: nt.id, fields, tags: n.tags, updatedAt: now })
      haruNoteId.set(n.id, existing.id)
    } else {
      const deckId = haruDeckFor(firstCardDeck.get(n.id) ?? -1)
      const note: Note = { id: uid(), noteTypeId: nt.id, deckId, fields, tags: n.tags, guid: n.guid, createdAt: now, updatedAt: now }
      newNotes.push(note)
      haruNoteId.set(n.id, note.id)
    }
  }
  await db.notes.bulkPut([...newNotes, ...updatedNotes])
  result.notesAdded = newNotes.length
  result.notesUpdated = updatedNotes.length

  // Cards
  say('Saving cards…')
  const existingCards = await db.cards.where('noteId').anyOf(updatedNotes.map((n) => n.id)).toArray()
  const haveCard = new Set(existingCards.map((c) => `${c.noteId}:${c.ord}`))
  const orderBase = (await db.cards.toArray()).reduce((m, c) => Math.max(m, c.newOrder), -10) + 10
  const newCards: Card[] = []
  pkg.cards.forEach((c, i) => {
    const noteId = haruNoteId.get(c.nid)
    if (!noteId || haveCard.has(`${noteId}:${c.ord}`)) return
    const base: Card = {
      id: uid(), noteId, deckId: haruDeckFor(c.did), ord: c.ord, newOrder: orderBase + i, ...newCardFields(now),
    }
    const sched = opts.keepScheduling ? convertScheduling(c, pkg.crt, now) : c.queue === -1 ? { suspended: true } : {}
    newCards.push({ ...base, ...sched })
  })
  await db.cards.bulkAdd(newCards)
  result.cardsAdded = newCards.length

  // Media: only files the notes actually use, skipping ones already stored.
  const wanted = new Set<string>()
  for (const n of pkg.notes) for (const f of n.fields) for (const r of mediaRefs(f)) wanted.add(r)
  for (const nt of pkg.noteTypes) for (const t of nt.templates) for (const r of mediaRefs(t.qfmt + t.afmt)) wanted.add(r)
  const have = new Set((await db.media.toCollection().primaryKeys()) as string[])
  const todo = [...wanted].filter((name) => !have.has(name))
  let batch: { name: string; blob: Blob; updatedAt: number }[] = []
  for (let i = 0; i < todo.length; i++) {
    const name = todo[i]
    const entry = pkg.media.get(name)
    const file = entry !== undefined ? pkg.zip.file(entry) : null
    if (!file) {
      result.mediaMissing++
      continue
    }
    const bytes = maybeZstd(await file.async('uint8array'))
    batch.push({ name, blob: new Blob([bytes as BlobPart], { type: mimeFor(name) }), updatedAt: now })
    if (batch.length >= 100) {
      await db.media.bulkPut(batch)
      result.mediaAdded += batch.length
      batch = []
      say(`Saving audio and images… ${i + 1} of ${todo.length}`)
    }
  }
  if (batch.length) {
    await db.media.bulkPut(batch)
    result.mediaAdded += batch.length
  }
  return result
}

export async function importApkg(data: ArrayBuffer | Uint8Array, opts: ImportOptions): Promise<ImportResult> {
  opts.onProgress?.('Opening the deck file…')
  const pkg = await parseApkg(data)
  return saveParsed(pkg, opts)
}
