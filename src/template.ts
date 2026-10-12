/**
 * Renders Anki-style card templates.
 * Supported: {{Field}}, {{FrontSide}}, {{#Field}}…{{/Field}}, {{^Field}}…{{/Field}},
 * {{text:Field}}, {{hint:Field}}, {{type:Field}}, {{tts ko_KR:Field}}, {{blank:Field}},
 * {{cloze:Field}} (shows the cloze text), and [sound:file] tags.
 *
 * `{{type:Field}}` and `{{blank:Field}}` become typed-answer prompts. The renderer
 * returns the expected answer so the study screen can compare it.
 */

export interface RenderResult {
  html: string
  /** Text the learner must type, if the template asks for typing. */
  typeAnswer: string | null
  /** Sound file names referenced, in order. */
  sounds: string[]
  /** Text to speak when the card has no recorded audio. */
  ttsText: string | null
}

const TYPE_SLOT = '<span class="type-slot"></span>'

export function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\[sound:[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** First <b>…</b> span in a field: the target word of a Haru sentence. */
export function boldTarget(s: string): string | null {
  const m = s.match(/<b>(.*?)<\/b>/i)
  return m ? stripHtml(m[1]) : null
}

function isEmpty(v: string | undefined) {
  return !v || stripHtml(v).length === 0 && !/\[sound:|<img/i.test(v)
}

function renderSections(tpl: string, fields: Record<string, string>): string {
  // Conditional sections, innermost first, repeated until none remain.
  const re = /\{\{([#^])\s*([^}]+?)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/
  let out = tpl
  for (let i = 0; i < 50 && re.test(out); i++) {
    out = out.replace(re, (_m, kind: string, name: string, inner: string) => {
      const empty = isEmpty(fields[name])
      return (kind === '#' ? !empty : empty) ? inner : ''
    })
  }
  return out
}

export function renderTemplate(
  tpl: string,
  fields: Record<string, string>,
  opts: { side: 'front' | 'back'; frontHtml?: string; ord?: number },
): RenderResult {
  let typeAnswer: string | null = null
  let ttsText: string | null = null

  let html = renderSections(tpl, fields)
  html = html.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, raw: string) => {
    const parts = raw.split(':')
    const name = parts.pop()!.trim()
    const filters = parts.map((p) => p.trim())
    if (name === 'FrontSide' && filters.length === 0) return opts.frontHtml ?? ''
    const value = fields[name] ?? ''

    if (filters.some((f) => f.startsWith('tts'))) {
      ttsText = stripHtml(value)
      return ttsText ? '<button type="button" class="play" aria-label="Play audio">▶</button>' : ''
    }
    if (filters.includes('type')) {
      typeAnswer = filters.includes('cloze') ? clozeAnswers(value, (opts.ord ?? 0) + 1) : stripHtml(value)
      return TYPE_SLOT
    }
    if (filters.includes('blank')) {
      // Sentence with its bold target word replaced by a typed-answer gap.
      const target = boldTarget(value)
      if (!target) return value
      typeAnswer = target
      if (opts.side === 'front') return value.replace(/<b>.*?<\/b>/i, TYPE_SLOT)
      return value
    }
    if (filters.includes('cloze')) {
      return renderCloze(value, (opts.ord ?? 0) + 1, opts.side)
    }
    if (filters.includes('hint')) {
      return value ? `<details class="hint"><summary>Hint</summary>${value}</details>` : ''
    }
    if (filters.includes('text')) return escapeHtml(stripHtml(value))
    return value
  })

  const sounds: string[] = []
  html = html.replace(/\[sound:([^\]]+)\]/g, (_m, file: string) => {
    sounds.push(file)
    return `<button type="button" class="play" data-sound="${escapeHtml(file)}" aria-label="Play audio">▶</button>`
  })

  // Local images are loaded from the media store by the study screen.
  html = html.replace(/(<img\b[^>]*?)\ssrc=(["']?)([^"' >]+)\2/gi, (m, pre: string, _q: string, src: string) =>
    /^(https?:|data:|blob:)/i.test(src) ? m : `${pre} data-media="${escapeHtml(decodeURIComponent(src))}"`)

  return { html: sanitize(html), typeAnswer, sounds, ttsText }
}

const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g

/** Anki cloze: the active number is hidden on the front and highlighted on the back. */
export function renderCloze(text: string, active: number, side: 'front' | 'back'): string {
  return text.replace(CLOZE_RE, (_m, n: string, answer: string, hint?: string) => {
    if (Number(n) !== active) return answer
    if (side === 'front') return `<span class="cloze">[${hint ? escapeHtml(hint) : '…'}]</span>`
    return `<span class="cloze">${answer}</span>`
  })
}

export function clozeAnswers(text: string, active: number): string {
  const out: string[] = []
  for (const m of text.matchAll(CLOZE_RE)) if (Number(m[1]) === active) out.push(stripHtml(m[2]))
  return out.join(', ')
}

/** Remove scripts and inline event handlers from deck HTML. */
export function sanitize(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<(iframe|object|embed)[\s\S]*?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
}

/** Character-level comparison of a typed answer, Anki style. */
export function compareAnswer(typed: string, expected: string) {
  const a = typed.trim().normalize('NFC')
  const b = expected.trim().normalize('NFC')
  return { correct: a === b, typed: a, expected: b }
}
