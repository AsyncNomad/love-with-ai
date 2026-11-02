import type { ParticipantId, RelationshipAxis, RelationshipConfig, Traits } from '@heart/shared'
import { RELATIONSHIP_AXES, TRAIT_AXES } from '@heart/shared'
import type { CastParticipant } from '@heart/shared'
import { pairKey, type RunState } from './state'

/** design.md §10.2: 숨은 취향과 상대의 실제 성향으로 정한 궁합(0~100). server 전용. */
export function compatTrue(source: CastParticipant, target: CastParticipant): number {
  const dist =
    TRAIT_AXES.reduce((s, axis) => s + Math.abs(source.prefs[axis] - target.traits[axis]), 0) / TRAIT_AXES.length
  let score = 100 - dist * 1.6
  const { axis, direction } = source.dealbreaker
  const v = target.traits[axis]
  if ((direction === 'high' && v >= 75) || (direction === 'low' && v <= 25)) score -= 30
  return Math.max(0, Math.min(100, score))
}

export function exposure(state: RunState, a: ParticipantId, b: ParticipantId, cfg: RelationshipConfig): number {
  const w = state.interaction.get(pairKey(a, b)) ?? 0
  return 1 - Math.exp(-w / cfg.exposureK)
}

export function compatEffective(compat: number, exp: number): number {
  return 50 + (compat - 50) * exp
}

export type CompatHint = 'unknown' | 'good' | 'neutral' | 'off'

/** 프롬프트에 숫자 대신 넣을 구간(D9). */
export function compatHint(state: RunState, source: ParticipantId, target: ParticipantId, cfg: RelationshipConfig): CompatHint {
  const s = state.participants.get(source)?.cast
  const t = state.participants.get(target)?.cast
  if (!s || !t) return 'unknown'
  const exp = exposure(state, source, target, cfg)
  if (exp < cfg.compatHintMinExposure) return 'unknown'
  const eff = compatEffective(compatTrue(s, t), exp)
  if (eff >= 62) return 'good'
  if (eff <= 40) return 'off'
  return 'neutral'
}

export type RelationshipDeltaUnits = Record<RelationshipAxis, number>

/** LLM의 -2..+2 단위를 점수로 환산하고 상한을 적용한다(D10). */
export function scaleDeltas(units: RelationshipDeltaUnits, significant: boolean, cfg: RelationshipConfig): RelationshipDeltaUnits {
  const cap = significant ? cfg.significantCap : cfg.capPerAxis
  const out = {} as RelationshipDeltaUnits
  for (const axis of RELATIONSHIP_AXES) {
    const raw = Math.round(Math.max(-2, Math.min(2, units[axis]))) * cfg.unitPoints * (significant ? 2 : 1)
    out[axis] = Math.max(-cap, Math.min(cap, raw))
  }
  return out
}

/** 성향 0~100을 사람이 읽는 말로(프롬프트용). */
export function traitWord(axis: keyof Traits, v: number): string {
  const level = v >= 70 ? 2 : v >= 40 ? 1 : 0
  const words: Record<keyof Traits, [string, string, string]> = {
    extraversion: ['낯을 가리고 조용한 편', '상황에 따라 말수가 달라지는 편', '사람 만나는 걸 좋아하고 먼저 말을 거는 편'],
    openness: ['익숙한 것을 좋아하는 편', '새로운 것에 적당히 열려 있는 편', '새로운 경험을 즐기는 편'],
    assertiveness: ['자기 주장을 잘 안 하는 편', '필요할 땐 의견을 말하는 편', '의견을 분명하게 말하는 편'],
    expressiveness: ['감정을 잘 드러내지 않는 편', '감정 표현이 적당한 편', '감정이 얼굴과 말에 바로 드러나는 편'],
    humor: ['진지한 편', '가끔 농담을 하는 편', '장난기가 많은 편'],
  }
  return words[axis][level]
}
