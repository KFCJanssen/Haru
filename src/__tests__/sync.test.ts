import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, setSetting } from '../db'
import { flushOutbox, installChangeTracking, remoteWrite, enqueueEverything } from '../sync'
import { ensureSeedData } from '../starter'

beforeEach(async () => {
  await db.delete()
  await db.open()
  installChangeTracking()
})

describe('change tracking', () => {
  it('records local writes in the outbox', async () => {
    await db.decks.add({ id: 'd1', name: 'Test', newPerDay: 10, createdAt: 1, updatedAt: 1 })
    await db.decks.update('d1', { newPerDay: 5 })
    await db.transaction('rw', db.cards, db.reviewLogs, async () => {
      await db.reviewLogs.add({ id: 'r1', cardId: 'c', noteId: 'n', deckId: 'd1', rating: 3, prevState: 0, reviewedAt: 1, day: 'x', durationMs: 1, scheduledDays: 1, stability: 1, difficulty: 5 })
    })
    await db.decks.delete('d1')
    await flushOutbox()
    const keys = (await db.outbox.toArray()).map((e) => e.key).sort()
    expect(keys).toEqual(['decks:d1', 'reviewLogs:r1'])
  })

  it('ignores writes that came from the server', async () => {
    await remoteWrite(['decks'], async () => {
      await db.decks.put({ id: 'd2', name: 'Remote', newPerDay: 10, createdAt: 1, updatedAt: 1 })
    })
    await flushOutbox()
    expect(await db.outbox.count()).toBe(0)
  })

  it('only syncs whitelisted settings', async () => {
    await setSetting('desiredRetention', 0.92)
    await setSetting('ttsVoice', 'x')
    await flushOutbox()
    expect((await db.outbox.toArray()).map((e) => e.key)).toEqual(['settings:desiredRetention'])
  })

  it('tracks bulk imports and can queue everything', async () => {
    await ensureSeedData()
    await flushOutbox()
    expect(await db.outbox.count()).toBeGreaterThanOrEqual(1 + 30 + 90)
    await db.outbox.clear()
    await enqueueEverything()
    expect(await db.outbox.where('tbl').equals('cards').count()).toBe(90)
  })
})
