import { z } from 'zod'

export type RunId = string
export type ParticipantId = string
export type RoomId = string
export type VoteId = string

export const GENDERS = ['male', 'female'] as const
export const genderSchema = z.enum(GENDERS)
export type Gender = z.infer<typeof genderSchema>

export function oppositeGender(g: Gender): Gender {
  return g === 'male' ? 'female' : 'male'
}

/** game-rules.md §3 상태 머신. 순서는 config의 schedule이 정한다. */
export const STAGE_IDS = [
  'CASTING',
  'D1_ARRIVAL',
  'D1_FREE_TALK',
  'D1_FIRST_VOTE',
  'D1_FIRST_INVITES',
  'D1_FIRST_TALKS',
  'D1_REGROUP',
  'D1_INTRODUCTION',
  'D1_EVENING_TALK',
  'D1_NIGHT_VOTE',
  'D1_NIGHT_TALKS',
  'D1_WRAP',
  'D2_MORNING',
  'D2_BRUNCH',
  'D2_CATFISH_1',
  'D2_FREE_TALK',
  'D2_CATFISH_2',
  'D2_ACTIVITY_CHOICE',
  'D2_ACTIVITY_TALKS',
  'D2_REGROUP',
  'D2_SIGNAL_CARD',
  'D2_NIGHT_VOTE',
  'D2_NIGHT_TALKS',
  'D2_WRAP',
  'D3_OPENING',
  'D3_MAILBOX',
  'D3_DATE_CHOICE',
  'D3_FINAL_DATES',
  'D3_LAST_DINNER',
  'D3_FINAL_VOTE',
  'RESULT_REVEAL',
  'EPILOGUE',
] as const
export const stageIdSchema = z.enum(STAGE_IDS)
export type StageId = z.infer<typeof stageIdSchema>

export interface StageMeta {
  day: 0 | 1 | 2 | 3
  label: string
  simTime: string
}

export const STAGE_META: Record<StageId, StageMeta> = {
  CASTING: { day: 0, label: '캐스팅', simTime: 'D0 12:00' },
  D1_ARRIVAL: { day: 1, label: '입주', simTime: 'D1 15:00' },
  D1_FREE_TALK: { day: 1, label: '자유 대화', simTime: 'D1 15:10' },
  D1_FIRST_VOTE: { day: 1, label: '첫인상 선택', simTime: 'D1 16:00' },
  D1_FIRST_INVITES: { day: 1, label: '대화 초대', simTime: 'D1 16:05' },
  D1_FIRST_TALKS: { day: 1, label: '첫인상 대화', simTime: 'D1 16:10' },
  D1_REGROUP: { day: 1, label: '거실 복귀', simTime: 'D1 18:00' },
  D1_INTRODUCTION: { day: 1, label: '자기소개', simTime: 'D1 19:00' },
  D1_EVENING_TALK: { day: 1, label: '저녁 대화', simTime: 'D1 20:00' },
  D1_NIGHT_VOTE: { day: 1, label: '심야 선택', simTime: 'D1 22:30' },
  D1_NIGHT_TALKS: { day: 1, label: '심야 대화', simTime: 'D1 23:00' },
  D1_WRAP: { day: 1, label: '1일차 마무리', simTime: 'D1 24:00' },
  D2_MORNING: { day: 2, label: '아침 대화', simTime: 'D2 09:00' },
  D2_BRUNCH: { day: 2, label: '브런치 미션', simTime: 'D2 10:00' },
  D2_CATFISH_1: { day: 2, label: '새 입주자', simTime: 'D2 12:00' },
  D2_FREE_TALK: { day: 2, label: '자유 대화', simTime: 'D2 12:10' },
  D2_CATFISH_2: { day: 2, label: '새 입주자', simTime: 'D2 13:00' },
  D2_ACTIVITY_CHOICE: { day: 2, label: '활동 선택', simTime: 'D2 14:00' },
  D2_ACTIVITY_TALKS: { day: 2, label: '활동', simTime: 'D2 14:30' },
  D2_REGROUP: { day: 2, label: '거실 복귀', simTime: 'D2 18:00' },
  D2_SIGNAL_CARD: { day: 2, label: '시그널 카드', simTime: 'D2 21:00' },
  D2_NIGHT_VOTE: { day: 2, label: '심야 선택', simTime: 'D2 22:30' },
  D2_NIGHT_TALKS: { day: 2, label: '심야 대화', simTime: 'D2 23:00' },
  D2_WRAP: { day: 2, label: '2일차 마무리', simTime: 'D2 24:00' },
  D3_OPENING: { day: 3, label: '마지막 날', simTime: 'D3 10:00' },
  D3_MAILBOX: { day: 3, label: '시그널 우체통', simTime: 'D3 11:00' },
  D3_DATE_CHOICE: { day: 3, label: '데이트 선택', simTime: 'D3 13:00' },
  D3_FINAL_DATES: { day: 3, label: '마지막 데이트', simTime: 'D3 14:00' },
  D3_LAST_DINNER: { day: 3, label: '마지막 저녁', simTime: 'D3 19:00' },
  D3_FINAL_VOTE: { day: 3, label: '최종 선택', simTime: 'D3 21:00' },
  RESULT_REVEAL: { day: 3, label: '결과 발표', simTime: 'D3 21:30' },
  EPILOGUE: { day: 3, label: '에필로그', simTime: 'D3 23:00' },
}

export const ROOM_KINDS = ['living', 'private', 'group'] as const
export const roomKindSchema = z.enum(ROOM_KINDS)
export type RoomKind = z.infer<typeof roomKindSchema>

/** 'date'는 마지막 데이트 상대 선택이다. 투표는 아니지만 같은 검증·비공개 규칙을 쓰므로 투표 기록을 재사용한다(D33). */
export const VOTE_KINDS = ['first_impression', 'night', 'date', 'final'] as const
export const voteKindSchema = z.enum(VOTE_KINDS)
export type VoteKind = z.infer<typeof voteKindSchema>

export const TRAIT_AXES = ['extraversion', 'openness', 'assertiveness', 'expressiveness', 'humor'] as const
export type TraitAxis = (typeof TRAIT_AXES)[number]
export const traitsSchema = z.object({
  extraversion: z.number().min(0).max(100),
  openness: z.number().min(0).max(100),
  assertiveness: z.number().min(0).max(100),
  expressiveness: z.number().min(0).max(100),
  humor: z.number().min(0).max(100),
})
export type Traits = z.infer<typeof traitsSchema>

export const speechStyleSchema = z.object({
  length: z.enum(['short', 'medium', 'long']),
  laughter: z.number().min(0).max(1),
  emoji: z.number().min(0).max(1),
  questionTendency: z.number().min(0).max(1),
  humorStyle: z.string(),
  temperatureOffset: z.number(),
})
export type SpeechStyle = z.infer<typeof speechStyleSchema>

export const appearanceSchema = z.object({
  hair: z.string(),
  outfit: z.string(),
  expression: z.string(),
  background: z.string(),
  vibe: z.string(),
})
export type Appearance = z.infer<typeof appearanceSchema>

/** LLM이 만든 인격 서술 (design.md §8.1-6). */
export const personaFlavorSchema = z.object({
  background: z.string(),
  values: z.string(),
  likes: z.string(),
  flaws: z.string(),
  approach: z.string(),
  speechDescription: z.string(),
  exampleLines: z.array(z.string()),
})
export type PersonaFlavor = z.infer<typeof personaFlavorSchema>

export const humanProfileSchema = z.object({
  name: z.string().trim().min(1).max(12),
  gender: genderSchema,
  age: z.number().int().min(19).max(99),
  region: z.string().trim().min(1).max(20),
  occupation: z.string().trim().min(1).max(30),
  personality: z.string().trim().max(200),
  interests: z.array(z.string().trim().min(1).max(20)).max(5),
})
export type HumanProfile = z.infer<typeof humanProfileSchema>

export const castParticipantSchema = z.object({
  id: z.string(),
  isHuman: z.boolean(),
  isCatfish: z.boolean(),
  gender: genderSchema,
  name: z.string(),
  age: z.number().int(),
  occupation: z.string(),
  region: z.string(),
  entryOrder: z.number().int(),
  interests: z.array(z.string()),
  traits: traitsSchema,
  /** 숨은 취향: 상대에게 바라는 성향 값. server 전용(D9). */
  prefs: traitsSchema,
  dealbreaker: z.object({ axis: z.enum(TRAIT_AXES), direction: z.enum(['high', 'low']) }),
  speech: speechStyleSchema,
  appearance: appearanceSchema,
  /** 사람만: 직접 입력한 성격. AI에게는 절대 전달하지 않는다(D19). */
  humanPersonality: z.string().optional(),
})
export type CastParticipant = z.infer<typeof castParticipantSchema>

export const SPEECH_LEVELS = ['polite', 'casual'] as const
export type SpeechLevel = (typeof SPEECH_LEVELS)[number]

export const MEMORY_KINDS = ['summary', 'impression', 'choice'] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

export const RELATIONSHIP_AXES = ['interest', 'comfort', 'trust', 'curiosity'] as const
export type RelationshipAxis = (typeof RELATIONSHIP_AXES)[number]
