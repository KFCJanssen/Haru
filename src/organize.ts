import { db, type Card, type Deck, type Note } from './db'
import { deckName, ensureDeck, isSorted, removeEmptyDecks, type Tab } from './decks'
import { stripHtml } from './template'
import { STARTER_LEVELS, STARTER_ROWS } from './starter'

/**
 * Sort the decks Kai already had into tabs and TOPIK levels.
 * Cards keep their ids and progress; only their deck changes. New deck ids come from
 * the deck name, so running this on two devices produces the same result.
 */

/* ----- TOPIK levels for grammar patterns (Korean Grammar Cheat Sheet) ----- */

/** Ordered from specific to general; first match wins. Matched against the card's Korean + pattern text. */
const GRAMMAR_RULES: [RegExp, number][] = [
  [/다가는/, 4],
  [/up doing another|려다가/, 3],
  [/(었|았)\/?(았)?겠네요|must have/, 3],
  [/겠네요|겠군요/, 3],
  [/군요/, 3],
  [/네요/, 2],
  [/고 말다|ended up/, 4],
  [/버리다|regret/, 3],
  [/어\/아 (오다|가다)|continuous action/, 3],
  [/어\/아 내다|very end/, 3],
  [/어\/아 나다/, 3],
  [/놓다|놓았|두었|for later|continuation of a certain/, 2],
  [/어\/아 드리다|어\/아 주다/, 1],
  [/어\/아 있다|state brought by/, 2],
  [/어\/아 하다|third person feeling/, 2],
  [/어\/아 ?지다|become\/begin/, 2],
  [/teamed with 오다 or 가다/, 1],
  [/려면/, 2],
  [/려고/, 2],
  [/도록/, 3],
  [/느라고/, 3],
  [/어\/아서/, 1],
  [/니까/, 1],
  [/지 않으면 안 되다/, 3],
  [/면 안 되다|should not/, 2],
  [/면 하다|좋겠다|wish\/hope/, 2],
  [/면 되다|all you have to do/, 2],
  [/if\/when/, 1],
  [/ㄹ ?수록|the more/, 3],
  [/어\/아야 할지/, 3],
  [/prerequisite|only if|empathic/, 3],
  [/어\/아야 되다|obligation or necessity/, 1],
  [/거든|imperative or propositive/, 3],
  [/\(으\)며|non sequential/, 3],
  [/든지/, 3],
  [/거나/, 2],
  [/자마자/, 3],
  [/다가/, 3],
  [/데도/, 3],
  [/동안/, 2],
  [/도중/, 3],
  [/중이다/, 2],
  [/면서/, 2],
  [/clause\/athough|으나/, 3],
  [/데요|ㄴ데|background|Adjective verb/, 2],
  [/지만/, 1],
  [/permission|어\/아도 되다/, 2],
  [/어\/아도/, 2],
  [/모양이다/, 3],
  [/[둣듯]하다/, 4],
  [/나 보다|가 보다/, 3],
  [/보이다/, 2],
  [/는 길/, 3],
  [/편이다/, 3],
  [/대로/, 3],
  [/척/, 3],
  [/바람에/, 3],
  [/뻔했다/, 3],
  [/리가 없다/, 4],
  [/것이다|the fact is/, 4],
  [/것 같다/, 2],
  [/적\/일|Usually \+ -어\/아 보다/, 2],
  [/후에/, 1],
  [/ㄹ 때/, 1],
  [/수 있다/, 1],
  [/줄 알다/, 2],
  [/do you know|speculative/, 2],
  [/s지|amount of time since/, 2],
  [/더라[구고]요/, 3],
  [/던/, 3],
  [/고 싶다/, 1],
  [/고 있다/, 1],
  [/거예요/, 1],
  [/까요/, 1],
  [/래요/, 1],
  [/게요|first person/, 1],
  [/지요|agreement|believing hearer|Suggesting|honorific suffix/, 2],
  [/어\/아 보다|try/, 1],
  [/–고 :|connect two/, 1],
]

export function grammarLevel(text: string): number | null {
  for (const [re, level] of GRAMMAR_RULES) if (re.test(text)) return level
  return null
}

/** Evita's difficulty tags (dif1–dif7) mapped to TOPIK levels. */
export function evitaLevel(tags: string[]): number {
  const d = Number(tags.find((t) => /^dif\d$/.test(t))?.slice(3) ?? 3)
  return d <= 2 ? 1 : d <= 4 ? 2 : d <= 6 ? 3 : 4
}

/** Haru sentence cards: Read → the note's main tab, Listen → Listening, Produce → Speaking. */
export function haruCardTab(main: Tab, ord: number): Tab {
  if (ord === 1) return 'Listening'
  if (ord === 2) return main === 'Grammar' ? 'Grammar' : 'Speaking'
  return main
}

/* ----- Planning ----- */

export interface Move {
  card: Card
  target: string
}

function plan(deck: Deck, cards: Card[], notes: Map<string, Note>): Move[] | null {
  const name = deck.name
  const moves: Move[] = []
  const note = (c: Card) => notes.get(c.noteId)

  if (name.startsWith('Korean Grammar Sentences by Evita')) {
    for (const c of cards) moves.push({ card: c, target: deckName('Grammar', evitaLevel(note(c)?.tags ?? []), 'Evita sentences') })
    return moves
  }
  if (name.startsWith('Korean Grammar Cheat Sheet')) {
    for (const c of cards) {
      const n = note(c)
      const text = n ? Object.values(n.fields).map(stripHtml).join(' ') : ''
      moves.push({ card: c, target: deckName('Grammar', grammarLevel(text) ?? 2, 'Grammar cheat sheet') })
    }
    return moves
  }
  if (name.startsWith('The Sounds of Korean')) {
    const sub = name.split('::').slice(1)
    for (const c of cards) moves.push({ card: c, target: deckName('Listening', 1, 'The Sounds of Korean', ...sub) })
    return moves
  }
  if (deck.id === 'starter-topik2' || name.startsWith('Starter: TOPIK II')) {
    for (const c of cards) {
      const sentence = note(c)?.fields.Sentence ?? ''
      const row = STARTER_ROWS.findIndex((r) => r[0] === sentence)
      const level = STARTER_LEVELS[row] ?? 3
      moves.push({ card: c, target: deckName(haruCardTab('Vocabulary', c.ord), level, 'Starter sentences') })
    }
    return moves
  }
  return null
}

export interface OrganizePreview {
  /** Decks that will be split, with where their cards go. */
  known: { deck: Deck; cards: number; targets: Record<string, number> }[]
  /** Decks without a rule; they stay under "Not sorted yet". */
  unknown: Deck[]
}

async function collect() {
  const decks = await db.decks.toArray()
  const cards = await db.cards.toArray()
  const notes = new Map((await db.notes.toArray()).map((n) => [n.id, n]))
  return { decks, cards, notes }
}

/** Only leaf decks hold cards; containers like "The Sounds of Korean" are handled through their children. */
export async function previewOrganize(): Promise<OrganizePreview> {
  const { decks, cards, notes } = await collect()
  const out: OrganizePreview = { known: [], unknown: [] }
  for (const d of decks) {
    if (isSorted(d.name)) continue
    const own = cards.filter((c) => c.deckId === d.id)
    if (!own.length) continue
    const moves = plan(d, own, notes)
    if (!moves) {
      out.unknown.push(d)
      continue
    }
    const targets: Record<string, number> = {}
    for (const m of moves) targets[m.target] = (targets[m.target] ?? 0) + 1
    out.known.push({ deck: d, cards: own.length, targets })
  }
  return out
}

export async function organizeLibrary(): Promise<{ moved: number; decksRemoved: number }> {
  const { decks, cards, notes } = await collect()
  const moves: Move[] = []
  for (const d of decks) {
    if (isSorted(d.name)) continue
    const own = cards.filter((c) => c.deckId === d.id)
    if (own.length) moves.push(...(plan(d, own, notes) ?? []))
  }
  if (!moves.length) return { moved: 0, decksRemoved: 0 }

  const sourceLimit = new Map(decks.map((d) => [d.id, d.newPerDay]))
  const idFor = new Map<string, string>()
  for (const target of new Set(moves.map((m) => m.target))) {
    const limit = sourceLimit.get(moves.find((m) => m.target === target)!.card.deckId) ?? 15
    idFor.set(target, await ensureDeck(target, limit))
  }

  const now = Date.now()
  const updatedCards = moves.map((m) => ({ ...m.card, deckId: idFor.get(m.target)!, updatedAt: now }))
  // A note lives with its first card (Read / the only card).
  const noteDeck = new Map<string, string>()
  for (const c of updatedCards) if (c.ord === 0 || !noteDeck.has(c.noteId)) noteDeck.set(c.noteId, c.deckId)
  const updatedNotes = [...noteDeck].map(([id, deckId]) => ({ ...notes.get(id)!, deckId, updatedAt: now })).filter((n) => n.id)

  await db.transaction('rw', db.cards, db.notes, async () => {
    await db.cards.bulkPut(updatedCards)
    await db.notes.bulkPut(updatedNotes)
  })
  const decksRemoved = await removeEmptyDecks((d) => isSorted(d.name))
  return { moved: updatedCards.length, decksRemoved }
}
