import Dexie, { type Transaction } from 'dexie'
import { useEffect, useState } from 'react'
import { db, getSetting, setSetting, type OutboxEntry } from './db'
import { supabase } from './supabase'

/**
 * Sync design
 * - Every change to a synced table is noted in `outbox` (via Dexie hooks).
 * - Push: outbox entries are upserted into Supabase `records` (one row per record, JSON data).
 * - Pull: rows changed on the server since the last pull are written locally without
 *   re-entering the outbox. Local pending changes win over remote ones for the same record.
 * - Media files go to the private `media` storage bucket and are listed in `records` too.
 */

export const SYNCED_TABLES = ['decks', 'noteTypes', 'notes', 'cards', 'reviewLogs', 'settings', 'media'] as const
type SyncedTable = (typeof SYNCED_TABLES)[number]
/** Settings that follow you between devices (the rest are per device). */
export const SYNCED_SETTINGS = new Set(['desiredRetention'])

const REMOTE = Symbol('haru-remote')
type MaybeRemote = Transaction & { [REMOTE]?: boolean }

/* ------------------------------------------------------------------ */
/* Change tracking                                                     */
/* ------------------------------------------------------------------ */

let pending = new Map<string, OutboxEntry>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let trackingEnabled = true

function note(tbl: SyncedTable, id: unknown, tx: MaybeRemote | undefined) {
  if (!trackingEnabled || tx?.[REMOTE]) return
  if (tbl === 'settings' && !SYNCED_SETTINGS.has(String(id))) return
  const key = `${tbl}:${String(id)}`
  pending.set(key, { key, tbl, id: String(id), at: Date.now() })
  if (!flushTimer) flushTimer = setTimeout(flushOutbox, 50)
}

export async function flushOutbox() {
  flushTimer = null
  if (!pending.size) return
  const batch = [...pending.values()]
  pending = new Map()
  await Dexie.ignoreTransaction(() => db.outbox.bulkPut(batch))
  scheduleAutoSync()
}

let hooksInstalled = false
export function installChangeTracking() {
  if (hooksInstalled) return
  hooksInstalled = true
  for (const tbl of SYNCED_TABLES) {
    const table = db.table(tbl)
    const pk = table.schema.primKey.keyPath as string
    table.hook('creating', function (primKey, obj, tx) {
      note(tbl, primKey ?? (obj as Record<string, unknown>)[pk], tx as MaybeRemote)
    })
    table.hook('updating', function (_mods, primKey, _obj, tx) {
      note(tbl, primKey, tx as MaybeRemote)
    })
    table.hook('deleting', function (primKey, _obj, tx) {
      note(tbl, primKey, tx as MaybeRemote)
    })
  }
}

/** Run writes that came from the server, so they are not pushed back. */
export async function remoteWrite(tables: string[], fn: () => Promise<void>) {
  await db.transaction('rw', tables.map((t) => db.table(t)), async (tx) => {
    ;(tx as MaybeRemote)[REMOTE] = true
    await fn()
  })
}

/** Queue every local record for upload (first sync of a device). */
export async function enqueueEverything() {
  const now = Date.now()
  for (const tbl of SYNCED_TABLES) {
    const keys = (await db.table(tbl).toCollection().primaryKeys()) as string[]
    const filtered = tbl === 'settings' ? keys.filter((k) => SYNCED_SETTINGS.has(k)) : keys
    await db.outbox.bulkPut(filtered.map((id) => ({ key: `${tbl}:${id}`, tbl, id: String(id), at: now })))
  }
}

/* ------------------------------------------------------------------ */
/* Status for the UI                                                   */
/* ------------------------------------------------------------------ */

export interface SyncStatus {
  state: 'off' | 'idle' | 'syncing' | 'error' | 'offline'
  message: string
  lastSyncAt: number | null
  pendingCount: number
  mediaProgress: { done: number; total: number } | null
}

let status: SyncStatus = { state: 'off', message: '', lastSyncAt: null, pendingCount: 0, mediaProgress: null }
const listeners = new Set<(s: SyncStatus) => void>()
function setStatus(p: Partial<SyncStatus>) {
  status = { ...status, ...p }
  listeners.forEach((l) => l(status))
}
export function useSyncStatus() {
  const [s, setS] = useState(status)
  useEffect(() => {
    listeners.add(setS)
    return () => {
      listeners.delete(setS)
    }
  }, [])
  return s
}

/* ------------------------------------------------------------------ */
/* Push / pull                                                         */
/* ------------------------------------------------------------------ */

const CHUNK = 400

function b64url(s: string) {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const mediaPath = (userId: string, name: string) => `${userId}/${b64url(name)}`

async function push(userId: string) {
  const entries = await db.outbox.toArray()
  setStatus({ pendingCount: entries.length })
  if (!entries.length) return

  const byTable = new Map<string, OutboxEntry[]>()
  for (const e of entries) byTable.set(e.tbl, [...(byTable.get(e.tbl) ?? []), e])

  // Media first, so that by the time another device sees the record, the file exists.
  const media = byTable.get('media') ?? []
  byTable.delete('media')
  const mediaRows: { tbl: string; id: string; data: unknown; deleted: boolean }[] = []
  let done = 0
  if (media.length) setStatus({ mediaProgress: { done: 0, total: media.length }, message: 'Uploading audio and images…' })
  const queue = [...media]
  const workers = Array.from({ length: 6 }, async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      const file = await db.media.get(e.id)
      if (file) {
        const path = mediaPath(userId, e.id)
        const { error } = await supabase.storage.from('media').upload(path, file.blob, {
          upsert: true, contentType: file.blob.type || 'application/octet-stream',
        })
        if (error && !/exists/i.test(error.message)) throw new Error(`Upload of ${e.id} failed: ${error.message}`)
        mediaRows.push({ tbl: 'media', id: e.id, data: { path, type: file.blob.type, size: file.blob.size }, deleted: false })
      } else {
        await supabase.storage.from('media').remove([mediaPath(userId, e.id)])
        mediaRows.push({ tbl: 'media', id: e.id, data: null, deleted: true })
      }
      done++
      if (done % 10 === 0) setStatus({ mediaProgress: { done, total: media.length } })
    }
  })
  await Promise.all(workers)
  if (media.length) setStatus({ mediaProgress: null })
  await upsertRows(mediaRows)
  await clearOutbox(media)

  for (const [tbl, list] of byTable) {
    for (let i = 0; i < list.length; i += CHUNK) {
      const slice = list.slice(i, i + CHUNK)
      const records = await db.table(tbl).bulkGet(slice.map((e) => e.id))
      const rows = slice.map((e, j) => ({
        tbl, id: e.id, data: records[j] ?? null, deleted: !records[j],
      }))
      await upsertRows(rows)
      await clearOutbox(slice)
      setStatus({ message: `Uploading changes… ${tbl}` })
    }
  }
}

async function upsertRows(rows: { tbl: string; id: string; data: unknown; deleted: boolean }[]) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from('records').upsert(rows.slice(i, i + CHUNK), { onConflict: 'user_id,tbl,id' })
    if (error) throw new Error(error.message)
  }
}

/** Remove pushed entries, unless they changed again while we were pushing. */
async function clearOutbox(pushed: OutboxEntry[]) {
  await db.transaction('rw', db.outbox, async () => {
    const now = await db.outbox.bulkGet(pushed.map((e) => e.key))
    const done = pushed.filter((e, i) => now[i] && now[i]!.at === e.at).map((e) => e.key)
    await db.outbox.bulkDelete(done)
  })
}

interface RemoteRow {
  tbl: string
  id: string
  data: Record<string, unknown> | null
  deleted: boolean
  updated_at: string
}

/** Fetch every row changed since `since` (ISO time), oldest first. */
async function fetchChanges(since: string | null, onPage: (rows: RemoteRow[]) => Promise<void>) {
  let cursor = since
  for (;;) {
    let q = supabase.from('records').select('tbl,id,data,deleted,updated_at').order('updated_at', { ascending: true }).limit(1000)
    if (cursor) q = q.gt('updated_at', cursor)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    if (!data?.length) return
    await onPage(data as RemoteRow[])
    cursor = (data[data.length - 1] as RemoteRow).updated_at
    await setSetting('sync.lastPull', cursor)
    if (data.length < 1000) return
  }
}

const mediaToFetch = new Map<string, string>() // name → storage path

async function applyRows(rows: RemoteRow[]) {
  const pendingKeys = new Set((await db.outbox.toCollection().primaryKeys()) as string[])
  const byTable = new Map<string, RemoteRow[]>()
  for (const r of rows) {
    if (!(SYNCED_TABLES as readonly string[]).includes(r.tbl)) continue
    if (pendingKeys.has(`${r.tbl}:${r.id}`)) continue // local change is newer; it will be pushed
    byTable.set(r.tbl, [...(byTable.get(r.tbl) ?? []), r])
  }
  const mediaRows = byTable.get('media') ?? []
  byTable.delete('media')
  if (byTable.size) {
    await remoteWrite([...byTable.keys()], async () => {
      for (const [tbl, list] of byTable) {
        const t = db.table(tbl)
        const puts = list.filter((r) => !r.deleted && r.data).map((r) => r.data!)
        const dels = list.filter((r) => r.deleted).map((r) => r.id)
        if (puts.length) await t.bulkPut(puts)
        if (dels.length) await t.bulkDelete(dels)
      }
    })
  }
  if (mediaRows.length) {
    const have = new Set((await db.media.toCollection().primaryKeys()) as string[])
    const dels = mediaRows.filter((r) => r.deleted).map((r) => r.id)
    if (dels.length) await remoteWrite(['media'], async () => { await db.media.bulkDelete(dels) })
    for (const r of mediaRows) {
      if (!r.deleted && r.data && !have.has(r.id)) mediaToFetch.set(r.id, String(r.data.path))
    }
  }
}

async function downloadMedia() {
  const items = [...mediaToFetch.entries()]
  if (!items.length) return
  let done = 0
  setStatus({ mediaProgress: { done, total: items.length }, message: 'Downloading audio and images…' })
  const queue = [...items]
  const workers = Array.from({ length: 6 }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const [name, path] = item
      const { data, error } = await supabase.storage.from('media').download(path)
      if (!error && data) {
        await remoteWrite(['media'], async () => { await db.media.put({ name, blob: data, updatedAt: Date.now() }) })
        mediaToFetch.delete(name)
      }
      done++
      if (done % 10 === 0) setStatus({ mediaProgress: { done, total: items.length } })
    }
  })
  await Promise.all(workers)
  setStatus({ mediaProgress: null })
}

/* ------------------------------------------------------------------ */
/* First sync on a device                                              */
/* ------------------------------------------------------------------ */

export type FirstSyncChoice = 'upload' | 'replace' | 'merge'

/** What to do the first time this device syncs with this account. */
export async function firstSyncSituation(): Promise<{ serverHasData: boolean; localReviews: number }> {
  const { count, error } = await supabase.from('records').select('id', { count: 'exact', head: true })
  if (error) throw new Error(error.message)
  return { serverHasData: (count ?? 0) > 0, localReviews: await db.reviewLogs.count() }
}

export async function startSyncing(choice: FirstSyncChoice) {
  const { data } = await supabase.auth.getUser()
  if (!data.user) throw new Error('Log in first.')
  if (choice === 'replace') {
    // Use only the synced data: clear this device's study data first.
    trackingEnabled = false
    try {
      await db.transaction('rw', [...SYNCED_TABLES.map((t) => db.table(t)), db.outbox], async () => {
        for (const t of SYNCED_TABLES) if (t !== 'settings') await db.table(t).clear()
        await db.outbox.clear()
      })
    } finally {
      trackingEnabled = true
    }
  } else {
    await enqueueEverything()
  }
  await setSetting('sync.user', data.user.id)
  await setSetting('sync.lastPull', null)
  await syncNow()
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

let running: Promise<void> | null = null

export async function syncNow(): Promise<void> {
  if (running) return running
  running = (async () => {
    const { data } = await supabase.auth.getSession()
    const user = data.session?.user
    const linked = await getSetting<string | null>('sync.user', null)
    if (!user || linked !== user.id) {
      setStatus({ state: 'off', message: '' })
      return
    }
    if (!navigator.onLine) {
      setStatus({ state: 'offline', message: 'Offline. Changes will sync when you are back online.' })
      return
    }
    setStatus({ state: 'syncing', message: 'Syncing…' })
    try {
      await flushOutbox()
      await push(user.id)
      const since = await getSetting<string | null>('sync.lastPull', null)
      // Small overlap guards against rows committed out of order; applying twice is harmless.
      const overlap = since ? new Date(new Date(since).getTime() - 2000).toISOString() : null
      await fetchChanges(overlap, applyRows)
      await downloadMedia()
      const lastSyncAt = Date.now()
      await setSetting('sync.lastSyncAt', lastSyncAt)
      setStatus({ state: 'idle', message: '', lastSyncAt, pendingCount: await db.outbox.count() })
    } catch (e) {
      setStatus({ state: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  })()
  try {
    await running
  } finally {
    running = null
  }
}

let autoTimer: ReturnType<typeof setTimeout> | null = null
/** Sync a little while after changes stop coming in. */
export function scheduleAutoSync(delayMs = 20_000) {
  if (autoTimer) clearTimeout(autoTimer)
  autoTimer = setTimeout(() => {
    autoTimer = null
    syncNow()
  }, delayMs)
}

export async function initSync() {
  installChangeTracking()
  setStatus({ lastSyncAt: await getSetting<number | null>('sync.lastSyncAt', null) })
  // Finish an email confirmation (PKCE ?code=…) and clean the address bar.
  const params = new URLSearchParams(window.location.search)
  if (params.get('code')) {
    await supabase.auth.exchangeCodeForSession(params.get('code')!).catch(() => undefined)
    params.delete('code')
    const q = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`)
  }
  await syncNow()
  window.addEventListener('online', () => syncNow())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') syncNow()
    else scheduleAutoSync(1000)
  })
  setInterval(() => syncNow(), 5 * 60_000)
}

export async function logOut() {
  await syncNow()
  await supabase.auth.signOut()
  await setSetting('sync.user', null)
  await setSetting('sync.lastPull', null)
  setStatus({ state: 'off', message: '', lastSyncAt: null })
}
