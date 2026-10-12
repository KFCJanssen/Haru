import { useEffect, useState } from 'react'
import { db, getSetting, setSetting } from '../db'
import { koreanVoices, resetVoiceCache, speak, whenVoicesReady } from '../speech'
import SyncPanel from './SyncPanel'

const TABLES = ['decks', 'noteTypes', 'notes', 'cards', 'reviewLogs', 'settings'] as const

export default function Settings() {
  const [retention, setRetention] = useState(0.9)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [voice, setVoice] = useState('')
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    getSetting('desiredRetention', 0.9).then(setRetention)
    getSetting('ttsVoice', '').then(setVoice)
    whenVoicesReady().then(() => setVoices(koreanVoices()))
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null))
  }, [])

  async function saveRetention(v: number) {
    setRetention(v)
    await setSetting('desiredRetention', v)
  }
  async function saveVoice(v: string) {
    setVoice(v)
    await setSetting('ttsVoice', v)
    resetVoiceCache()
  }

  async function exportBackup() {
    const data: Record<string, unknown[]> = {}
    for (const t of TABLES) data[t] = await db.table(t).toArray()
    const blob = new Blob([JSON.stringify({ app: 'haru', version: 1, exportedAt: new Date().toISOString(), data })], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `haru-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    setMsg('Backup saved to your downloads.')
  }

  async function importBackup(file: File) {
    try {
      const json = JSON.parse(await file.text())
      if (json?.app !== 'haru' || !json.data) throw new Error('This file isn’t a Haru backup.')
      await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
        for (const t of TABLES) {
          await db.table(t).clear()
          if (Array.isArray(json.data[t])) await db.table(t).bulkPut(json.data[t])
        }
      })
      setMsg('Backup restored.')
    } catch (e) {
      setMsg(`Restore failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <section className="form-page">
      <h1>Settings</h1>

      <SyncPanel />

      <div className="setting">
        <h2>Target recall</h2>
        <p className="sub">
          How likely you are to remember a card when it comes back. Higher means more reviews per day.
          90% is the research-backed default.
        </p>
        <div className="range-row">
          <input type="range" min={0.8} max={0.97} step={0.01} value={retention} onChange={(e) => saveRetention(Number(e.target.value))} aria-label="Target recall" />
          <output>{Math.round(retention * 100)}%</output>
        </div>
      </div>

      <div className="setting">
        <h2>Korean voice</h2>
        {voices.length === 0 ? (
          <p className="sub">
            No Korean voice found in this browser. In Windows, add Korean under Settings, Time &amp; language, Speech,
            or open Haru in Microsoft Edge, which has natural Korean voices built in.
          </p>
        ) : (
          <div className="inline">
            <select value={voice} onChange={(e) => saveVoice(e.target.value)} aria-label="Korean voice">
              <option value="">Automatic (best available)</option>
              {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}
            </select>
            <button type="button" className="btn" onClick={() => speak('안녕하세요. 오늘도 같이 공부해요.')}>Test</button>
          </div>
        )}
      </div>

      <div className="setting">
        <h2>Backup</h2>
        <p className="sub">Saves decks, cards and your full review history to one file (audio is not included).</p>
        <div className="inline">
          <button type="button" className="btn" onClick={exportBackup}>Save backup</button>
          <label className="btn file-btn">
            Restore backup
            <input type="file" accept="application/json,.json" onChange={(e) => e.target.files?.[0] && importBackup(e.target.files[0])} />
          </label>
        </div>
        {msg && <p className="status" role="status">{msg}</p>}
      </div>

      <div className="setting">
        <h2>Storage</h2>
        <p className="sub">
          {persisted === true && 'Your study data is stored permanently on this device.'}
          {persisted === false && 'The browser may clear your data if the disk gets full. Install Haru as an app to keep it safe.'}
          {persisted === null && 'Storage status unavailable in this browser.'}
        </p>
      </div>
    </section>
  )
}
