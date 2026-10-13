import type { NoteType } from './db'

export const HARU_SENTENCE_ID = 'haru-sentence-v1'

/**
 * Built-in sentence note. Mark the target word in Sentence with <b>…</b>.
 * Three cards per note: read it, hear it, produce the target word.
 */
export const haruSentence: NoteType = {
  id: HARU_SENTENCE_ID,
  name: 'Haru sentence',
  origin: 'haru',
  updatedAt: 0,
  fields: ['Sentence', 'Target', 'Meaning', 'Translation', 'Pronunciation', 'Audio', 'Notes'],
  css: '',
  templates: [
    {
      name: 'Read',
      qfmt: `<div class="ko sentence">{{Sentence}}</div>`,
      afmt: `{{FrontSide}}
<div class="answer">
  <div class="target"><span class="ko">{{Target}}</span>{{#Pronunciation}} <span class="pron">{{Pronunciation}}</span>{{/Pronunciation}}</div>
  <div class="meaning">{{Meaning}}</div>
  <div class="translation">{{Translation}}</div>
  {{#Notes}}<div class="notes">{{Notes}}</div>{{/Notes}}
  {{Audio}}{{^Audio}}{{tts ko_KR:Sentence}}{{/Audio}}
</div>`,
    },
    {
      name: 'Listen',
      qfmt: `<div class="listen-prompt">Listen and recall what it means</div>
{{Audio}}{{^Audio}}{{tts ko_KR:Sentence}}{{/Audio}}`,
      afmt: `{{FrontSide}}
<div class="answer">
  <div class="ko sentence">{{Sentence}}</div>
  <div class="translation">{{Translation}}</div>
  <div class="target"><span class="ko">{{Target}}</span> <span class="meaning-inline">{{Meaning}}</span></div>
  {{#Notes}}<div class="notes">{{Notes}}</div>{{/Notes}}
</div>`,
    },
    {
      name: 'Produce',
      qfmt: `<div class="translation prompt">{{Translation}}</div>
<div class="ko sentence">{{blank:Sentence}}</div>
<div class="cue">{{Meaning}}</div>
<div class="say">Say the whole sentence out loud, then type the missing part.</div>`,
      afmt: `{{FrontSide}}
<div class="answer">
  <div class="target"><span class="ko">{{Target}}</span>{{#Pronunciation}} <span class="pron">{{Pronunciation}}</span>{{/Pronunciation}}</div>
  {{#Notes}}<div class="notes">{{Notes}}</div>{{/Notes}}
  {{Audio}}{{^Audio}}{{tts ko_KR:Sentence}}{{/Audio}}
</div>`,
    },
  ],
}

export const BUILT_IN_NOTE_TYPES = [haruSentence]
