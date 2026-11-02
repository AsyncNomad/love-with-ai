import type { GameConfig } from '@signal/shared'
import { castingPools } from './pools'

export { castingPools }

/** 기본 설정. 시간은 timeScale을 곱하기 전 기준값이다(game-rules.md). */
export const defaultConfig: GameConfig = {
  schedule: [
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
  ],
  composition: { originalOpposite: 3, originalSame: 2, catfishPerGender: 1 },
  ageSpread: 3,
  minAge: 19,
  timing: {
    timeScale: 1,
    arrivalIntervalMs: 120_000,
    freeTalkMs: 420_000,
    voteMs: 120_000,
    inviteMs: 60_000,
    firstTalkSlotMs: 210_000,
    firstTalkSlots: 2,
    regroupMs: 60_000,
    introTimeoutMs: 120_000,
    eveningTalkMs: 420_000,
    nightTalkMs: 120_000,
    minNightSlots: 2,
    endWarningMs: 15_000,
    endGraceMs: 10_000,
    wrapMs: 60_000,
    aiWaitPauseGraceMs: 2_000,
    humanAfkMs: 60_000,
    backgroundSceneTimeoutMs: 240_000,
    typing: { baseMs: 800, perCharMs: 45, maxMs: 3_500 },
    minGapMs: 1_200,
    idle: { minMs: 20_000, maxMs: 40_000 },
    tickMs: 250,
  },
  scheduler: {
    weights: {
      mentioned: 10,
      topicMatch: 1.2,
      participatedRecently: 0.8,
      extraversion: 1.5,
      interestInSpeaker: 1,
      recentCountPenalty: 0.6,
      consecutivePenalty: 2,
      quietBoost: 1.5,
      temperature: 0.8,
    },
    maxRespondersToHuman: 2,
    maxChainAfterHuman: 3,
    maxConsecutive: 2,
    followUpChance: 0.55,
    quietThresholdMs: 480_000,
    recentWindow: 10,
    maxInFlightPerScene: 2,
  },
  assignment: {
    inviteMaxAccept: 2,
    aiTalksPerAiPerNight: 2,
    aiTalkScenesPerNight: 6,
    backgroundUtterances: { min: 4, max: 6 },
  },
  relationship: {
    initial: { interest: 35, comfort: 40, trust: 40, curiosity: 50 },
    unitPoints: 4,
    capPerAxis: 8,
    significantCap: 16,
    exposureK: 12,
    exposureWeights: { private: 1, groupMention: 0.5, groupAmbient: 0.15, backgroundMultiplier: 2 },
    compatHintMinExposure: 0.25,
  },
  validation: {
    maxChars: { group: 80, private: 120, intro: 140, card: 60 },
    impersonationPatterns: [
      '^\\s*\\[?(PD|피디|제작진|시스템|공지)\\]?\\s*[:：]',
      '\\[(공지|시스템|PD)\\]',
      '(투표|선택)\\s*결과(를|는|가)?\\s*(발표|공개)',
    ],
    repetitionThreshold: 0.7,
    repetitionWindow: 5,
  },
  llm: {
    dialogue: { temperature: 0.7, topP: 0.8, topK: 20, minP: 0, presencePenalty: 0 },
    judgement: { temperature: 0.5, topP: 0.8, topK: 20, minP: 0, presencePenalty: 0 },
    persona: { temperature: 0.8, topP: 0.9, topK: 40, minP: 0, presencePenalty: 0 },
    maxTokens: {
      dialogue: 120,
      greeting: 80,
      self_intro: 140,
      vote: 120,
      invite_decision: 60,
      relationship_eval: 260,
      memory_summary: 320,
      persona_profile: 420,
      persona_voice: 360,
    },
    budgets: { recentMessages: 1_800, recentMessageCount: 16, memories: 900, relationships: 500 },
    retries: 1,
    requestTimeoutMs: 60_000,
  },
  pools: castingPools,
  image: {
    width: 768,
    height: 768,
    steps: 4,
    promptTemplate:
      'portrait photo of a fictional {age}-year-old Korean {person}, {hair}, wearing {outfit}, {expression}, {vibe} mood, {background}, soft natural light, 85mm lens, shallow depth of field, photorealistic',
    timeoutMs: 120_000,
  },
}

/** 개발용으로 단계 시간을 줄인 설정. */
export function withTimeScale(config: GameConfig, timeScale: number): GameConfig {
  return { ...config, timing: { ...config.timing, timeScale } }
}
