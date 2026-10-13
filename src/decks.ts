import { db, type Deck } from './db'

/**
 * Library structure lives in deck names, so it survives export to Anki:
 *   "<Tab>::TOPIK <level>::<deck>[::<sub-deck>…]"
 * e.g. "Grammar::TOPIK 2::Evita" or "Vocabulary::TOPIK 2::SKKU Level 2::01과".
 * Decks that don't follow it are "not sorted yet".
 */
export const TABS = ['Vocabulary', 'Grammar', 'Listening', 'Speaking'] as const
export type Tab = (typeof TABS)[number]
export const LEVELS = [1, 2, 3, 4, 5, 6] as const

export const TAB_INFO: Record<Tab, string> = {
  Vocabulary: 'Words in context: read the sentence and recall the meaning.',
  Grammar: 'Grammar patterns in example sentences.',
  Listening: 'Hear it first, then check what it said.',
  Speaking: 'Say the sentence out loud, then type the missing word to check yourself.',
}

export interface ParsedDeckName {
  tab: Tab
  level: number
  /** Path below the level, e.g. ["SKKU Level 2", "01과"]; empty for container decks. */
  path: string[]
}

export function parseDeckName(name: string): ParsedDeckName | null {
  const parts = name.split('::')
  const tab = TABS.find((t) => t === parts[0])
  if (!tab) return null
  const m = parts[1]?.match(/^TOPIK ([1-6])$/)
  if (!m) return null
  return { tab, level: Number(m[1]), path: parts.slice(2) }
}

/** Tab and level decks ("Grammar", "Grammar::TOPIK 2") only group other decks. */
export function isContainer(name: string) {
  if ((TABS as readonly string[]).includes(name)) return true
  const p = parseDeckName(name)
  return !!p && p.path.length === 0
}

/** Deck is placed in a tab (container or not). */
export const isSorted = (name: string) => isContainer(name) || !!parseDeckName(name)

export const deckName = (tab: Tab, level: number, ...path: string[]) =>
  [tab, `TOPIK ${level}`, ...path].join('::')

/** A deck plus every sub-deck under it (Anki "Parent::Child" names). */
export function withDescendants(all: Deck[], root: Deck): Deck[] {
  return all.filter((d) => d.id === root.id || d.name.startsWith(`${root.name}::`))
}

export interface DeckNode {
  deck: Deck
  depth: number
  label: string
  hasChildren: boolean
}

/** Compare part by part, so "SKKU Level 2::01과" stays under "SKKU Level 2" and before "SKKU Level 2 문법". */
function byName(a: Deck, b: Deck) {
  const pa = a.name.split('::')
  const pb = b.name.split('::')
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const c = pa[i].localeCompare(pb[i], 'ko', { numeric: true })
    if (c) return c
  }
  return pa.length - pb.length
}

/** Flatten decks into display order with depth, parents before children. */
export function deckTree(all: Deck[], baseDepth = 0): DeckNode[] {
  const sorted = [...all].sort(byName)
  return sorted.map((deck) => {
    const parts = deck.name.split('::')
    return {
      deck,
      depth: parts.length - 1 - baseDepth,
      label: parts[parts.length - 1],
      hasChildren: sorted.some((d) => d.name.startsWith(`${deck.name}::`)),
    }
  })
}

/** Deterministic id, so two devices creating the same deck agree and sync never duplicates it. */
export const deckIdFor = (name: string) => `deck:${name}`

/** Find a deck by name or create it (with its parents). Returns the deck id. */
export async function ensureDeck(name: string, newPerDay = 15): Promise<string> {
  const parts = name.split('::')
  let id = ''
  for (let i = 1; i <= parts.length; i++) {
    const n = parts.slice(0, i).join('::')
    const existing = await db.decks.where('name').equals(n).first()
    if (existing) {
      id = existing.id
      continue
    }
    const now = Date.now()
    id = deckIdFor(n)
    await db.decks.put({ id, name: n, newPerDay, createdAt: now, updatedAt: now })
  }
  return id
}

/** Rename a deck and its sub-decks (used by "Move to"). */
export async function renameDeckTree(deck: Deck, newName: string) {
  const all = await db.decks.toArray()
  const tree = withDescendants(all, deck)
  const now = Date.now()
  await db.transaction('rw', db.decks, async () => {
    for (const d of tree) {
      const renamed = newName + d.name.slice(deck.name.length)
      await db.decks.update(d.id, { name: renamed, updatedAt: now })
    }
  })
  // Make sure the tab/level containers exist above it.
  const parent = newName.split('::').slice(0, -1).join('::')
  if (parent) await ensureDeck(parent)
}

/** Remove decks that hold no cards and have no sub-decks with cards. */
export async function removeEmptyDecks(keep: (d: Deck) => boolean = () => false) {
  const decks = await db.decks.toArray()
  const used = new Set((await db.cards.toArray()).map((c) => c.deckId))
  const empty = decks.filter((d) => !keep(d) && !withDescendants(decks, d).some((x) => used.has(x.id)))
  if (empty.length) await db.decks.bulkDelete(empty.map((d) => d.id))
  return empty.length
}
