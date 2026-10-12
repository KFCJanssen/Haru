/**
 * Make an imported deck's CSS safe to use inside Haru:
 * - every selector is scoped to `.anki-scope` (Anki's `.card` becomes the scope itself)
 * - html/body rules are dropped
 * - fonts, colours and backgrounds are dropped so cards follow Haru's theme (incl. dark mode);
 *   Haru styles .cloze itself
 */
const DROP_PROPS = /^(font-family|font-size|color|background|background-color|line-height)$/i
const DROP_ALWAYS = /^(font-family|color|background|background-color)$/i

function scopeSelector(sel: string): string | null {
  const s = sel.trim()
  if (!s) return null
  if (/^(html|body|:root)\b/i.test(s)) return null
  if (/^\.card\b/.test(s)) return `.anki-scope${s.slice(5)}`
  if (/^\.(mobile|nightMode|night_mode)\b/.test(s)) return null
  return `.anki-scope ${s}`
}

function cleanDeclarations(body: string, isRoot: boolean): string {
  return body
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((d) => {
      const prop = d.split(':')[0].trim()
      return isRoot ? !DROP_PROPS.test(prop) : !DROP_ALWAYS.test(prop)
    })
    .join('; ')
}

export function scopeCss(css: string): string {
  // Remove comments, then process flat rules. @-blocks (media queries, fonts) are skipped.
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: string[] = []
  let i = 0
  while (i < src.length) {
    const open = src.indexOf('{', i)
    if (open < 0) break
    const prelude = src.slice(i, open).trim()
    if (prelude.startsWith('@')) {
      // Skip the whole @-block including nested braces.
      let depth = 1
      let j = open + 1
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth++
        else if (src[j] === '}') depth--
        j++
      }
      i = j
      continue
    }
    const close = src.indexOf('}', open)
    if (close < 0) break
    const body = src.slice(open + 1, close)
    const selectors = prelude.split(',').map(scopeSelector).filter((s): s is string => !!s)
    if (selectors.length) {
      const isRoot = selectors.some((s) => /^\.anki-scope(\s*$|[.:#[])/.test(s) || /^\.anki-scope$/.test(s))
      const decls = cleanDeclarations(body, isRoot)
      if (decls) out.push(`${selectors.join(', ')} { ${decls} }`)
    }
    i = close + 1
  }
  return out.join('\n')
}
