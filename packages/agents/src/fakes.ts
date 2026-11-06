import { givenName, type Rng } from '@heart/engine'
import type { LlmRequest } from './llm-port'

/**
 * FakeLlm용 작업별 응답기(D17). GPU 없이 3일 전체를 돌리고 UI를 개발하기 위한 것이다.
 * 출력은 실제 모델과 같은 스키마를 지킨다. enum 후보는 요청의 JSON Schema에서 읽는다.
 */
export type FakeResponder = (req: LlmRequest, rng: Rng) => unknown

const LINES = [
  '오 그거 저도 좋아해요',
  '아 진짜요? 신기하네요',
  '저는 주말에 주로 집에 있는 편이에요',
  '여기 분위기 생각보다 좋네요',
  '다들 긴장 좀 풀리셨어요?',
  '아까 그 얘기 재밌었어요ㅋㅋ',
  '저 요즘 러닝 시작했는데 생각보다 힘들더라고요',
  '음식 얘기 나오니까 배고파지네요',
  '저는 커피 없으면 하루가 안 굴러가요',
  '혹시 다들 MBTI 믿으세요?',
  '그쵸 저도 그렇게 생각해요',
  '오늘 날씨 진짜 좋지 않아요?',
  '아 그건 좀 의외인데요?',
  '저는 여행 가면 계획 엄청 세우는 편이에요',
  '그럼 다음엔 같이 가봐요',
  '헐 저도 그 영화 봤어요',
  '조용한 데서 얘기하는 거 좋아해요',
  '처음엔 낯가리는데 금방 친해져요',
  '그 얘기 더 듣고 싶어요',
  '저 그런 거 은근 잘해요ㅋㅋ',
]

const CARDS = ['아까 얘기 나눌 때 정말 편했어요. 내일도 이야기하고 싶어요.', '웃는 모습이 계속 생각나요.', '같이 걸었던 시간이 제일 좋았어요.']
const QUESTIONS = ['여기 와서 가장 기억에 남는 순간은 언제예요?', '연애할 때 제일 중요하게 생각하는 게 뭐예요?', '저랑 이야기할 때 어떤 느낌이었어요?']
const ANSWERS = ['솔직히 어제 밤에 나눈 대화가 제일 기억에 남아요.', '서로 편하게 이야기할 수 있는 게 제일 중요해요.', '생각보다 편해서 놀랐어요.']
const PRIVATE_OPEN = ['둘이 얘기하니까 좀 떨리네요', '드디어 얘기해 보네요', '아까부터 궁금했어요', '여기 조용하고 좋네요']
const WRAP = ['벌써 시간이 다 됐네요', '얘기 즐거웠어요', '다음에 또 얘기해요']

function enumAt(schema: Record<string, unknown>, path: string[]): string[] {
  let node: unknown = schema
  for (const key of path) node = (node as Record<string, unknown> | undefined)?.[key]
  const values = (node as { enum?: unknown } | undefined)?.enum
  return Array.isArray(values) ? values.map(String) : []
}

export const fakeResponders: Record<string, FakeResponder> = {
  dialogue: (req, rng) => {
    const mode = req.meta.mode ?? 'reply'
    const name = req.meta.speakerName ?? ''
    if (mode === 'greeting') return { action: 'speak', text: `안녕하세요! ${givenName(name)}라고 해요. 잘 부탁드려요` }
    if (mode === 'newcomer_greeting') return { action: 'speak', text: `안녕하세요! 오늘 새로 들어온 ${givenName(name)}예요. 잘 부탁드려요` }
    if (mode === 'open_private') return { action: 'speak', text: rng.pick(PRIVATE_OPEN) }
    if (mode === 'wrap_up') return { action: 'speak', text: rng.pick(WRAP) }
    if (mode === 'propose_casual') return { action: 'speak', text: '우리 이제 좀 편하게 이야기할까요?' }
    if (mode !== 'start_topic' && rng.chance(0.12)) return { action: 'silent', text: '' }
    return { action: 'speak', text: rng.pick(LINES) }
  },
  self_intro: (req) => ({
    text: `안녕하세요, ${req.meta.age ?? ''}살이고 ${req.meta.occupation ?? ''}로 일하고 있는 ${req.meta.speakerName ?? ''}입니다. 잘 부탁드려요.`,
  }),
  vote: (req, rng) => {
    const options = enumAt(req.jsonSchema, ['properties', 'choice'])
    return { choice: rng.pick(options), reason: '대화가 편했다.' }
  },
  invite_decision: (req, rng) => {
    const options = enumAt(req.jsonSchema, ['properties', 'accept', 'items'])
    return { accept: rng.shuffle(options).slice(0, rng.int(0, Math.min(2, options.length))) }
  },
  relationship_eval: (req, rng) => {
    const names = enumAt(req.jsonSchema, ['properties', 'evaluations', 'items', 'properties', 'name'])
    const u = (): number => rng.int(-1, 2)
    return {
      evaluations: names.map((name) => ({
        name,
        interest: u(),
        comfort: u(),
        trust: rng.int(-1, 1),
        curiosity: u(),
        significant: false,
        impression: `${name}은(는) 대화가 무난했다.`,
      })),
    }
  },
  activity_choice: (req, rng) => {
    const [first, second] = rng.shuffle(enumAt(req.jsonSchema, ['properties', 'first']))
    return { first, second }
  },
  signal_card: (req, rng) => {
    const options = enumAt(req.jsonSchema, ['properties', 'target'])
    return { target: rng.pick(options), text: rng.pick(CARDS) }
  },
  mailbox_question: (req, rng) => {
    const options = enumAt(req.jsonSchema, ['properties', 'target'])
    return { target: rng.pick(options), question: rng.pick(QUESTIONS) }
  },
  mailbox_answer: (_req, rng) => ({ text: rng.pick(ANSWERS) }),
  speech_response: (req, rng) => {
    const options = enumAt(req.jsonSchema, ['properties', 'answer'])
    const answer = rng.pick(options)
    return { answer, text: answer === 'decline' ? '아직은 존댓말이 편해요' : '좋아요, 그렇게 해요' }
  },
  human_speech: (req) => {
    if (req.meta.mode === 'answer') return { answer: 'accept' }
    if (req.meta.mode === 'verify') return { offer: true }
    const said = req.messages.at(-1)?.content ?? ''
    const target = enumAt(req.jsonSchema, ['properties', 'target'])[1]
    return (said.includes('편하게') || said.includes('말을 놓')) && target ? { target, kind: 'mutual' } : { target: '없음', kind: 'none' }
  },
  memory_summary: () => ({ summary: '오늘은 여러 사람과 이야기했다. 아직 누가 잘 맞는지는 모르겠다.' }),
  persona_profile: (req) => ({
    background: `${req.meta.name ?? ''}은(는) 평범한 직장 생활 속에서 취미를 찾았다.`,
    values: '서로 편하게 대화할 수 있는 관계가 중요하다.',
    likes: '맛있는 음식과 조용한 카페를 좋아한다.',
    flaws: '가끔 생각이 많아 결정이 느리다.',
    approach: '처음엔 조심스럽지만 공통점을 찾으면 금방 친해진다.',
  }),
  persona_voice: (_req, rng) => {
    const style = rng.pick(['ㅋㅋ', 'ㅎㅎ', '!', '~'])
    return {
      speechDescription: `문장 끝에 ${style}를 자주 붙이는 편안한 말투`,
      exampleLines: [`안녕하세요${style}`, `쉬는 날엔 주로 산책해요${style}`, `아 맞아요${style}`, `저 은근 웃긴 사람이에요${style}`, `음 그건 좀 어렵네요${style}`],
    }
  },
}
