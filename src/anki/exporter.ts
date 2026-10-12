import JSZip from 'jszip'
import { db, type Card, type Deck, type NoteType } from '../db'
import { stripHtml } from '../template'
import { getSql } from './sqlite'
import { mediaRefs } from './importer'

/* Anki collection schema v11 ("Legacy 1"), which every Anki version can import. */
const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null,
  dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null,
  dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null,
  tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null,
  usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null,
  factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null,
  odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null,
  lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`

const DCONF = {
  1: {
    autoplay: true, id: 1, lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 }, maxTaken: 60, mod: 0,
    name: 'Default', new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20, separate: true },
    replayq: true, rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 200 }, timer: 0, usn: 0,
  },
}

/** Stable positive integer from a string (for Anki's numeric ids). */
function hashId(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return 1_500_000_000_000 + (h >>> 0)
}

function noteTypeAnkiId(nt: NoteType): number {
  const m = nt.id.match(/^anki-(\d+)$/)
  return m ? Number(m[1]) : hashId(nt.id)
}

/** Haru-only template features rewritten into plain Anki syntax. */
function toAnkiTemplate(fmt: string): string {
  return fmt.replace(/\{\{blank:Sentence\}\}/g, '{{type:Target}}')
}

async function checksum(text: string): Promise<number> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text)))
  return parseInt(Array.from(hash.slice(0, 4), (b) => b.toString(16).padStart(2, '0')).join(''), 16)
}

function deckDescendants(all: Deck[], root: Deck): Deck[] {
  return all.filter((d) => d.id === root.id || d.name.startsWith(`${root.name}::`))
}

export async function exportDeck(deckId: string, opts: { includeScheduling: boolean }): Promise<Uint8Array> {
  const allDecks = await db.decks.toArray()
  const root = allDecks.find((d) => d.id === deckId)
  if (!root) throw new Error('Deck not found')
  const decks = deckDescendants(allDecks, root)
  const deckIds = decks.map((d) => d.id)
  const cards = await db.cards.where('deckId').anyOf(deckIds).toArray()
  const notes = await db.notes.bulkGet([...new Set(cards.map((c) => c.noteId))])
  const noteTypes = (await db.noteTypes.toArray()).filter((nt) => notes.some((n) => n?.noteTypeId === nt.id))

  const now = Date.now()
  const nowSec = Math.floor(now / 1000)
  const crt = Math.floor(now / 86400_000) * 86400 - 86400 * 365 // a year back keeps due numbers positive
  const today = Math.floor((nowSec - crt) / 86400)

  const ankiDeckId = new Map(decks.map((d, i) => [d.id, i === 0 ? hashId(d.id) : hashId(d.id)]))
  const decksJson: Record<string, unknown> = {
    1: { collapsed: false, conf: 1, desc: '', dyn: 0, extendNew: 10, extendRev: 50, id: 1, lrnToday: [0, 0], mod: nowSec,
      name: 'Default', newToday: [0, 0], revToday: [0, 0], timeToday: [0, 0], usn: 0 },
  }
  for (const d of decks) {
    const id = ankiDeckId.get(d.id)!
    decksJson[id] = { collapsed: false, conf: 1, desc: 'Exported from Haru', dyn: 0, extendNew: 0, extendRev: 50, id,
      lrnToday: [0, 0], mod: nowSec, name: d.name, newToday: [0, 0], revToday: [0, 0], timeToday: [0, 0], usn: -1 }
  }

  const modelsJson: Record<string, unknown> = {}
  for (const nt of noteTypes) {
    const id = noteTypeAnkiId(nt)
    const templates = nt.templates.map((t, ord) => ({
      name: t.name, ord, qfmt: toAnkiTemplate(t.qfmt), afmt: toAnkiTemplate(t.afmt), bqfmt: '', bafmt: '', bfont: '', bsize: 0, did: null,
    }))
    modelsJson[id] = {
      css: nt.css || '.card { font-family: sans-serif; font-size: 24px; text-align: center; }\nb { text-decoration: underline; }',
      did: ankiDeckId.get(root.id), flds: nt.fields.map((name, ord) => ({ name, ord, font: 'Arial', media: [], rtl: false, size: 20, sticky: false })),
      id: String(id), latexPost: '\\end{document}', latexPre: '\\documentclass[12pt]{article}\n\\begin{document}\n', latexsvg: false,
      mod: nowSec, name: nt.name,
      req: templates.map((t, i) => [i, 'any', nt.fields.map((f, fi) => (t.qfmt.includes(f) ? fi : -1)).filter((x) => x >= 0)]),
      sortf: 0, tags: [], tmpls: templates, type: nt.kind === 'cloze' ? 1 : 0, usn: -1, vers: [],
    }
  }

  const SQL = await getSql()
  const out = new SQL.Database()
  try {
    out.exec(SCHEMA)
    out.run('INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, ?)', [
      crt, now, now,
      JSON.stringify({ activeDecks: [1], addToCur: true, collapseTime: 1200, curDeck: 1, curModel: String(noteTypes[0] ? noteTypeAnkiId(noteTypes[0]) : 1),
        dueCounts: true, estTimes: true, newBury: true, newSpread: 0, nextPos: 1, sortBackwards: false, sortType: 'noteFld', timeLim: 0 }),
      JSON.stringify(modelsJson), JSON.stringify(decksJson), JSON.stringify(DCONF), '{}',
    ])

    const ntById = new Map(noteTypes.map((nt) => [nt.id, nt]))
    const ankiNoteId = new Map<string, number>()
    let idSeq = now
    for (const n of notes) {
      if (!n) continue
      const nt = ntById.get(n.noteTypeId)!
      const values = nt.fields.map((f) => n.fields[f] ?? '')
      const first = stripHtml(values[0] ?? '')
      const id = idSeq++
      ankiNoteId.set(n.id, id)
      out.run('INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, \'\')', [
        id, n.guid ?? n.id, noteTypeAnkiId(nt), nowSec, n.tags.length ? ` ${n.tags.join(' ')} ` : '', values.join('\x1f'), first, await checksum(first),
      ])
    }

    const sorted = [...cards].sort((a, b) => a.newOrder - b.newOrder)
    sorted.forEach((c: Card, i) => {
      const nid = ankiNoteId.get(c.noteId)
      if (nid === undefined) return
      let type = 0, queue = 0, due = i + 1, ivl = 0
      if (opts.includeScheduling && c.state !== 0) {
        type = 2
        queue = 2
        ivl = Math.max(1, Math.round(c.scheduledDays))
        due = Math.max(today, Math.floor((c.due / 1000 - crt) / 86400))
      }
      if (c.suspended) queue = -1
      out.run('INSERT INTO cards VALUES (?, ?, ?, ?, ?, -1, ?, ?, ?, ?, 2500, ?, ?, 0, 0, 0, 0, \'\')', [
        idSeq++, nid, ankiDeckId.get(c.deckId)!, c.ord, nowSec, type, queue, due, ivl,
        opts.includeScheduling ? c.reps : 0, opts.includeScheduling ? c.lapses : 0,
      ])
    })

    const zip = new JSZip()
    zip.file('collection.anki2', out.export())

    // Media used by the exported notes
    const names = new Set<string>()
    for (const n of notes) if (n) for (const v of Object.values(n.fields)) for (const r of mediaRefs(v)) names.add(r)
    const mediaMap: Record<string, string> = {}
    let i = 0
    for (const name of names) {
      const file = await db.media.get(name)
      if (!file) continue
      zip.file(String(i), new Uint8Array(await file.blob.arrayBuffer()))
      mediaMap[String(i)] = name
      i++
    }
    zip.file('media', JSON.stringify(mediaMap))
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  } finally {
    out.close()
  }
}
