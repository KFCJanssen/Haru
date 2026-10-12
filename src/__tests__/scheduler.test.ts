import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { Rating } from 'ts-fsrs'
import { db } from '../db'
import { ensureSeedData, STARTER_ROWS } from '../starter'
import { answerCard, buildQueue, dayKey, endOfStudyDay, formatInterval, pickNext, undoAnswer } from '../scheduler'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await ensureSeedData()
})

describe('study day', () => {
  it('rolls over at 04:00', () => {
    const at3 = new Date(2026, 9, 12, 3, 0).getTime()
    const at5 = new Date(2026, 9, 12, 5, 0).getTime()
    expect(dayKey(at3)).toBe('2026-10-11')
    expect(dayKey(at5)).toBe('2026-10-12')
    expect(new Date(endOfStudyDay(at5)).getHours()).toBe(4)
    expect(new Date(endOfStudyDay(at5)).getDate()).toBe(13)
  })
})

describe('queue', () => {
  it('seeds three cards per starter sentence', async () => {
    expect(await db.notes.count()).toBe(STARTER_ROWS.length)
    expect(await db.cards.count()).toBe(STARTER_ROWS.length * 3)
  })

  it('limits new cards per day and shows one card per sentence', async () => {
    const deck = (await db.decks.toArray())[0]
    const q = await buildQueue([deck.id])
    expect(q.newCount).toBe(15)
    expect(new Set(q.news.map((c) => c.noteId)).size).toBe(15)
    expect(q.news.every((c) => c.ord === 0)).toBe(true)
  })

  it('moves an answered new card into learning and holds back its siblings', async () => {
    const deck = (await db.decks.toArray())[0]
    let q = await buildQueue([deck.id])
    const card = pickNext(q, 0)!
    const res = await answerCard(card, Rating.Good, 4000)
    expect(res.after.state).not.toBe(0)
    q = await buildQueue([deck.id])
    expect(q.newCount).toBe(14)
    expect(q.news.some((c) => c.noteId === card.noteId)).toBe(false)
    expect(q.learnCount).toBe(1)

    await undoAnswer(res)
    q = await buildQueue([deck.id])
    expect(q.newCount).toBe(15)
    expect(await db.reviewLogs.count()).toBe(0)
  })

  it('Easy on a new card schedules it days ahead', async () => {
    const deck = (await db.decks.toArray())[0]
    const q = await buildQueue([deck.id])
    const res = await answerCard(q.news[0], Rating.Easy, 2000)
    expect(res.after.state).toBe(2)
    expect(res.after.due - Date.now()).toBeGreaterThan(24 * 3600_000)
  })
})

describe('formatInterval', () => {
  it('formats readable intervals', () => {
    expect(formatInterval(30_000)).toBe('<1m')
    expect(formatInterval(10 * 60_000)).toBe('10m')
    expect(formatInterval(3 * 86_400_000)).toBe('3d')
  })
})
