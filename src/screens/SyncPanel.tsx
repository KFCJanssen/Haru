import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { getSetting } from '../db'
import { appUrl, supabase } from '../supabase'
import { firstSyncSituation, logOut, startSyncing, syncNow, useSyncStatus, type FirstSyncChoice } from '../sync'

function ago(t: number | null) {
  if (!t) return 'never'
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(t).toLocaleDateString()
}

export default function SyncPanel() {
  const status = useSyncStatus()
  const [user, setUser] = useState<User | null>(null)
  const [linked, setLinked] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [recovery, setRecovery] = useState(false)
  const [situation, setSituation] = useState<{ serverHasData: boolean; localReviews: number } | null>(null)

  async function refresh() {
    const { data } = await supabase.auth.getUser()
    setUser(data.user ?? null)
    setLinked(await getSetting<string | null>('sync.user', null))
    setLoading(false)
  }

  useEffect(() => {
    refresh()
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      refresh()
    })
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (user && linked !== user.id) {
      firstSyncSituation().then(setSituation).catch((e) => setMsg(e.message))
    }
  }, [user, linked])

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      refresh()
    }
  }

  const signUp = () => run(async () => {
    const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: appUrl() } })
    if (error) throw error
    if (!data.session) setMsg(`Almost done: open the email sent to ${email} and click the link, then log in here.`)
  })
  const logIn = () => run(async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message === 'Email not confirmed' ? 'Confirm your email first: click the link in the message from Supabase.' : error.message)
  })
  const forgot = () => run(async () => {
    if (!email) throw new Error('Type your email address first.')
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: appUrl() })
    if (error) throw error
    setMsg(`A reset link was sent to ${email}.`)
  })
  const setNewPassword = () => run(async () => {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
    setRecovery(false)
    setMsg('Password changed.')
  })
  const begin = (choice: FirstSyncChoice) => run(async () => {
    await startSyncing(choice)
    setSituation(null)
  })

  if (loading) return null

  return (
    <div className="setting sync">
      <h2>Sync between devices</h2>

      {recovery && (
        <form className="inline" onSubmit={(e) => { e.preventDefault(); setNewPassword() }}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password" aria-label="New password" minLength={8} autoComplete="new-password" />
          <button type="submit" className="btn primary" disabled={busy || password.length < 8}>Set new password</button>
        </form>
      )}

      {!user && !recovery && (
        <>
          <p className="sub">Create an account once, then log in with it on your other devices. Your decks, audio and progress follow you.</p>
          <form className="auth" onSubmit={(e) => { e.preventDefault(); logIn() }}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" aria-label="Email" autoComplete="email" required />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (8+ characters)" aria-label="Password" minLength={8} autoComplete="current-password" required />
            <div className="row">
              <button type="submit" className="btn primary" disabled={busy}>Log in</button>
              <button type="button" className="btn" onClick={signUp} disabled={busy || !email || password.length < 8}>Create account</button>
              <button type="button" className="link" onClick={forgot} disabled={busy}>Forgot password</button>
            </div>
          </form>
        </>
      )}

      {user && linked !== user.id && (
        <div className="first-sync">
          <p className="sub">Logged in as {user.email}. Choose how this device starts syncing:</p>
          {!situation ? (
            <p className="muted">Checking your account…</p>
          ) : !situation.serverHasData ? (
            <div className="choice">
              <button type="button" className="btn primary" disabled={busy} onClick={() => begin('upload')}>Upload this device’s decks and progress</button>
              <span className="muted">This is your first synced device.</span>
            </div>
          ) : (
            <div className="choices">
              <div className="choice">
                <button type="button" className={`btn ${situation.localReviews < 50 ? 'primary' : ''}`} disabled={busy} onClick={() => begin('replace')}>
                  Use my synced decks on this device
                </button>
                <span className="muted">Replaces what’s on this device{situation.localReviews ? ` (${situation.localReviews} reviews here)` : ''}. Best for a new phone or browser.</span>
              </div>
              <div className="choice">
                <button type="button" className={`btn ${situation.localReviews >= 50 ? 'primary' : ''}`} disabled={busy} onClick={() => begin('merge')}>
                  Merge both
                </button>
                <span className="muted">Keeps this device’s decks too. Decks imported on both devices may appear twice.</span>
              </div>
            </div>
          )}
          <button type="button" className="link" onClick={() => run(logOut)}>Log out</button>
        </div>
      )}

      {user && linked === user.id && (
        <div className="sync-on">
          <p className="sub">
            Logged in as {user.email}.{' '}
            {status.state === 'syncing' ? status.message || 'Syncing…'
              : status.state === 'error' ? `Last sync failed: ${status.message}`
              : status.state === 'offline' ? status.message
              : `Last synced ${ago(status.lastSyncAt)}.`}
          </p>
          {status.mediaProgress && (
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={status.mediaProgress.total} aria-valuenow={status.mediaProgress.done}>
              <div style={{ width: `${(100 * status.mediaProgress.done) / Math.max(1, status.mediaProgress.total)}%` }} />
              <span>{status.mediaProgress.done} of {status.mediaProgress.total} files</span>
            </div>
          )}
          <div className="row">
            <button type="button" className="btn" disabled={busy || status.state === 'syncing'} onClick={() => run(syncNow)}>Sync now</button>
            <button type="button" className="link" disabled={busy} onClick={() => run(logOut)}>Log out</button>
          </div>
        </div>
      )}

      {msg && <p className="status" role="status">{msg}</p>}
    </div>
  )
}
