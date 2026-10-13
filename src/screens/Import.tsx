import { useState } from 'react'
import { importApkg, type ImportResult } from '../anki/importer'
import { isContainer, parseDeckName } from '../decks'

interface Done {
  file: string
  result?: ImportResult
  error?: string
}

export default function Import() {
  const [keepScheduling, setKeepScheduling] = useState(true)
  const [progress, setProgress] = useState<string | null>(null)
  const [done, setDone] = useState<Done[]>([])
  const [dragging, setDragging] = useState(false)

  async function run(files: FileList | File[]) {
    const list = [...files].filter((f) => /\.(apkg|colpkg)$/i.test(f.name))
    if (!list.length) {
      setDone((d) => [...d, { file: 'Selected file', error: 'Choose .apkg files downloaded from AnkiWeb or exported from Anki.' }])
      return
    }
    for (const f of list) {
      setProgress(`${f.name}: opening…`)
      try {
        const result = await importApkg(await f.arrayBuffer(), {
          keepScheduling,
          onProgress: (m) => setProgress(`${f.name}: ${m}`),
        })
        setDone((d) => [...d, { file: f.name, result }])
      } catch (e) {
        setDone((d) => [...d, { file: f.name, error: e instanceof Error ? e.message : String(e) }])
      }
    }
    setProgress(null)
  }

  return (
    <section className="form-page">
      <h1>Import Anki decks</h1>
      <p className="sub">
        Download a deck from AnkiWeb’s shared decks, or export one from Anki, then add the .apkg file here.
        Audio and images come along. Importing the same deck again updates it without duplicating cards.
      </p>

      <label
        className={`dropzone ${dragging ? 'over' : ''} ${progress ? 'busy' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (!progress) run(e.dataTransfer.files)
        }}
      >
        <input type="file" accept=".apkg,.colpkg" multiple disabled={!!progress} onChange={(e) => e.target.files && run(e.target.files)} />
        <span className="dz-main">{progress ?? 'Choose .apkg files or drop them here'}</span>
        {!progress && <span className="dz-sub">Large decks with audio can take a minute.</span>}
      </label>

      <label className="check">
        <input type="checkbox" checked={keepScheduling} onChange={(e) => setKeepScheduling(e.target.checked)} />
        Keep review progress from the file (for decks you already studied in Anki)
      </label>

      {done.length > 0 && (
        <ul className="import-results">
          {done.map((d, i) => (
            <li key={i} className={d.error ? 'err' : 'ok'}>
              <strong>{d.file}</strong>
              {d.error ? (
                <span className="error">{d.error}</span>
              ) : (
                <span>
                  {d.result!.notesAdded} new notes, {d.result!.cardsAdded} cards
                  {d.result!.notesUpdated ? `, ${d.result!.notesUpdated} updated` : ''}
                  {d.result!.mediaAdded ? `, ${d.result!.mediaAdded} audio/image files` : ''}
                  {d.result!.mediaMissing ? ` (${d.result!.mediaMissing} media files missing from the deck)` : ''}.
                  {' '}{importedDecksLabel(d.result!.decks)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {done.some((d) => d.result) && !progress && (
        <div className="row">
          <a className="btn primary" href="#/">Go to today</a>
        </div>
      )}
    </section>
  )
}

/** Short summary of where an import landed: tabs and levels when sorted, deck names otherwise. */
function importedDecksLabel(names: string[]) {
  const leaves = names.filter((n) => !isContainer(n) && !names.some((m) => m.startsWith(`${n}::`)))
  const places = [...new Set(leaves.map((n) => {
    const p = parseDeckName(n)
    return p ? `${p.tab} TOPIK ${p.level}` : n
  }))]
  const shown = places.slice(0, 8).join(', ') + (places.length > 8 ? ` and ${places.length - 8} more` : '')
  return `${leaves.every((n) => parseDeckName(n)) ? 'Added to' : places.length > 1 ? 'Decks:' : 'Deck:'} ${shown}`
}
