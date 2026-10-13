import { db, uid, type Card, type Note } from './db'
import { HARU_SENTENCE_ID, haruSentence } from './noteTypes'
import { newCardFields } from './scheduler'

type Row = [sentence: string, target: string, meaning: string, translation: string, pronunciation: string, notes: string]

/** Intermediate (TOPIK II) starter sentences. The target word is in <b>…</b>. */
export const STARTER_ROWS: Row[] = [
  ['요즘 날씨가 <b>추워져서</b> 감기에 걸리기 쉬워요.', '추워지다', 'to get cold', 'The weather has been getting cold lately, so it is easy to catch a cold.', '[추워저서]', '-아/어지다: to become · -기 쉽다: easy to'],
  ['서울에 살 때 한국 문화를 직접 <b>경험할</b> 수 있어서 좋았어요.', '경험하다', 'to experience', 'When I lived in Seoul, it was great to experience Korean culture firsthand.', '', '-(으)ㄹ 수 있다: can'],
  ['새로운 환경에 <b>적응하는</b> 데 시간이 좀 걸렸어요.', '적응하다', 'to adapt, adjust', 'It took a while to adjust to the new environment.', '[저긍하는]', '-는 데 시간이 걸리다: it takes time to'],
  ['저는 매일 아침 30분씩 <b>꾸준히</b> 운동하고 있어요.', '꾸준히', 'steadily, consistently', 'I exercise consistently for 30 minutes every morning.', '', '-씩: each, per'],
  ['회의가 <b>연기되었다는</b> 소식을 방금 들었어요.', '연기되다', 'to be postponed', 'I just heard that the meeting was postponed.', '', '-았/었다는 소식: the news that'],
  ['시험 결과가 생각보다 좋아서 <b>다행이에요</b>.', '다행이다', 'to be a relief, fortunate', 'What a relief that the exam results were better than I expected.', '', '-보다: than'],
  ['그는 어려운 상황에서도 <b>포기하지</b> 않았다.', '포기하다', 'to give up', 'He did not give up even in a difficult situation.', '', '-지 않다: not (written style)'],
  ['환경을 <b>보호하기</b> 위해 일회용품 사용을 줄여야 합니다.', '보호하다', 'to protect', 'To protect the environment, we must use fewer disposable products.', '', '-기 위해: in order to · -아/어야 하다: must'],
  ['지하철이 <b>고장 나서</b> 회사에 늦게 도착했어요.', '고장 나다', 'to break down', 'The subway broke down, so I got to work late.', '', ''],
  ['그 영화는 실제 사건을 <b>바탕으로</b> 만들어졌다.', '바탕', 'basis, foundation', 'That film was based on a real event.', '', 'N을/를 바탕으로: based on N'],
  ['이번 프로젝트는 팀원들의 <b>협력</b> 덕분에 성공할 수 있었다.', '협력', 'cooperation', 'This project succeeded thanks to the team members’ cooperation.', '[혐녁]', 'N 덕분에: thanks to N'],
  ['경제가 <b>회복되면서</b> 일자리도 늘어나고 있다.', '회복되다', 'to recover', 'As the economy recovers, jobs are increasing too.', '', '-(으)면서: as, while'],
  ['부모님께 걱정을 <b>끼쳐</b> 드려서 죄송했어요.', '끼치다', 'to cause (worry, trouble)', 'I felt sorry for causing my parents worry.', '[끼처]', '걱정을 끼치다: to cause worry · -아/어 드리다: humble form'],
  ['사람들의 <b>의견</b>이 서로 달라서 결정을 내리기 어려웠다.', '의견', 'opinion', 'People’s opinions differed, so it was hard to reach a decision.', '', '결정을 내리다: to make a decision'],
  ['한국에서는 어른이 먼저 수저를 드신 후에 먹는 것이 <b>예의</b>예요.', '예의', 'manners, etiquette', 'In Korea it is good manners to start eating after the elders pick up their spoons.', '[예의/예이]', '-(으)ㄴ 후에: after'],
  ['스마트폰 사용 시간이 늘면서 <b>시력</b>이 나빠진 사람이 많아졌다.', '시력', 'eyesight', 'As smartphone use has grown, more people have poor eyesight.', '', ''],
  ['이 약은 하루에 세 번 식후에 <b>복용하세요</b>.', '복용하다', 'to take (medicine)', 'Take this medicine three times a day after meals.', '[보굥하세요]', '식후: after a meal'],
  ['무슨 일이 있어도 약속은 꼭 <b>지켜야</b> 한다.', '지키다', 'to keep (a promise), protect', 'Whatever happens, you must keep your promises.', '', '무슨 일이 있어도: no matter what'],
  ['실수를 <b>줄이려면</b> 제출하기 전에 한 번 더 확인하세요.', '줄이다', 'to reduce', 'To make fewer mistakes, check once more before you submit.', '[주리려면]', '-(으)려면: if you intend to'],
  ['인구가 <b>감소하면서</b> 많은 학교가 문을 닫고 있다.', '감소하다', 'to decrease, decline', 'As the population declines, many schools are closing.', '', ''],
  ['그는 자신의 꿈을 <b>이루기</b> 위해 밤낮없이 노력했다.', '이루다', 'to achieve, realize', 'He worked day and night to achieve his dream.', '', '밤낮없이: day and night'],
  ['이 제품은 가격에 비해 품질이 <b>뛰어나다</b>.', '뛰어나다', 'to be excellent, outstanding', 'This product’s quality is outstanding for its price.', '', 'N에 비해: compared to N'],
  ['발표를 앞두고 너무 <b>긴장해서</b> 잠을 못 잤어요.', '긴장하다', 'to be nervous, tense', 'I was so nervous before the presentation that I could not sleep.', '', 'N을/를 앞두고: ahead of N'],
  ['전문가들은 이 문제를 해결하기 위한 <b>방안</b>을 찾고 있다.', '방안', 'measure, way (to solve)', 'Experts are looking for a way to solve this problem.', '', '-기 위한 N: N for (doing)'],
  ['날씨에 <b>따라</b> 기분이 달라지는 사람도 있다.', '따르다', 'to follow; N에 따라: depending on N', 'Some people’s mood changes depending on the weather.', '', 'N에 따라: depending on N'],
  ['시간이 <b>흐를수록</b> 그 일의 의미를 더 잘 이해하게 되었다.', '흐르다', 'to flow, pass (time)', 'The more time passed, the better I understood what it meant.', '[흐를쑤록]', '-(으)ㄹ수록: the more … · -게 되다: come to'],
  ['이 지역은 교통이 <b>편리해서</b> 집값이 비싼 편이다.', '편리하다', 'to be convenient', 'Transport here is convenient, so housing tends to be expensive.', '[펼리해서]', '-(으)ㄴ 편이다: tends to be'],
  ['그녀는 어릴 때부터 음악에 <b>관심</b>이 많았다.', '관심', 'interest', 'She has been very interested in music since she was young.', '', 'N에 관심이 많다: very interested in N'],
  ['그 가게는 손님이 많아서 항상 줄을 <b>서야</b> 해요.', '서다', 'to stand; 줄을 서다: to queue', 'That shop is always busy, so you always have to queue.', '', ''],
  ['한국어 실력을 <b>유지하려면</b> 매일 조금씩이라도 공부해야 해요.', '유지하다', 'to maintain, keep up', 'To keep up your Korean, you have to study at least a little every day.', '', '-(이)라도: even if only'],
]

/** TOPIK level of each starter sentence's target word, in STARTER_ROWS order. */
export const STARTER_LEVELS = [3, 2, 3, 3, 3, 2, 2, 3, 2, 3, 4, 3, 4, 3, 3, 3, 4, 3, 3, 4, 3, 4, 3, 4, 3, 3, 3, 3, 2, 3]

export const STARTER_DECK_NAME = 'Starter: TOPIK II sentences'

/** Create the built-in note type and (on first run) the starter deck. */
export async function ensureSeedData() {
  await db.noteTypes.put(haruSentence)
  const seeded = await db.settings.get('seeded')
  if (seeded) return
  const now = Date.now()
  // Fixed ids: every device seeds the same starter deck, so sync never duplicates it.
  const deckId = 'starter-topik2'
  const notes: Note[] = []
  const cards: Card[] = []
  STARTER_ROWS.forEach((r, i) => {
    const note: Note = {
      id: `starter-note-${i}`,
      noteTypeId: HARU_SENTENCE_ID,
      deckId,
      fields: {
        Sentence: r[0],
        Target: r[1],
        Meaning: r[2],
        Translation: r[3],
        Pronunciation: r[4],
        Audio: '',
        Notes: r[5],
      },
      tags: ['starter', 'TOPIK2'],
      createdAt: now,
      updatedAt: now,
    }
    notes.push(note)
    haruSentence.templates.forEach((_t, ord) => {
      cards.push({ id: `starter-card-${i}-${ord}`, noteId: note.id, deckId, ord, newOrder: i * 10 + ord, ...newCardFields(now) })
    })
  })
  await db.transaction('rw', [db.decks, db.notes, db.cards, db.settings], async () => {
    await db.decks.add({ id: deckId, name: STARTER_DECK_NAME, newPerDay: 15, createdAt: now, updatedAt: now })
    await db.notes.bulkAdd(notes)
    await db.cards.bulkAdd(cards)
    await db.settings.put({ key: 'seeded', value: true })
  })
}

/** Create a note and its cards. */
export async function addNote(deckId: string, noteTypeId: string, fields: Record<string, string>, tags: string[]) {
  const nt = await db.noteTypes.get(noteTypeId)
  if (!nt) throw new Error('Unknown note type')
  const now = Date.now()
  const last = await db.cards.where('deckId').equals(deckId).toArray()
  const base = last.reduce((m, c) => Math.max(m, c.newOrder), -10) + 10
  const note: Note = { id: uid(), noteTypeId, deckId, fields, tags, createdAt: now, updatedAt: now }
  const cards: Card[] = nt.templates.map((_t, ord) => ({
    id: uid(), noteId: note.id, deckId, ord, newOrder: base + ord, ...newCardFields(now),
  }))
  await db.transaction('rw', db.notes, db.cards, async () => {
    await db.notes.add(note)
    await db.cards.bulkAdd(cards)
  })
  return note
}
