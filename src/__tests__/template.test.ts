import { describe, expect, it } from 'vitest'
import { boldTarget, compareAnswer, renderTemplate, sanitize, stripHtml } from '../template'
import { haruSentence } from '../noteTypes'

const fields = {
  Sentence: '새로운 환경에 <b>적응하는</b> 데 시간이 걸렸어요.',
  Target: '적응하다',
  Meaning: 'to adapt',
  Translation: 'It took a while to adjust.',
  Pronunciation: '[저긍하는]',
  Audio: '',
  Notes: '',
}

describe('renderTemplate', () => {
  it('fills fields and conditional sections', () => {
    const r = renderTemplate('{{Target}}{{#Notes}}<i>{{Notes}}</i>{{/Notes}}{{^Notes}}none{{/Notes}}', fields, { side: 'front' })
    expect(r.html).toBe('적응하다none')
  })

  it('uses TTS when there is no audio', () => {
    const t = haruSentence.templates[1]
    const r = renderTemplate(t.qfmt, fields, { side: 'front' })
    expect(r.ttsText).toBe('새로운 환경에 적응하는 데 시간이 걸렸어요.')
    expect(r.html).toContain('class="play"')
  })

  it('prefers recorded audio over TTS', () => {
    const t = haruSentence.templates[1]
    const r = renderTemplate(t.qfmt, { ...fields, Audio: '[sound:s1.mp3]' }, { side: 'front' })
    expect(r.sounds).toEqual(['s1.mp3'])
    expect(r.ttsText).toBeNull()
  })

  it('blanks the target word on the production card', () => {
    const t = haruSentence.templates[2]
    const front = renderTemplate(t.qfmt, fields, { side: 'front' })
    expect(front.typeAnswer).toBe('적응하는')
    expect(front.html).not.toContain('적응하는')
    expect(front.html).toContain('type-slot')
    const back = renderTemplate(t.qfmt, fields, { side: 'back' })
    expect(back.html).toContain('<b>적응하는</b>')
  })

  it('inserts FrontSide on the back', () => {
    const r = renderTemplate('{{FrontSide}}<hr>{{Meaning}}', fields, { side: 'back', frontHtml: 'FRONT' })
    expect(r.html).toBe('FRONT<hr>to adapt')
  })

  it('handles Anki type: fields', () => {
    const r = renderTemplate('{{Meaning}} {{type:Target}}', fields, { side: 'front' })
    expect(r.typeAnswer).toBe('적응하다')
  })
})

describe('helpers', () => {
  it('strips html and sound tags', () => {
    expect(stripHtml('<b>가</b>&nbsp;나 [sound:x.mp3]')).toBe('가 나')
  })
  it('finds the bold target', () => {
    expect(boldTarget(fields.Sentence)).toBe('적응하는')
  })
  it('removes scripts and handlers', () => {
    expect(sanitize('<img src=x onerror="alert(1)"><script>bad()</script>ok')).toBe('<img src=x>ok')
  })
  it('compares Korean answers after Unicode normalization', () => {
    const decomposed = '적응하는'.normalize('NFD')
    expect(compareAnswer(` ${decomposed} `, '적응하는').correct).toBe(true)
    expect(compareAnswer('적응한', '적응하는').correct).toBe(false)
  })
})
