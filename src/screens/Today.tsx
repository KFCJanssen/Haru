import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Deck } from '../db'
import { computeQueue, dayKey, loadQueueData, type QueueCounts } from '../scheduler'
import {
  deckName, isContainer, deckTree, ensureDeck, LEVELS, parseDeckName, renameDeckTree, TAB_INFO, TABS, withDescendants,
  type DeckNode, type Tab,
} from '../decks'
import { exportDeck } from '../anki/exporter'
import { organizeLibrary, previewOrganize, type OrganizePreview } from '../organize'

const TAB_KEY = 'haru.tab'
const total = (c?: QueueCounts | null) => (c ? c.newCount + c.learnCount + c.reviewCount : 0)

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

/** New cards/day for a whole TOPIK level, shown next to its "Study TOPIK n" button. */
function LevelLimit({ deck }: { deck: Deck }) {
  const [edit, setEdit] = useState(false)
  const [v, setV] = useState(deck.newPerDay)
  useEffect(() => setV(deck.newPerDay), [deck.newPerDay])
  async function save() {
    await db.decks.update(deck.id, { newPerDay: Math.max(0, Math.min(500, Math.round(v))), updatedAt: Date.now() })
    setEdit(false)
  }
  if (!edit)
    return (
      <button type="button" className="link level-limit" onClick={() => setEdit(true)} title="New cards per day for this level">
        {deck.newPerDay} new/day
      </button>
    )
  return (
    <span className="level-limit">
      <input type="number" min={0} max={500} value={v} onChange={(e) => setV(Number(e.target.value))} aria-label="New cards per day for this level" />
      <button type="button" className="btn small" onClick={save}>Save</button>
    </span>
  )
}

function DeckRow({ node, counts, allDecks }: { node: DeckNode; counts: QueueCounts | undefined; allDecks: Deck[] }) {
  const { deck } = node
  const parsed = parseDeckName(deck.name)
  const [open, setOpen] = useState(false)
  const [limit, setLimit] = useState(deck.newPerDay)
  const [moveTab, setMoveTab] = useState<Tab>(parsed?.tab ?? 'Vocabulary')
  const [moveLevel, setMoveLevel] = useState(parsed?.level ?? 2)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const n = total(counts)

  async function saveLimit() {
    const v = Math.max(0, Math.min(500, Math.round(limit)))
    await db.decks.update(deck.id, { newPerDay: v, updatedAt: Date.now() })
    setBusy('Saved')
  }

  async function move() {
    const path = parsed ? parsed.path : deck.name.split('::')
    const target = deckName(moveTab, moveLevel, ...(path.length ? path : [deck.name]))
    if (target === deck.name) return
    if (allDecks.some((d) => d.name === target)) {
      setBusy('A deck with that name already exists there.')
      return
    }
    await renameDeckTree(deck, target)
    setBusy(null)
    setOpen(false)
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
    const ids = withDescendants(allDecks, deck).map((d) => d.id)
    await db.transaction('rw', db.decks, db.notes, db.cards, async () => {
      const cards = await db.cards.where('deckId').anyOf(ids).toArray()
      await db.cards.bulkDelete(cards.map((c) => c.id))
      // Notes go only when none of their cards remain elsewhere (e.g. in Listening).
      const noteIds = [...new Set(cards.map((c) => c.noteId))]
      const stillUsed = new Set((await db.cards.where('noteId').anyOf(noteIds).toArray()).map((c) => c.noteId))
      await db.notes.bulkDelete(noteIds.filter((id) => !stillUsed.has(id)))
      await db.decks.bulkDelete(ids)
    })
  }

  return (
    <li className="deck" style={{ paddingLeft: `${Math.max(0, node.depth) * 1.25}rem` }}>
      <div className="deck-main">
        <span className="deck-name">{node.label}</span>
        {counts && <Counts c={counts} />}
      </div>
      <div className="deck-actions">
        <button type="button" className="link" onClick={() => setOpen((e) => !e)} aria-expanded={open}>Options</button>
        <a className={`btn ${n ? 'primary' : ''}`} href={`#/study/${encodeURIComponent(deck.id)}`} aria-disabled={!n}>
          {!counts ? 'Study' : n ? 'Study' : 'Done'}
        </a>
      </div>
      {open && (
        <div className="deck-options">
          <div className="opt-row">
            <label>
              New cards per day{node.hasChildren ? ' (also caps its sub-decks when you study it)' : ''}
              <input type="number" min={0} max={500} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
            </label>
            <button type="button" className="btn" onClick={saveLimit}>Save</button>
          </div>
          <div className="opt-row">
            <label>
              Tab
              <select value={moveTab} onChange={(e) => setMoveTab(e.target.value as Tab)}>
                {TABS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label>
              Level
              <select value={moveLevel} onChange={(e) => setMoveLevel(Number(e.target.value))}>
                {LEVELS.map((l) => <option key={l} value={l}>TOPIK {l}</option>)}
              </select>
            </label>
            <button type="button" className="btn" onClick={move}>Move</button>
          </div>
          <div className="opt-row">
            <button type="button" className="btn" onClick={() => doExport(false)}>Export to Anki</button>
            <button type="button" className="btn" onClick={() => doExport(true)}>Export with my progress</button>
          </div>
          <div className="opt-row">
            {confirmDelete ? (
              <>
                <span className="muted">Delete {node.label}{node.hasChildren ? ' and its sub-decks' : ''} with all cards and progress?</span>
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

function useCounts(decks: Deck[] | undefined, stamp: string | undefined) {
  const [counts, setCounts] = useState<Record<string, QueueCounts>>({})
  useEffect(() => {
    if (!decks) return
    let alive = true
    ;(async () => {
      const data = await loadQueueData()
      const out: Record<string, QueueCounts> = {}
      for (const d of decks) {
        const { newCount, learnCount, reviewCount } = computeQueue(withDescendants(decks, d).map((x) => x.id), data)
        out[d.id] = { newCount, learnCount, reviewCount }
      }
      if (alive) setCounts(out)
    })()
    return () => {
      alive = false
    }
  }, [decks, stamp])
  return counts
}

function Unsorted({ decks, counts, allDecks }: { decks: Deck[]; counts: Record<string, QueueCounts>; allDecks: Deck[] }) {
  const [preview, setPreview] = useState<OrganizePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    previewOrganize().then(setPreview)
  }, [decks.length])

  async function sortNow() {
    setBusy(true)
    try {
      const r = await organizeLibrary()
      setMsg(`Moved ${r.moved} cards into tabs and TOPIK levels. Your progress came along.`)
    } catch (e) {
      setMsg(`Sorting failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const tops = deckTree(decks)
  return (
    <section className="unsorted">
      <h2>Not sorted yet</h2>
      {preview && preview.known.length > 0 ? (
        <div className="sort-banner">
          <p>
            Haru can split {preview.known.map((k) => k.deck.name).join(', ')} into the tabs by TOPIK level
            ({preview.known.reduce((s, k) => s + Object.keys(k.targets).length, 0)} decks). Your review progress is kept.
          </p>
          <button type="button" className="btn primary" onClick={sortNow} disabled={busy}>
            {busy ? 'Sorting…' : 'Sort into tabs'}
          </button>
        </div>
      ) : (
        <p className="sub">Use Options → Move to put these decks in a tab and level.</p>
      )}
      {msg && <p className="status" role="status">{msg}</p>}
      <ul className="decks">
        {tops.map((n) => (
          <DeckRow key={n.deck.id} node={n} counts={counts[n.deck.id]} allDecks={allDecks} />
        ))}
      </ul>
    </section>
  )
}

export default function Today() {
  const decks = useLiveQuery(() => db.decks.toArray(), [])
  const stamp = useLiveQuery(
    async () => `${await db.cards.count()}-${await db.reviewLogs.count()}-${(await db.decks.toArray()).map((d) => `${d.name}:${d.newPerDay}`).join(',')}`,
    [],
  )
  const counts = useCounts(decks, stamp)
  const studiedToday = useLiveQuery(() => db.reviewLogs.where('day').equals(dayKey()).count(), [stamp])
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return (localStorage.getItem(TAB_KEY) as Tab) || 'Vocabulary'
    } catch {
      return 'Vocabulary'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab)
    } catch {
      /* ignore */
    }
  }, [tab])

  const groups = useMemo(() => {
    const sorted: Record<Tab, Record<number, Deck[]>> = { Vocabulary: {}, Grammar: {}, Listening: {}, Speaking: {} }
    const unsorted: Deck[] = []
    for (const d of decks ?? []) {
      const p = parseDeckName(d.name)
      if (isContainer(d.name)) continue
      if (!p) unsorted.push(d)
      else if (p.path.length) (sorted[p.tab][p.level] ??= []).push(d)
    }
    return { sorted, unsorted }
  }, [decks])

  const tabTotal = (t: Tab) => {
    const c = decks?.find((d) => d.name === t)
    return c ? total(counts[c.id]) : 0
  }
  // Tab containers are created on demand so "Study all" links work.
  useEffect(() => {
    if (!decks) return
    for (const t of TABS) {
      for (const l of LEVELS) {
        if (groups.sorted[t][l]?.length && !decks.some((d) => d.name === deckName(t, l))) ensureDeck(deckName(t, l))
      }
    }
  }, [decks, groups])

  if (!decks) return null
  const allTotal = decks
    .filter((d) => !d.name.includes('::'))
    .reduce((s, d) => s + total(counts[d.id]), 0)
  const levels = LEVELS.filter((l) => groups.sorted[tab][l]?.length)

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
          <a className="btn" href="#/import">Import Anki deck</a>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Study area">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`tab ${tab === t ? 'on' : ''}`}
            onClick={() => setTab(t)}
          >
            <span>{t}</span>
            {tabTotal(t) > 0 && <span className="tab-count">{tabTotal(t)}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="tab-panel">
        <p className="sub tab-info">{TAB_INFO[tab]}</p>
        {levels.length === 0 && (
          <p className="empty">
            {tab === 'Speaking' || tab === 'Listening'
              ? 'Sentence decks add cards here automatically: each Haru sentence gets a Read, a Listen and a Speak card.'
              : 'Nothing here yet. Import a deck, or move one here with Options → Move.'}
          </p>
        )}
        {levels.map((l) => {
          const container = decks.find((d) => d.name === deckName(tab, l))
          const c = container ? counts[container.id] : undefined
          const nodes = deckTree(groups.sorted[tab][l], 2)
          return (
            <section key={l} className="level">
              <div className="level-head">
                <h2>TOPIK {l}</h2>
                {c && <Counts c={c} />}
                {container && <LevelLimit deck={container} />}
                {container && total(c) > 0 && (
                  <a className="btn primary small" href={`#/study/${encodeURIComponent(container.id)}`}>
                    Study TOPIK {l}
                  </a>
                )}
              </div>
              <ul className="decks">
                {nodes.map((n) => (
                  <DeckRow key={n.deck.id} node={n} counts={counts[n.deck.id]} allDecks={decks} />
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      {groups.unsorted.length > 0 && <Unsorted decks={groups.unsorted} counts={counts} allDecks={decks} />}
    </section>
  )
}
