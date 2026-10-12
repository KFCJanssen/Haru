import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Deck } from '../db'
import { buildQueue, dayKey, type QueueCounts } from '../scheduler'

function Counts({ c }: { c: QueueCounts }) {
  return (
    <span className="counts" aria-label={`${c.newCount} new, ${c.learnCount} learning, ${c.reviewCount} to review`}>
      <span className="c-new" title="New">{c.newCount}</span>
      <span className="c-learn" title="Learning">{c.learnCount}</span>
      <span className="c-review" title="To review">{c.reviewCount}</span>
    </span>
  )
}

function DeckRow({ deck, counts }: { deck: Deck; counts: QueueCounts | undefined }) {
  const [editing, setEditing] = useState(false)
  const [limit, setLimit] = useState(deck.newPerDay)
  const total = counts ? counts.newCount + counts.learnCount + counts.reviewCount : 0

  async function save() {
    const n = Math.max(0, Math.min(200, Math.round(limit)))
    await db.decks.update(deck.id, { newPerDay: n, updatedAt: Date.now() })
    setEditing(false)
  }

  return (
    <li className="deck">
      <div className="deck-main">
        <span className="deck-name">{deck.name}</span>
        {counts && <Counts c={counts} />}
      </div>
      <div className="deck-actions">
        <button type="button" className="link" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
          Options
        </button>
        <a className={`btn ${total ? 'primary' : ''}`} href={`#/study/${encodeURIComponent(deck.id)}`} aria-disabled={!total}>
          {total ? 'Study' : 'Done'}
        </a>
      </div>
      {editing && (
        <div className="deck-options">
          <label>
            New cards per day
            <input type="number" min={0} max={200} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
          </label>
          <button type="button" className="btn" onClick={save}>Save</button>
        </div>
      )}
    </li>
  )
}

export default function Today() {
  const decks = useLiveQuery(() => db.decks.orderBy('name').toArray(), [])
  // Re-count whenever cards or reviews change.
  const stamp = useLiveQuery(async () => `${await db.cards.count()}-${await db.reviewLogs.count()}`, [])
  const [counts, setCounts] = useState<Record<string, QueueCounts>>({})
  const [all, setAll] = useState<QueueCounts | null>(null)
  const studiedToday = useLiveQuery(() => db.reviewLogs.where('day').equals(dayKey()).count(), [stamp])

  useEffect(() => {
    if (!decks) return
    let alive = true
    ;(async () => {
      const out: Record<string, QueueCounts> = {}
      for (const d of decks) out[d.id] = await buildQueue([d.id])
      const a = decks.length ? await buildQueue(decks.map((d) => d.id)) : null
      if (alive) {
        setCounts(out)
        setAll(a)
      }
    })()
    return () => {
      alive = false
    }
  }, [decks, stamp])

  if (!decks) return null
  const allTotal = all ? all.newCount + all.learnCount + all.reviewCount : 0

  return (
    <section className="today">
      <div className="today-head">
        <h1>
          {allTotal === 0
            ? studiedToday ? 'All done for today' : 'Nothing due'
            : `${allTotal} card${allTotal === 1 ? '' : 's'} today`}
        </h1>
        <p className="sub">
          {studiedToday ? `${studiedToday} reviewed so far. ` : ''}
          {allTotal === 0 && studiedToday ? 'Come back tomorrow; spacing is what makes it stick.' : ''}
        </p>
        {allTotal > 0 && decks.length > 1 && (
          <a className="btn primary big" href="#/study/all">Study all decks</a>
        )}
      </div>

      {decks.length === 0 ? (
        <p className="empty">No decks yet. <a href="#/add">Add a sentence</a> to start one.</p>
      ) : (
        <>
          <p className="legend">
            <span className="c-new">new</span> <span className="c-learn">learning</span> <span className="c-review">review</span>
          </p>
          <ul className="decks">
            {decks.map((d) => (
              <DeckRow key={d.id} deck={d} counts={counts[d.id]} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
