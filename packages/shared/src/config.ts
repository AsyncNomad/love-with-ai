import type { StageId } from './domain'

/** 모든 시간 값은 timeScale을 곱하기 전의 기준값(ms)이다. */
export interface TimingConfig {
  timeScale: number
  arrivalIntervalMs: number
  freeTalkMs: number
  voteMs: number
  inviteMs: number
  firstTalkSlotMs: number
  firstTalkSlots: number
  regroupMs: number
  introTimeoutMs: number
  eveningTalkMs: number
  nightTalkMs: number
  minNightSlots: number
  endWarningMs: number
  endGraceMs: number
  wrapMs: number
  /** 2·3일차(game-rules.md §3). */
  morningTalkMs: number
  brunchMs: number
  catfishGreetMs: number
  d2FreeTalkMs: number
  activityChoiceMs: number
  activityTalkMs: number
  d2RegroupMs: number
  signalCardMs: number
  openingMs: number
  mailboxMs: number
  dateChoiceMs: number
  finalDateMs: number
  finalDateSlots: number
  lastDinnerMs: number
  /** 결과 발표 멘트 사이 간격 */
  revealStepMs: number
  /** 사람이 AI 응답을 이보다 오래 기다리면 1:1 타이머를 멈춘다(design.md §12). */
  aiWaitPauseGraceMs: number
  humanAfkMs: number
  backgroundSceneTimeoutMs: number
  typing: { baseMs: number; perCharMs: number; maxMs: number }
  minGapMs: number
  idle: { minMs: number; maxMs: number }
  tickMs: number
}

export interface SchedulerWeights {
  mentioned: number
  topicMatch: number
  participatedRecently: number
  extraversion: number
  interestInSpeaker: number
  recentCountPenalty: number
  consecutivePenalty: number
  quietBoost: number
  temperature: number
}

export interface SchedulerConfig {
  weights: SchedulerWeights
  maxRespondersToHuman: number
  maxChainAfterHuman: number
  maxConsecutive: number
  followUpChance: number
  quietThresholdMs: number
  recentWindow: number
  maxInFlightPerScene: number
}

export interface AssignmentConfig {
  inviteMaxAccept: number
  aiTalksPerAiPerNight: number
  aiTalkScenesPerNight: number
  backgroundUtterances: { min: number; max: number }
  /** 브런치·활동처럼 3명 이상이 오래 머무는 백그라운드 장면의 발언 수 */
  groupBackgroundUtterances: { min: number; max: number }
  brunchGroupSize: { min: number; max: number }
  activityGroupMax: number
}

/** 2일차 활동 후보(game-rules.md §5.4). cards는 PD가 그 방에 순서대로 내는 상황 안내다. */
export interface ActivityConfig {
  id: string
  name: string
  location: string
  description: string
  cards: string[]
}

export interface EventsConfig {
  activities: ActivityConfig[]
  /** 브런치 상황 카드(§5.2). 방마다 cardsPerRoom장을 뽑는다. */
  brunchCards: string[]
  brunchCardsPerRoom: number
  brunchLocations: string[]
  dateLocations: string[]
}

export interface RelationshipConfig {
  initial: { interest: number; comfort: number; trust: number; curiosity: number }
  unitPoints: number
  capPerAxis: number
  significantCap: number
  exposureK: number
  exposureWeights: { private: number; groupMention: number; groupAmbient: number; backgroundMultiplier: number }
  compatHintMinExposure: number
}

/** 말 놓기(game-rules.md §11). */
export interface SpeechConfig {
  /** 제안자가 이만큼까지 연상이면 서로 놓기(mutual)를 제안한다. 더 많으면 자기만 놓기(ask). */
  mutualMaxGap: number
  /** 두 사람의 상호작용 노출량(0~1) 하한 */
  minExposure: number
  /** 제안자가 상대에게 느끼는 편안함 하한 */
  minComfort: number
  /** 조건이 맞을 때 AI 발언 뒤마다 제안할 확률 */
  proposeChance: number
  /** 1:1이면 확률을 이만큼 곱한다 */
  privateMultiplier: number
  /** 장면에서 이만큼 말이 오간 뒤부터 제안한다 */
  minSceneMessages: number
}

export interface ValidationConfig {
  maxChars: { group: number; private: number; intro: number; card: number; mailbox: number }
  impersonationPatterns: string[]
  repetitionThreshold: number
  repetitionWindow: number
}

export interface SamplingConfig {
  temperature: number
  topP: number
  topK: number
  minP: number
  presencePenalty: number
}

export interface LlmConfig {
  dialogue: SamplingConfig
  judgement: SamplingConfig
  persona: SamplingConfig
  maxTokens: Record<string, number>
  /** 컨텍스트 예산(글자 수). 한국어 토큰 비율은 Phase 1에서 실측해 조정한다. */
  budgets: { recentMessages: number; recentMessageCount: number; memories: number; relationships: number }
  retries: number
  requestTimeoutMs: number
}

export interface AppearancePools {
  hair: { female: string[]; male: string[] }
  outfit: { female: string[]; male: string[] }
  expression: string[]
  background: string[]
  vibe: string[]
}

export interface OccupationEntry {
  title: string
  category: string
  minAge: number
  maxAge?: number
}

export interface CastingPools {
  surnames: string[]
  givenNames: { female: string[]; male: string[] }
  occupations: OccupationEntry[]
  regions: string[]
  interests: string[]
  humorStyles: string[]
  appearance: AppearancePools
}

export interface ImageConfig {
  width: number
  height: number
  steps: number
  promptTemplate: string
  timeoutMs: number
}

export interface GameConfig {
  schedule: StageId[]
  composition: { originalOpposite: number; originalSame: number; catfishPerGender: number }
  ageSpread: number
  minAge: number
  timing: TimingConfig
  scheduler: SchedulerConfig
  assignment: AssignmentConfig
  relationship: RelationshipConfig
  validation: ValidationConfig
  llm: LlmConfig
  pools: CastingPools
  image: ImageConfig
  events: EventsConfig
  speech: SpeechConfig
}
