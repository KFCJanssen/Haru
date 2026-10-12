import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Deck } from '../db'
import { buildQueue, dayKey, type QueueCounts } from '../scheduler'
import { deckTree, withDescendants, type DeckNode } from '../decks'
import { exportDeck } from '../anki/exporter'

function Counts({ c }: { c: QueueCounts }) {
  return (
    <span className="counts" aria-label={`${c.newCount} new, ${c.learnCount} learning, ${c.reviewCount} to review`}>
      <span className="c-new" title="New">{c.newCount}</span>
      <span className="c-learn" title="Learning">{c.learnCount}</span>
      <span className="c-review" title="To review">{c.reviewCount}</span>
    </span>
  )
}

function download(bytes: Uint8Array, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

function DeckRow({ node, counts, allDecks }: { node: DeckNode; counts: QueueCounts | undefined; allDecks: Deck[] }) {
  const { deck } = node
  const [open, setOpen] = useState(false)
  const [limit, setLimit] = useState(deck.newPerDay)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const total = counts ? counts.newCount + counts.learnCount + counts.reviewCount : 0

  async function saveLimit() {
    const n = Math.max(0, Math.min(500, Math.round(limit)))
    await db.decks.update(deck.id, { newPerDay: n, updatedAt: Date.now() })
    setBusy('Saved')
  }

  async function doExport(includeScheduling: boolean) {
    setBusy('Preparing the Anki file…')
    try {
      const bytes = await exportDeck(deck.id, { includeScheduling })
      download(bytes, `${deck.name.replace(/::/g, ' - ').replace(/[\\/:*?"<>|]/g, '')}.apkg`)
      setBusy('Saved to your downloads')
    } catch (e) {
      setBusy(`Export failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function doDelete() {
    const decks = withDescendants(allDecks, deck)
    const ids = decks.map((d) => d.id)
    await db.transaction('rw', db.decks, db.notes, db.cards, async () => {
      const noteIds = (await db.cards.where('deckId').anyOf(ids).toArray()).map((c) => c.noteId)
      await db.cards.where('deckId').anyOf(ids).delete()
      await db.notes.bulkDelete([...new Set(noteIds)])
      await db.decks.bulkDelete(ids)
    })
  }

  return (
    <li className={`deck depth-${Math.min(node.depth, 3)}`} style={{ paddingLeft: `${node.depth * 1.25}rem` }}>
      <div className="deck-main">
        <span className="deck-name">{node.label}</span>
        {counts && <Counts c={counts} />}
      </div>
      <div className="deck-actions">
        <button type="button" className="link" onClick={() => setOpen((e) => !e)} aria-expanded={open}>
          Options
        </button>
        <a className={`btn ${total ? 'primary' : ''}`} href={`#/study/${encodeURIComponent(deck.id)}`} aria-disabled={!total}>
          {total ? 'Study' : 'Done'}
        </a>
      </div>
      {open && (
        <div className="deck-options">
          <div className="opt-row">
            <label>
              New cards per day{node.hasChildren ? ' (this deck only)' : ''}
              <input type="number" min={0} max={500} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
            </label>
            <button type="button" className="btn" onClick={saveLimit}>Save</button>
          </div>
          <div className="opt-row">
            <button type="button" className="btn" onClick={() => doExport(false)}>Export to Anki</button>
            <button type="button" className="btn" onClick={() => doExport(true)}>Export with my progress</button>
          </div>
          <div className="opt-row">
            {confirmDelete ? (
              <>
                <span className="muted">Delete {deck.name}{node.hasChildren ? ' and its sub-decks' : ''} with all cards and progress?</span>
                <button type="button" className="link danger" onClick={doDelete}>Delete for good</button>
                <button type="button" className="link" onClick={() => setConfirmDelete(false)}>Keep</button>
              </>
            ) : (
              <button type="button" className="link" onClick={() => setConfirmDelete(true)}>Delete deck</button>
            )}
          </div>
          {busy && <p className="status" role="status">{busy}</p>}
        </div>
      )}
    </li>
  )
}

export default function Today() {
  const decks = useLiveQuery(() => db.decks.toArray(), [])
  // Re-count whenever cards, decks or reviews change.
  const stamp = useLiveQuery(
    async () => `${await db.cards.count()}-${await db.reviewLogs.count()}-${(await db.decks.toArray()).map((d) => d.newPerDay).join(',')}`,
    [],
  )
  const [counts, setCounts] = useState<Record<string, QueueCounts>>({})
  const [all, setAll] = useState<QueueCounts | null>(null)
  const studiedToday = useLiveQuery(() => db.reviewLogs.where('day').equals(dayKey()).count(), [stamp])

  useEffect(() => {
    if (!decks) return
    let alive = true
    ;(async () => {
      const out: Record<string, QueueCounts> = {}
      for (const d of decks) out[d.id] = await buildQueue(withDescendants(decks, d).map((x) => x.id))
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
  const tree = deckTree(decks)
  const topLevel = tree.filter((n) => n.depth === 0).length

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
        <div className="row">
          {allTotal > 0 && topLevel > 1 && <a className="btn primary big" href="#/study/all">Study all decks</a>}
          <a className="btn" href="#/import">Import Anki deck</a>
        </div>
      </div>

      {decks.length === 0 ? (
        <p className="empty">No decks yet. <a href="#/import">Import an Anki deck</a> or <a href="#/add">add a sentence</a>.</p>
      ) : (
        <>
          <p className="legend">
            <span className="c-new">new</span> <span className="c-learn">learning</span> <span className="c-review">review</span>
          </p>
          <ul className="decks">
            {tree.map((n) => (
              <DeckRow key={n.deck.id} node={n} counts={counts[n.deck.id]} allDecks={decks} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
