import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Grade } from 'ts-fsrs'
import { db, type Card, type Note, type NoteType } from '../db'
import {
  answerCard, buildQueue, formatInterval, getScheduler, pickNext, previewIntervals, RATINGS, undoAnswer,
  type AnswerResult, type DeckQueue,
} from '../scheduler'
import { compareAnswer, renderTemplate } from '../template'
import { playSound, speak, stopAudio } from '../speech'
import { scopeCss } from '../anki/css'
import { useMediaImages } from '../useMediaImages'
import { withDescendants } from '../decks'

interface Current {
  card: Card
  note: Note
  noteType: NoteType
}

export default function Study({ deckParam }: { deckParam: string }) {
  const [deckIds, setDeckIds] = useState<string[] | null>(null)
  const [deckName, setDeckName] = useState('')
  const [queue, setQueue] = useState<DeckQueue | null>(null)
  const [cur, setCur] = useState<Current | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [typed, setTyped] = useState('')
  const [intervals, setIntervals] = useState<Record<number, number>>({})
  const [busy, setBusy] = useState(false)
  const [undoStack, setUndoStack] = useState<AnswerResult[]>([])
  const studied = useRef(0)
  const shownAt = useRef(Date.now())
  const inputRef = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  useMediaImages(cardRef, [cur, revealed])

  useEffect(() => {
    ;(async () => {
      if (deckParam === 'all') {
        const decks = await db.decks.toArray()
        setDeckIds(decks.map((d) => d.id))
        setDeckName('All decks')
      } else {
        const all = await db.decks.toArray()
        const d = all.find((x) => x.id === deckParam)
        setDeckIds(d ? withDescendants(all, d).map((x) => x.id) : [])
        setDeckName(d?.name ?? 'Deck not found')
      }
    })()
  }, [deckParam])

  const loadNext = useCallback(async () => {
    if (!deckIds) return
    const q = await buildQueue(deckIds)
    setQueue(q)
    const card = pickNext(q, studied.current)
    if (!card) {
      setCur(null)
      return
    }
    const [note, sched] = await Promise.all([db.notes.get(card.noteId), getScheduler()])
    const noteType = note ? await db.noteTypes.get(note.noteTypeId) : undefined
    if (!note || !noteType) {
      // Orphaned card: hide it so the session can continue.
      await db.cards.update(card.id, { suspended: true })
      return loadNext()
    }
    setIntervals(previewIntervals(sched, card))
    setRevealed(false)
    setTyped('')
    shownAt.current = Date.now()
    setCur({ card, note, noteType })
  }, [deckIds])

  useEffect(() => {
    loadNext()
    return stopAudio
  }, [loadNext])

  // When only learning cards remain, wait for the next one to come due.
  useEffect(() => {
    if (cur || !queue?.nextLearnAt) return
    const wait = Math.max(1000, queue.nextLearnAt - Date.now() + 500)
    if (wait > 30 * 60_000) return
    const t = setTimeout(loadNext, wait)
    return () => clearTimeout(t)
  }, [cur, queue, loadNext])

  const template = cur
    ? cur.noteType.kind === 'cloze'
      ? cur.noteType.templates[0]
      : cur.noteType.templates[cur.card.ord] ?? cur.noteType.templates[0]
    : null
  const isAnki = cur?.noteType.origin === 'anki'
  const scopedCss = useMemo(() => (cur && isAnki ? scopeCss(cur.noteType.css) : ''), [cur, isAnki])

  const front = useMemo(
    () => (cur && template ? renderTemplate(template.qfmt, cur.note.fields, { side: 'front', ord: cur.card.ord }) : null),
    [cur, template],
  )
  const back = useMemo(() => {
    if (!cur || !template) return null
    const frontForBack = renderTemplate(template.qfmt, cur.note.fields, { side: 'back', ord: cur.card.ord }).html
    return renderTemplate(template.afmt, cur.note.fields, { side: 'back', frontHtml: frontForBack, ord: cur.card.ord })
  }, [cur, template])

  const playFor = useCallback(async (r: { sounds: string[]; ttsText: string | null } | null) => {
    if (!r) return
    if (r.sounds.length) {
      const ok = await playSound(r.sounds[0])
      if (ok) return
    }
    if (r.ttsText) speak(r.ttsText)
  }, [])

  // Autoplay: question audio when shown, answer audio when revealed.
  useEffect(() => {
    if (!revealed) playFor(front)
  }, [front, revealed, playFor])
  useEffect(() => {
    if (!revealed || !back) return
    const frontHadAudio = (front?.sounds.length ?? 0) > 0 || !!front?.ttsText
    if (!frontHadAudio) playFor(back)
  }, [revealed, back, front, playFor])

  useEffect(() => {
    if (!revealed && front?.typeAnswer !== null) inputRef.current?.focus()
  }, [front, revealed])

  const reveal = useCallback(() => {
    if (cur && !revealed) setRevealed(true)
  }, [cur, revealed])

  const grade = useCallback(
    async (rating: Grade) => {
      if (!cur || !revealed || busy) return
      setBusy(true)
      stopAudio()
      try {
        const res = await answerCard(cur.card, rating, Date.now() - shownAt.current)
        setUndoStack((s) => [...s.slice(-19), res])
        studied.current += 1
        await loadNext()
      } finally {
        setBusy(false)
      }
    },
    [cur, revealed, busy, loadNext],
  )

  const undo = useCallback(async () => {
    const last = undoStack[undoStack.length - 1]
    if (!last || busy) return
    setBusy(true)
    try {
      await undoAnswer(last)
      setUndoStack((s) => s.slice(0, -1))
      studied.current = Math.max(0, studied.current - 1)
      const [note, sched] = await Promise.all([db.notes.get(last.before.noteId), getScheduler()])
      const noteType = note ? await db.noteTypes.get(note.noteTypeId) : undefined
      if (note && noteType) {
        setIntervals(previewIntervals(sched, last.before))
        setTyped('')
        setRevealed(false)
        shownAt.current = Date.now()
        setCur({ card: last.before, note, noteType })
        setQueue(await buildQueue(deckIds ?? []))
      }
    } finally {
      setBusy(false)
    }
  }, [undoStack, busy, deckIds])

  // Keyboard: Space/Enter shows the answer, 1–4 grade, R replays audio, Ctrl+Z undoes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const inInput = e.target instanceof HTMLInputElement
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
        return
      }
      if (inInput && !revealed) {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault()
          reveal()
        }
        return
      }
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        reveal()
      } else if (revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        grade(3 as Grade)
      } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
        grade(Number(e.key) as Grade)
      } else if (e.key.toLowerCase() === 'r') {
        playFor(revealed ? back : front)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [revealed, reveal, grade, undo, playFor, front, back])

  function onCardClick(e: React.MouseEvent) {
    const btn = (e.target as HTMLElement).closest('button.play') as HTMLButtonElement | null
    if (btn) {
      e.preventDefault()
      const name = btn.dataset.sound
      if (name) playSound(name).then((ok) => { if (!ok) playFor(revealed ? back : front) })
      else playFor(revealed ? back : front)
    }
  }

  if (!deckIds || !queue) return <p className="muted">Loading…</p>

  if (!cur) {
    const waiting = queue.nextLearnAt && queue.nextLearnAt - Date.now() < 30 * 60_000
    return (
      <section className="study-done">
        <h1>{waiting ? 'Short break' : 'Session finished'}</h1>
        <p className="sub">
          {waiting
            ? `${queue.learnCount} card${queue.learnCount === 1 ? '' : 's'} coming back in ${formatInterval(queue.nextLearnAt! - Date.now())}. Stay here and they’ll appear automatically.`
            : studied.current
              ? `You studied ${studied.current} card${studied.current === 1 ? '' : 's'} in ${deckName}.`
              : `Nothing is due in ${deckName} right now.`}
        </p>
        <div className="row">
          {undoStack.length > 0 && <button type="button" className="btn" onClick={undo}>Undo last answer</button>}
          <a className="btn primary" href="#/">Back to today</a>
        </div>
      </section>
    )
  }

  const verdict = revealed && front?.typeAnswer != null ? compareAnswer(typed, front.typeAnswer) : null
  const frontHtml = (front?.html ?? '').replace(
    '<span class="type-slot"></span>',
    '<span class="type-slot" data-slot="1"></span>',
  )
  const backHtml = (back?.html ?? '').replace(/<span class="type-slot"><\/span>/g, '')
  const kind = template?.name ?? ''
  const styleTag = scopedCss ? `<style>${scopedCss.replace(/<\/style/gi, '')}</style>` : ''

  return (
    <section className="study">
      <div className="study-bar">
        <a href="#/" className="link">End</a>
        <span className="deck-label">{deckName}</span>
        <span className="counts">
          <span className={`c-new ${cur.card.state === 0 ? 'on' : ''}`}>{queue.newCount}</span>
          <span className={`c-learn ${cur.card.state === 1 || cur.card.state === 3 ? 'on' : ''}`}>{queue.learnCount}</span>
          <span className={`c-review ${cur.card.state === 2 ? 'on' : ''}`}>{queue.reviewCount}</span>
        </span>
      </div>

      <div className={`study-card kind-${kind.toLowerCase()}`} ref={cardRef} onClick={onCardClick} lang="ko">
        {verdict && (
          <div className={`verdict ${verdict.correct ? 'ok' : 'miss'}`} aria-live="polite">
            {verdict.correct ? (
              <span className="ko">{verdict.expected} ✓</span>
            ) : (
              <>
                {verdict.typed && <span className="ko typed">{verdict.typed}</span>}
                <span className="ko expected">{verdict.expected}</span>
              </>
            )}
          </div>
        )}
        {!revealed ? (
          <div className={`face ${isAnki ? 'anki-scope' : ''}`} dangerouslySetInnerHTML={{ __html: styleTag + frontHtml }} />
        ) : (
          <div className={`face ${isAnki ? 'anki-scope' : ''}`} dangerouslySetInnerHTML={{ __html: styleTag + backHtml }} />
        )}
        {front?.typeAnswer != null && !revealed && (
          <input
            ref={inputRef}
            className="type-input ko"
            lang="ko"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Type the missing word"
            aria-label="Your answer"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        )}
      </div>

      <div className="controls">
        {!revealed ? (
          <button type="button" className="btn primary reveal" onClick={reveal}>
            Show answer
          </button>
        ) : (
          <div className="grades" role="group" aria-label="How well did you remember?">
            {RATINGS.map((r) => (
              <button
                key={r.rating}
                type="button"
                className={`grade g${r.rating}`}
                onClick={() => grade(r.rating)}
                disabled={busy}
              >
                <span className="g-label">{r.label}</span>
                <span className="g-int">{formatInterval(intervals[r.rating] ?? 0)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="controls-foot">
          <button type="button" className="link" onClick={undo} disabled={!undoStack.length}>Undo</button>
          <span className="hint-keys">Space shows the answer, 1–4 grade, R replays</span>
          <button type="button" className="link" onClick={() => playFor(revealed ? back : front)}>Replay</button>
        </div>
      </div>
    </section>
  )
}
