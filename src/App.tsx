import { useEffect, useState } from 'react'
import { requestPersistentStorage } from './db'
import { ensureSeedData } from './starter'
import Today from './screens/Today'
import Study from './screens/Study'
import AddNote from './screens/AddNote'
import Browse from './screens/Browse'
import Settings from './screens/Settings'
import Import from './screens/Import'
import { initSync, useSyncStatus } from './sync'

function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || '/')
  useEffect(() => {
    const on = () => setHash(window.location.hash.slice(1) || '/')
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

const NAV = [
  { href: '#/', label: 'Today', match: (r: string) => r === '/' || r.startsWith('/study') || r.startsWith('/import') },
  { href: '#/add', label: 'Add', match: (r: string) => r.startsWith('/add') },
  { href: '#/browse', label: 'Browse', match: (r: string) => r.startsWith('/browse') },
  { href: '#/settings', label: 'Settings', match: (r: string) => r.startsWith('/settings') },
]

function SyncDot() {
  const s = useSyncStatus()
  if (s.state === 'off') return null
  const label = s.state === 'syncing' ? 'Syncing' : s.state === 'error' ? 'Sync problem: open Settings' : s.state === 'offline' ? 'Offline' : 'Synced'
  return <a href="#/settings" className={`sync-dot ${s.state}`} title={label} aria-label={label} />
}

export default function App() {
  const route = useHashRoute()
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ensureSeedData()
      .then(() => {
        setReady(true)
        initSync()
      })
      .catch((e) => setError(String(e)))
    requestPersistentStorage()
  }, [])

  const studying = route.startsWith('/study/')

  let screen = null
  if (ready) {
    if (studying) screen = <Study deckParam={decodeURIComponent(route.slice('/study/'.length))} />
    else if (route.startsWith('/add')) screen = <AddNote />
    else if (route.startsWith('/browse')) screen = <Browse />
    else if (route.startsWith('/settings')) screen = <Settings />
    else if (route.startsWith('/import')) screen = <Import />
    else screen = <Today />
  }

  return (
    <div className={`app ${studying ? 'is-studying' : ''}`}>
      <header className="topbar">
        <a href="#/" className="brand" aria-label="Haru, today">
          <span className="brand-ko" lang="ko">하루</span>
        </a>
        <SyncDot />
        <nav className="nav">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className={n.match(route) ? 'active' : ''}>
              {n.label}
            </a>
          ))}
        </nav>
      </header>
      <main className="main">
        {error && <p className="error">Your study data couldn’t be opened: {error}. Close other Haru tabs and reload.</p>}
        {screen}
      </main>
    </div>
  )
}
