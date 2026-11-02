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

export interface ValidationConfig {
  maxChars: { group: number; private: number; intro: number; card: number }
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
}
