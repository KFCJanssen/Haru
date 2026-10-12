import { useEffect, type RefObject } from 'react'
import { db } from './db'

/** Fill <img data-media="name"> elements inside `ref` with images stored in the local database. */
export function useMediaImages(ref: RefObject<HTMLElement | null>, deps: unknown[]) {
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const urls: string[] = []
    let alive = true
    root.querySelectorAll<HTMLImageElement>('img[data-media]').forEach(async (img) => {
      const file = await db.media.get(img.dataset.media!)
      if (!alive || !file) return
      const url = URL.createObjectURL(file.blob)
      urls.push(url)
      img.src = url
    })
    return () => {
      alive = false
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
