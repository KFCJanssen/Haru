import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Card } from '../db'
import { stripHtml } from '../template'
import { formatInterval } from '../scheduler'

const STATE_LABEL = ['new', 'learning', 'review', 'relearning']

function cardSummary(cards: Card[]) {
  if (cards.every((c) => c.suspended)) return 'suspended'
  const active = cards.filter((c) => !c.suspended)
  if (active.every((c) => c.state === 0)) return 'new'
  const next = Math.min(...active.filter((c) => c.state !== 0).map((c) => c.due))
  const d = next - Date.now()
  return d <= 0 ? 'due now' : `next in ${formatInterval(d)}`
}

export default function Browse() {
  const [q, setQ] = useState('')
  const [deckId, setDeckId] = useState('all')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const decks = useLiveQuery(() => db.decks.orderBy('name').toArray(), [])
  const notes = useLiveQuery(() => db.notes.toArray(), [])
  const cards = useLiveQuery(() => db.cards.toArray(), [])

  const byNote = useMemo(() => {
    const m = new Map<string, Card[]>()
    for (const c of cards ?? []) m.set(c.noteId, [...(m.get(c.noteId) ?? []), c])
    return m
  }, [cards])
  const deckName = useMemo(() => new Map((decks ?? []).map((d) => [d.id, d.name])), [decks])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (notes ?? [])
      .filter((n) => deckId === 'all' || n.deckId === deckId)
      .filter((n) => !needle || Object.values(n.fields).some((v) => stripHtml(v).toLowerCase().includes(needle)) || n.tags.some((t) => t.toLowerCase().includes(needle)))
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [notes, q, deckId])

  async function toggleSuspend(noteId: string, suspend: boolean) {
    const now = Date.now()
    await db.cards.where('noteId').equals(noteId).modify({ suspended: suspend, updatedAt: now })
  }
  async function remove(noteId: string) {
    await db.transaction('rw', db.notes, db.cards, async () => {
      await db.cards.where('noteId').equals(noteId).delete()
      await db.notes.delete(noteId)
    })
    setConfirmDelete(null)
  }

  if (!notes || !cards || !decks) return null
  const shown = rows.slice(0, 300)

  return (
    <section className="browse">
      <h1>Browse</h1>
      <div className="filters">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Korean, English or tags" aria-label="Search" />
        <select value={deckId} onChange={(e) => setDeckId(e.target.value)} aria-label="Deck">
          <option value="all">All decks</option>
          {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      <p className="muted">{rows.length} sentence{rows.length === 1 ? '' : 's'}{rows.length > shown.length ? `, showing the newest ${shown.length}` : ''}</p>
      <ul className="notes">
        {shown.map((n) => {
          const cs = byNote.get(n.id) ?? []
          const suspended = cs.length > 0 && cs.every((c) => c.suspended)
          const first = Object.values(n.fields)[0] ?? ''
          return (
            <li key={n.id} className={suspended ? 'is-suspended' : ''}>
              <div className="note-text">
                <span className="ko" lang="ko" dangerouslySetInnerHTML={{ __html: first.replace(/<(?!\/?b>)[^>]*>/g, '') }} />
                <span className="note-meta">
                  {n.fields.Target ? <span className="ko" lang="ko">{n.fields.Target}</span> : null}
                  {n.fields.Meaning ? <span>{stripHtml(n.fields.Meaning)}</span> : null}
                  <span>{deckName.get(n.deckId)}</span>
                  <span title={cs.map((c) => STATE_LABEL[c.state]).join(', ')}>{cs.length ? cardSummary(cs) : 'no cards'}</span>
                </span>
              </div>
              <div className="note-actions">
                <button type="button" className="link" onClick={() => toggleSuspend(n.id, !suspended)}>
                  {suspended ? 'Unsuspend' : 'Suspend'}
                </button>
                {confirmDelete === n.id ? (
                  <>
                    <button type="button" className="link danger" onClick={() => remove(n.id)}>Delete for good</button>
                    <button type="button" className="link" onClick={() => setConfirmDelete(null)}>Keep</button>
                  </>
                ) : (
                  <button type="button" className="link" onClick={() => setConfirmDelete(n.id)}>Delete</button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
