import { db } from './db'

let cachedVoice: SpeechSynthesisVoice | null | undefined

export function koreanVoices(): SpeechSynthesisVoice[] {
  if (!('speechSynthesis' in window)) return []
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('ko'))
}

/** Voices load asynchronously in Chrome/Edge. */
export function whenVoicesReady(): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window) || speechSynthesis.getVoices().length) return resolve()
    speechSynthesis.addEventListener('voiceschanged', () => resolve(), { once: true })
    setTimeout(resolve, 1500)
  })
}

function pickVoice(preferred: string | null): SpeechSynthesisVoice | null {
  const voices = koreanVoices()
  if (preferred) {
    const v = voices.find((x) => x.voiceURI === preferred)
    if (v) return v
  }
  // Natural/online voices sound far better than the old offline ones.
  return voices.find((v) => /natural|online|google/i.test(v.name)) ?? voices[0] ?? null
}

export async function speak(text: string, rate = 0.95) {
  if (!('speechSynthesis' in window) || !text) return
  await whenVoicesReady()
  if (cachedVoice === undefined) {
    const pref = (await db.settings.get('ttsVoice'))?.value as string | undefined
    cachedVoice = pickVoice(pref ?? null)
  }
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'ko-KR'
  u.rate = rate
  if (cachedVoice) u.voice = cachedVoice
  speechSynthesis.speak(u)
}

export function resetVoiceCache() {
  cachedVoice = undefined
}

let current: HTMLAudioElement | null = null

/** Play a media file stored in the local database. Returns false if it is missing. */
export async function playSound(name: string): Promise<boolean> {
  const file = await db.media.get(name)
  if (!file) return false
  current?.pause()
  const url = URL.createObjectURL(file.blob)
  current = new Audio(url)
  current.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true })
  await current.play().catch(() => undefined)
  return true
}

export function stopAudio() {
  current?.pause()
  if ('speechSynthesis' in window) speechSynthesis.cancel()
}
