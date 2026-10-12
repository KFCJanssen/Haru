import type { Deck } from './db'

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

/** Flatten decks into display order with depth, parents before children. */
export function deckTree(all: Deck[]): DeckNode[] {
  const sorted = [...all].sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  return sorted.map((deck) => {
    const parts = deck.name.split('::')
    return {
      deck,
      depth: parts.length - 1,
      label: parts[parts.length - 1],
      hasChildren: sorted.some((d) => d.name.startsWith(`${deck.name}::`)),
    }
  })
}
