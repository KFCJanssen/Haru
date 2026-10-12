import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, setSetting, getSetting, uid } from '../db'
import { HARU_SENTENCE_ID } from '../noteTypes'
import { addNote } from '../starter'

const EMPTY = { sentence: '', word: '', target: '', meaning: '', translation: '', pronunciation: '', notes: '', tags: '' }

/** Wrap the first occurrence of `word` in the sentence with <b>…</b>. */
export function markTarget(sentence: string, word: string): string | null {
  const w = word.trim()
  if (!w) return null
  const i = sentence.indexOf(w)
  if (i < 0) return null
  return `${sentence.slice(0, i)}<b>${w}</b>${sentence.slice(i + w.length)}`
}

function escape(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export default function AddNote() {
  const decks = useLiveQuery(() => db.decks.orderBy('name').toArray(), [])
  const [deckId, setDeckId] = useState<string>('')
  const [f, setF] = useState(EMPTY)
  const [newDeck, setNewDeck] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    getSetting<string>('lastAddDeck', '').then((id) => id && setDeckId(id))
  }, [])
  useEffect(() => {
    if (decks?.length && !decks.some((d) => d.id === deckId)) setDeckId(decks[0].id)
  }, [decks, deckId])

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }))

  const marked = markTarget(escape(f.sentence.trim()), escape(f.word.trim()))
  const canSave = !!deckId && !!marked && !!f.target.trim() && !!f.translation.trim()

  async function createDeck() {
    const name = newDeck.trim()
    if (!name) return
    const now = Date.now()
    const id = uid()
    await db.decks.add({ id, name, newPerDay: 15, createdAt: now, updatedAt: now })
    setDeckId(id)
    setNewDeck('')
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!canSave || !marked) return
    await addNote(
      deckId,
      HARU_SENTENCE_ID,
      {
        Sentence: marked,
        Target: f.target.trim(),
        Meaning: f.meaning.trim(),
        Translation: f.translation.trim(),
        Pronunciation: f.pronunciation.trim(),
        Audio: '',
        Notes: f.notes.trim(),
      },
      f.tags.split(/[\s,]+/).filter(Boolean),
    )
    await setSetting('lastAddDeck', deckId)
    setStatus(`Added “${f.target.trim()}” (3 cards)`)
    setF((s) => ({ ...EMPTY, tags: s.tags }))
    document.getElementById('f-sentence')?.focus()
  }

  return (
    <section className="form-page">
      <h1>Add a sentence</h1>
      <p className="sub">Each sentence becomes three cards: read it, hear it, and type the marked word.</p>

      <form onSubmit={save} className="form">
        <label>
          Deck
          <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
            {decks?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <div className="inline">
          <input value={newDeck} onChange={(e) => setNewDeck(e.target.value)} placeholder="New deck name" aria-label="New deck name" />
          <button type="button" className="btn" onClick={createDeck} disabled={!newDeck.trim()}>Create deck</button>
        </div>

        <label>
          Korean sentence
          <textarea id="f-sentence" className="ko" lang="ko" rows={2} value={f.sentence} onChange={set('sentence')} placeholder="예: 새로운 환경에 적응하는 데 시간이 걸렸어요." />
        </label>
        <label>
          Word to learn, exactly as it appears in the sentence
          <input className="ko" lang="ko" value={f.word} onChange={set('word')} placeholder="적응하는" />
          {f.word && !marked && <span className="field-error">That text isn’t in the sentence. Copy it exactly.</span>}
        </label>
        {marked && <p className="preview ko" lang="ko" dangerouslySetInnerHTML={{ __html: marked }} />}
        <div className="two">
          <label>
            Dictionary form
            <input className="ko" lang="ko" value={f.target} onChange={set('target')} placeholder="적응하다" />
          </label>
          <label>
            Meaning of the word
            <input value={f.meaning} onChange={set('meaning')} placeholder="to adapt, adjust" />
          </label>
        </div>
        <label>
          Sentence translation
          <input value={f.translation} onChange={set('translation')} placeholder="It took a while to adjust to the new environment." />
        </label>
        <div className="two">
          <label>
            Pronunciation (optional)
            <input className="ko" lang="ko" value={f.pronunciation} onChange={set('pronunciation')} placeholder="[저긍하는]" />
          </label>
          <label>
            Tags (optional)
            <input value={f.tags} onChange={set('tags')} placeholder="TOPIK3 drama" />
          </label>
        </div>
        <label>
          Notes (optional)
          <textarea rows={2} value={f.notes} onChange={set('notes')} placeholder="-는 데 시간이 걸리다: it takes time to" />
        </label>
        <div className="row">
          <button type="submit" className="btn primary" disabled={!canSave}>Add sentence</button>
          {status && <span className="status" role="status">{status}</span>}
        </div>
      </form>
    </section>
  )
}
