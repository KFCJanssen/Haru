import 'fake-indexeddb/auto'
import { existsSync, readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { Rating } from 'ts-fsrs'
import { db } from '../db'
import { importApkg } from '../anki/importer'
import { ensureSeedData } from '../starter'
import { organizeLibrary, previewOrganize, grammarLevel, evitaLevel } from '../organize'
import { isSorted, parseDeckName, withDescendants } from '../decks'
import { answerCard, buildQueue } from '../scheduler'

const DECKS = process.env.HARU_DECKS ?? ''
const have = (n: string) => !!DECKS && existsSync(`${DECKS}/${n}`)

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('rules', () => {
  it('maps grammar patterns and Evita tags to levels', () => {
    expect(grammarLevel('집에 가고 싶어요. –고 싶다 : desire')).toBe(1)
    expect(grammarLevel('–(으)ㄹ 리가 없다 : there is no possibility that')).toBe(4)
    expect(evitaLevel(['dif1'])).toBe(1)
    expect(evitaLevel(['dif4'])).toBe(2)
    expect(evitaLevel(['dif6'])).toBe(3)
    expect(evitaLevel(['dif7'])).toBe(4)
  })
  it('parses tab/level deck names', () => {
    expect(parseDeckName('Grammar::TOPIK 2::Evita sentences')).toEqual({ tab: 'Grammar', level: 2, path: ['Evita sentences'] })
    expect(parseDeckName('Korean Grammar Cheat Sheet')).toBeNull()
  })
})

describe('starter deck', () => {
  it('splits Read/Listen/Produce into Vocabulary/Listening/Speaking and keeps progress', async () => {
    await ensureSeedData()
    const q = await buildQueue(['starter-topik2'])
    const res = await answerCard(q.news[0], Rating.Good, 1000)
    const r = await organizeLibrary()
    expect(r.moved).toBe(90)
    const names = (await db.decks.toArray()).map((d) => d.name)
    expect(names).toContain('Vocabulary::TOPIK 3::Starter sentences')
    expect(names).toContain('Listening::TOPIK 3::Starter sentences')
    expect(names).toContain('Speaking::TOPIK 3::Starter sentences')
    expect(names).not.toContain('Starter: TOPIK II sentences')
    const moved = (await db.cards.get(res.after.id))!
    expect(moved.state).toBe(res.after.state)
    expect(moved.reps).toBe(1)
    // Running again changes nothing
    expect((await organizeLibrary()).moved).toBe(0)
  })

  it('introduces Listen and Produce cards only after the Read card', async () => {
    await ensureSeedData()
    await organizeLibrary()
    const listen = (await db.decks.toArray()).filter((d) => d.name.startsWith('Listening::')).map((d) => d.id)
    expect((await buildQueue(listen)).newCount).toBe(0)
  })
})

describe.runIf(have('Korean_Grammar_Sentences_by_Evita.apkg'))('real decks', () => {
  it('sorts Evita, Cheat Sheet and Sounds into tabs and levels', async () => {
    for (const f of ['Korean_Grammar_Sentences_by_Evita.apkg', 'Korean_Cheat_Sheet_Grammar.apkg', 'The_Sounds_of_Korean_A_Pronunciation_Guide.apkg']) {
      await importApkg(readFileSync(`${DECKS}/${f}`), { keepScheduling: true })
    }
    const p = await previewOrganize()
    expect(p.unknown).toEqual([])
    await organizeLibrary()
    const decks = await db.decks.toArray()
    const count = async (name: string) => db.cards.where('deckId').equals(decks.find((d) => d.name === name)!.id).count()
    expect(await count('Grammar::TOPIK 1::Evita sentences')).toBe(155 + 360)
    expect(await count('Grammar::TOPIK 4::Evita sentences')).toBe(146)
    expect(await count('Listening::TOPIK 1::The Sounds of Korean::Vowels')).toBeGreaterThan(0)
    expect(decks.every((d) => isSorted(d.name))).toBe(true)
    expect(await db.cards.count()).toBe(2454 + 240 + 655)
  }, 400_000)
})

describe.runIf(existsSync('test-fixtures/skku-clean.apkg'))('cleaned SKKU deck', () => {
  it('lands in tabs and levels with the built-in sentence note type', async () => {
    await importApkg(readFileSync('test-fixtures/skku-clean.apkg'), { keepScheduling: false })
    const decks = await db.decks.toArray()
    const cards = await db.cards.toArray()
    const byDeck = new Map(decks.map((d) => [d.id, d.name]))
    const count = (prefix: string) => cards.filter((c) => byDeck.get(c.deckId)!.startsWith(prefix)).length
    expect(cards.length).toBe(801 * 3)
    expect(count('Vocabulary::TOPIK 2::SKKU Level 2::')).toBe(718)
    expect(count('Listening::TOPIK 2::SKKU Level 2::')).toBe(718)
    expect(count('Speaking::TOPIK 2::SKKU Level 2::')).toBe(718)
    expect(count('Grammar::')).toBe(83 * 2)
    expect(count('Listening::TOPIK 1::SKKU Level 2 문법')).toBe(49)
    expect(decks.every((d) => isSorted(d.name))).toBe(true)
    const notes = await db.notes.toArray()
    expect(new Set(notes.map((n) => n.noteTypeId))).toEqual(new Set(['haru-sentence-v1']))
    expect((await previewOrganize()).unknown).toEqual([])

    // Studying a level uses the level's own new-card limit, not the sum of every lesson's.
    const level = decks.find((d) => d.name === 'Vocabulary::TOPIK 2')!
    const q = await buildQueue(withDescendants(decks, level).map((d) => d.id))
    expect(q.newCount).toBe(level.newPerDay)
    const lesson = decks.find((d) => d.name === 'Vocabulary::TOPIK 2::SKKU Level 2::01과')!
    expect((await buildQueue([lesson.id])).newCount).toBe(Math.min(lesson.newPerDay, 55))
  })
})

describe('deck tree order', () => {
  it('keeps sub-decks under their parent', async () => {
    const { deckTree } = await import('../decks')
    const mk = (name: string) => ({ id: name, name, newPerDay: 15, createdAt: 0, updatedAt: 0 })
    const names = deckTree([mk('L::TOPIK 2::SKKU Level 2 문법'), mk('L::TOPIK 2::SKKU Level 2::10과'), mk('L::TOPIK 2::SKKU Level 2'), mk('L::TOPIK 2::SKKU Level 2::02과')], 2).map((n) => n.label)
    expect(names).toEqual(['SKKU Level 2', '02과', '10과', 'SKKU Level 2 문법'])
  })
})
