import { fsrs, Rating, State, type Card as FsrsCard, type Grade } from 'ts-fsrs'
import { db, getSetting, uid, type Card, type CardState, type Deck, type ReviewLog } from './db'

/** The study day rolls over at 04:00 local time, like Anki. */
export const DAY_START_HOUR = 4

export function dayKey(time: number = Date.now()): string {
  const d = new Date(time - DAY_START_HOUR * 3600_000)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Timestamp of the next day rollover after `time`. */
export function endOfStudyDay(time: number = Date.now()): number {
  const d = new Date(time - DAY_START_HOUR * 3600_000)
  d.setHours(DAY_START_HOUR, 0, 0, 0)
  d.setDate(d.getDate() + 1)
  return d.getTime()
}

export function toFsrs(c: Card): FsrsCard {
  return {
    due: new Date(c.due),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: 0,
    scheduled_days: c.scheduledDays,
    learning_steps: c.learningSteps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as unknown as State,
    last_review: c.lastReview ? new Date(c.lastReview) : undefined,
  }
}

export function fromFsrs(base: Card, f: FsrsCard, now: number): Card {
  return {
    ...base,
    due: f.due.getTime(),
    stability: f.stability,
    difficulty: f.difficulty,
    scheduledDays: f.scheduled_days,
    learningSteps: f.learning_steps,
    reps: f.reps,
    lapses: f.lapses,
    state: f.state as unknown as CardState,
    lastReview: f.last_review ? f.last_review.getTime() : now,
    updatedAt: now,
  }
}

export function newCardFields(now: number) {
  return {
    suspended: false,
    due: now,
    stability: 0,
    difficulty: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    state: 0 as CardState,
    lastReview: null,
    createdAt: now,
    updatedAt: now,
  }
}

export async function getScheduler() {
  const retention = await getSetting('desiredRetention', 0.9)
  const weights = await getSetting<number[] | null>('fsrsWeights', null)
  return fsrs({
    request_retention: retention,
    enable_fuzz: true,
    ...(weights ? { w: weights } : {}),
  })
}

/** Preview the next due interval for each of the four answers. */
export function previewIntervals(scheduler: ReturnType<typeof fsrs>, card: Card, now = Date.now()) {
  const preview = scheduler.repeat(toFsrs(card), new Date(now))
  const out: Record<number, number> = {}
  for (const r of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) {
    out[r] = preview[r as Grade].card.due.getTime() - now
  }
  return out
}

export function formatInterval(ms: number): string {
  const min = ms / 60_000
  if (min < 1) return '<1m'
  if (min < 60) return `${Math.round(min)}m`
  const h = min / 60
  if (h < 24) return `${Math.round(h)}h`
  const d = h / 24
  if (d < 30) return `${Math.round(d)}d`
  const mo = d / 30.4
  if (mo < 12) return `${mo.toFixed(mo < 10 ? 1 : 0).replace('.0', '')}mo`
  return `${(d / 365).toFixed(1).replace('.0', '')}y`
}

export interface AnswerResult {
  before: Card
  after: Card
  logId: string
}

/** Grade a card, save the new memory state and a review log entry. */
export async function answerCard(card: Card, rating: Grade, durationMs: number, now = Date.now()): Promise<AnswerResult> {
  const scheduler = await getScheduler()
  const result = scheduler.next(toFsrs(card), new Date(now), rating)
  const after = fromFsrs(card, result.card, now)
  const log: ReviewLog = {
    id: uid(),
    cardId: card.id,
    noteId: card.noteId,
    deckId: card.deckId,
    rating,
    prevState: card.state,
    reviewedAt: now,
    day: dayKey(now),
    durationMs: Math.min(durationMs, 120_000),
    scheduledDays: after.scheduledDays,
    stability: after.stability,
    difficulty: after.difficulty,
  }
  await db.transaction('rw', db.cards, db.reviewLogs, async () => {
    await db.cards.put(after)
    await db.reviewLogs.add(log)
  })
  return { before: card, after, logId: log.id }
}

export async function undoAnswer(res: AnswerResult) {
  await db.transaction('rw', db.cards, db.reviewLogs, async () => {
    await db.cards.put({ ...res.before, updatedAt: Date.now() })
    await db.reviewLogs.delete(res.logId)
  })
}

export interface QueueCounts {
  newCount: number
  learnCount: number
  reviewCount: number
}

export interface DeckQueue extends QueueCounts {
  /** Learning cards due right now, earliest first. */
  learnNow: Card[]
  /** Review cards due today. */
  reviews: Card[]
  /** New cards allowed today, in introduction order. */
  news: Card[]
  /** Earliest learning card due later today, if any. */
  nextLearnAt: number | null
}

export interface QueueData {
  /** Cards to consider (at least those in the decks asked for). */
  cards: Card[]
  logsToday: ReviewLog[]
  decks: Map<string, Deck>
  /** Notes using a Haru note type. */
  haruNotes: Set<string>
  /** First (Read) card of each Haru note, wherever it lives. */
  firstCards: Map<string, Card>
}

export async function buildQueue(deckIds: string[], now = Date.now()): Promise<DeckQueue> {
  const [cards, logsToday, decks] = await Promise.all([
    db.cards.where('deckId').anyOf(deckIds).toArray(),
    db.reviewLogs.where('day').equals(dayKey(now)).toArray(),
    db.decks.bulkGet(deckIds),
  ])
  const later = [...new Set(cards.filter((c) => c.ord > 0 && c.state === 0).map((c) => c.noteId))]
  const notes = later.length ? await db.notes.bulkGet(later) : []
  const haruNotes = new Set(notes.filter((n) => n?.noteTypeId.startsWith('haru-')).map((n) => n!.id))
  const firstCards = new Map<string, Card>()
  if (haruNotes.size) {
    const firsts = await db.cards.where('noteId').anyOf([...haruNotes]).filter((c) => c.ord === 0).toArray()
    for (const c of firsts) firstCards.set(c.noteId, c)
  }
  const deckMap = new Map(decks.filter((d): d is Deck => !!d).map((d) => [d.id, d]))
  return computeQueue(deckIds, { cards, logsToday, decks: deckMap, haruNotes, firstCards }, now)
}

/** Everything needed to count every deck at once (Today screen), in a few reads. */
export async function loadQueueData(now = Date.now()): Promise<QueueData> {
  const [cards, logsToday, decks, notes] = await Promise.all([
    db.cards.toArray(),
    db.reviewLogs.where('day').equals(dayKey(now)).toArray(),
    db.decks.toArray(),
    db.notes.toArray(),
  ])
  const haruNotes = new Set(notes.filter((n) => n.noteTypeId.startsWith('haru-')).map((n) => n.id))
  const firstCards = new Map<string, Card>()
  for (const c of cards) if (c.ord === 0 && haruNotes.has(c.noteId)) firstCards.set(c.noteId, c)
  return { cards, logsToday, decks: new Map(decks.map((d) => [d.id, d])), haruNotes, firstCards }
}

/**
 * Build today's queue for a deck (or several).
 * Siblings (other cards of the same note) are held back for the day once one of them
 * has been studied today, so you never see the same sentence three ways in a row.
 */
export function computeQueue(deckIds: string[], data: QueueData, now = Date.now()): DeckQueue {
  const end = endOfStudyDay(now)
  const inDecks = new Set(deckIds)
  // A deck and its parents within this study session: like Anki, the limit of every deck
  // you're studying through applies, so "Study TOPIK 2" doesn't add up every lesson's limit.
  const idByName = new Map<string, string>()
  for (const id of deckIds) {
    const d = data.decks.get(id)
    if (d) idByName.set(d.name, id)
  }
  const chains = new Map<string, string[]>()
  const chain = (deckId: string) => {
    let out = chains.get(deckId)
    if (out) return out
    out = []
    const parts = data.decks.get(deckId)?.name.split('::') ?? []
    for (let i = parts.length; i > 0; i--) {
      const id = idByName.get(parts.slice(0, i).join('::'))
      if (id) out.push(id)
    }
    chains.set(deckId, out)
    return out
  }

  const touchedNotes = new Set<string>()
  const touchedCards = new Set<string>()
  const countedNew = new Set<string>()
  const newIntroducedByDeck = new Map<string, number>()
  for (const l of data.logsToday) {
    // Siblings are held back across all decks (e.g. Vocabulary and Listening cards of one sentence).
    touchedNotes.add(l.noteId)
    touchedCards.add(l.cardId)
    if (!inDecks.has(l.deckId)) continue
    if (l.prevState === 0 && !countedNew.has(l.cardId)) {
      countedNew.add(l.cardId)
      for (const id of chain(l.deckId)) newIntroducedByDeck.set(id, (newIntroducedByDeck.get(id) ?? 0) + 1)
    }
  }
  const siblingBlocked = (c: Card) => touchedNotes.has(c.noteId) && !touchedCards.has(c.id)

  // Haru sentences: the Listen and Produce cards of a sentence only start once its Read card
  // was learned on an earlier day, so new sentences are always met in writing first.
  const startToday = end - 86400_000
  const waitsForRead = (c: Card) => {
    if (c.ord === 0 || !data.haruNotes.has(c.noteId)) return false
    const first = data.firstCards.get(c.noteId)
    return !first || first.state === 0 || (first.lastReview ?? now) >= startToday
  }

  const learnNow: Card[] = []
  const learnLater: Card[] = []
  const reviews: Card[] = []
  const newPool: Card[] = []
  for (const c of data.cards) {
    if (!inDecks.has(c.deckId) || c.suspended) continue
    if (c.state === 1 || c.state === 3) {
      if (c.due <= now) learnNow.push(c)
      else if (c.due < end) learnLater.push(c)
    } else if (c.state === 2) {
      if (c.due < end && !siblingBlocked(c)) reviews.push(c)
    } else if (!siblingBlocked(c) && !waitsForRead(c)) {
      newPool.push(c)
    }
  }
  learnNow.sort((a, b) => a.due - b.due)
  reviews.sort((a, b) => a.due - b.due)
  newPool.sort((a, b) => a.newOrder - b.newOrder)

  // Per-deck new limits; also only one new card per note per day.
  const news: Card[] = []
  const left = new Map<string, number>()
  for (const id of deckIds) {
    const d = data.decks.get(id)
    if (d) left.set(d.id, Math.max(0, d.newPerDay - (newIntroducedByDeck.get(d.id) ?? 0)))
  }
  const notesUsed = new Set<string>()
  for (const c of newPool) {
    const ids = chain(c.deckId)
    if (notesUsed.has(c.noteId) || !ids.length || ids.some((id) => (left.get(id) ?? 0) <= 0)) continue
    news.push(c)
    notesUsed.add(c.noteId)
    for (const id of ids) left.set(id, left.get(id)! - 1)
  }

  learnLater.sort((a, b) => a.due - b.due)
  return {
    learnNow,
    reviews,
    news,
    nextLearnAt: learnLater[0]?.due ?? null,
    newCount: news.length,
    learnCount: learnNow.length + learnLater.length,
    reviewCount: reviews.length,
  }
}

/**
 * Pick the next card: due learning cards first, then reviews with a new card
 * mixed in after every four reviews.
 */
export function pickNext(q: DeckQueue, studiedThisSession: number): Card | null {
  if (q.learnNow.length) return q.learnNow[0]
  const wantNew = q.news.length > 0 && (q.reviews.length === 0 || studiedThisSession % 5 === 4)
  if (wantNew) return q.news[0]
  if (q.reviews.length) return q.reviews[0]
  return null
}

export const RATINGS: { rating: Grade; label: string; key: string }[] = [
  { rating: Rating.Again, label: 'Again', key: '1' },
  { rating: Rating.Hard, label: 'Hard', key: '2' },
  { rating: Rating.Good, label: 'Good', key: '3' },
  { rating: Rating.Easy, label: 'Easy', key: '4' },
]
