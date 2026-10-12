import Dexie, { type EntityTable } from 'dexie'

/** Card states, same numbering as FSRS / Anki: 0 new, 1 learning, 2 review, 3 relearning. */
export type CardState = 0 | 1 | 2 | 3

export interface Deck {
  id: string
  name: string
  /** New cards introduced per day. */
  newPerDay: number
  createdAt: number
  updatedAt: number
}

export interface Template {
  name: string
  /** Front (question) HTML, Anki template syntax. */
  qfmt: string
  /** Back (answer) HTML, Anki template syntax. */
  afmt: string
}

export interface NoteType {
  id: string
  name: string
  fields: string[]
  templates: Template[]
  css: string
  /** 'haru' for built-in types, 'anki' for imported ones. */
  origin: 'haru' | 'anki'
  /** Cloze note types make one card per {{c1::…}} number. */
  kind?: 'normal' | 'cloze'
  updatedAt: number
}

export interface Note {
  id: string
  noteTypeId: string
  deckId: string
  /** Field values keyed by field name. */
  fields: Record<string, string>
  tags: string[]
  /** Anki's global note id, used to update instead of duplicate on re-import. */
  guid?: string
  createdAt: number
  updatedAt: number
}

export interface Card {
  id: string
  noteId: string
  deckId: string
  /** Template index in the note type. */
  ord: number
  /** Order in which new cards are introduced (lower first). */
  newOrder: number
  suspended: boolean
  // FSRS memory state
  due: number
  stability: number
  difficulty: number
  scheduledDays: number
  learningSteps: number
  reps: number
  lapses: number
  state: CardState
  lastReview: number | null
  createdAt: number
  updatedAt: number
}

export interface ReviewLog {
  id: string
  cardId: string
  noteId: string
  deckId: string
  /** 1 Again, 2 Hard, 3 Good, 4 Easy */
  rating: number
  /** Card state before this answer. */
  prevState: CardState
  reviewedAt: number
  /** Study-day key (YYYY-MM-DD, day starts at 04:00). */
  day: string
  durationMs: number
  scheduledDays: number
  stability: number
  difficulty: number
}

export interface MediaFile {
  name: string
  blob: Blob
  updatedAt: number
}

export interface Setting {
  key: string
  value: unknown
}

export const db = new Dexie('haru') as Dexie & {
  decks: EntityTable<Deck, 'id'>
  noteTypes: EntityTable<NoteType, 'id'>
  notes: EntityTable<Note, 'id'>
  cards: EntityTable<Card, 'id'>
  reviewLogs: EntityTable<ReviewLog, 'id'>
  media: EntityTable<MediaFile, 'name'>
  settings: EntityTable<Setting, 'key'>
}

db.version(1).stores({
  decks: 'id, name',
  noteTypes: 'id, name',
  notes: 'id, noteTypeId, deckId, *tags, updatedAt',
  cards: 'id, noteId, deckId, [deckId+state], due, updatedAt',
  reviewLogs: 'id, cardId, noteId, deckId, day, reviewedAt',
  media: 'name',
  settings: 'key',
})

db.version(2).stores({
  notes: 'id, noteTypeId, deckId, *tags, updatedAt, guid',
})

export const uid = () => crypto.randomUUID()

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key)
  return row === undefined ? fallback : (row.value as T)
}

export async function setSetting(key: string, value: unknown) {
  await db.settings.put({ key, value })
}

/** Ask the browser not to evict our data when disk space runs low. */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist()
    }
  } catch {
    /* not supported */
  }
}
