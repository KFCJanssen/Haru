import 'fake-indexeddb/auto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { importApkg, parseApkg } from '../anki/importer'
import { exportDeck } from '../anki/exporter'
import { renderTemplate } from '../template'
import { scopeCss } from '../anki/css'

// Real shared decks are not committed (licensing); tests use them when present locally.
const DECKS = process.env.HARU_DECKS ?? ''
const file = (name: string) => `${DECKS}/${name}`
const have = (name: string) => !!DECKS && existsSync(file(name))

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe.runIf(have('Korean_Grammar_Sentences_by_Evita.apkg'))('real decks', () => {
  it('imports Evita (legacy 1) with audio', async () => {
    const r = await importApkg(readFileSync(file('Korean_Grammar_Sentences_by_Evita.apkg')), { keepScheduling: true })
    expect(r.notesAdded).toBe(2454)
    expect(r.cardsAdded).toBe(2454)
    expect(r.mediaAdded).toBeGreaterThan(2000)
    expect(r.decks).toContain('Korean Grammar Sentences by Evita')
    const note = await db.notes.where('guid').notEqual('').first()
    expect(note?.fields.Korean).toBeTruthy()
    // Re-import updates instead of duplicating
    const again = await importApkg(readFileSync(file('Korean_Grammar_Sentences_by_Evita.apkg')), { keepScheduling: true })
    expect(again.notesAdded).toBe(0)
    expect(again.notesUpdated).toBe(2454)
    expect(again.cardsAdded).toBe(0)
    expect(await db.cards.count()).toBe(2454)
  }, 120_000)

  it('imports The Sounds of Korean (legacy 2) with subdecks and cloze', async () => {
    const r = await importApkg(readFileSync(file('The_Sounds_of_Korean_A_Pronunciation_Guide.apkg')), { keepScheduling: true })
    expect(r.cardsAdded).toBe(655)
    expect(r.decks).toEqual(expect.arrayContaining(['The Sounds of Korean', 'The Sounds of Korean::Vowels', 'The Sounds of Korean::Consonants']))
    const cloze = (await db.noteTypes.toArray()).find((n) => n.kind === 'cloze')!
    const note = (await db.notes.where('noteTypeId').equals(cloze.id).first())!
    const front = renderTemplate(cloze.templates[0].qfmt, note.fields, { side: 'front', ord: 0 })
    expect(front.html).toContain('class="cloze"')
    expect(front.sounds.length).toBe(1)
  }, 120_000)
})

describe.runIf(have('latest.apkg'))('latest format', () => {
  it('reads zstd + protobuf (anki21b)', async () => {
    const pkg = await parseApkg(readFileSync(file('latest.apkg')))
    expect(pkg.format).toBe('latest')
    expect(pkg.noteTypes.some((n) => n.kind === 'cloze')).toBe(true)
    expect(pkg.noteTypes.every((n) => n.templates.every((t) => t.qfmt.length > 0))).toBe(true)
    expect([...pkg.decks.values()]).toContain('The Sounds of Korean::Vowels')
    const r = await importApkg(readFileSync(file('latest.apkg')), { keepScheduling: true })
    expect(r.notesAdded).toBe(744)
    expect(r.mediaMissing).toBe(0)
  }, 120_000)
})

describe('export round trip', () => {
  it('exports a Haru deck as an .apkg Haru can read back', async () => {
    const { ensureSeedData } = await import('../starter')
    await ensureSeedData()
    const deck = (await db.decks.toArray())[0]
    const bytes = await exportDeck(deck.id, { includeScheduling: true })
    const pkg = await parseApkg(bytes)
    expect(pkg.format).toBe('legacy1')
    expect(pkg.notes.length).toBe(30)
    expect(pkg.cards.length).toBe(90)
    expect(pkg.noteTypes[0].fields).toContain('Sentence')
    if (DECKS) writeFileSync(file('haru-export.apkg'), bytes)
  })
})

describe('scopeCss', () => {
  it('scopes selectors and drops theme-breaking rules', () => {
    const out = scopeCss('html{overflow:scroll} .card{font-family:arial;color:black;text-align:center} .box{border:2px solid black;color:red} @media (x){.a{b:c}}')
    expect(out).toBe('.anki-scope { text-align:center }\n.anki-scope .box { border:2px solid black }')
  })
})
