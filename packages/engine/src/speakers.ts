import type { ParticipantId, SchedulerWeights } from '@heart/shared'
import type { Rng } from './rng'

/** 발언 후보 하나의 특징(design.md §11.1). 값은 호출자가 상태에서 계산해 넣는다. */
export interface SpeakerFeatures {
  id: ParticipantId
  mentioned: boolean
  topicMatch: boolean
  participatedRecently: boolean
  /** 0~100 */
  extraversion: number
  /** 직전 화자에 대한 interest, 0~100 */
  interestInSpeaker: number
  recentCount: number
  /** 이 후보가 연속으로 말한 횟수(직전 화자가 본인일 때만 >0) */
  consecutive: number
  quiet: boolean
}

export function speakerScore(f: SpeakerFeatures, w: SchedulerWeights): number {
  return (
    (f.mentioned ? w.mentioned : 0) +
    (f.topicMatch ? w.topicMatch : 0) +
    (f.participatedRecently ? w.participatedRecently : 0) +
    (f.extraversion / 100) * w.extraversion +
    (f.interestInSpeaker / 100) * w.interestInSpeaker -
    f.recentCount * w.recentCountPenalty -
    f.consecutive * w.consecutivePenalty +
    (f.quiet ? w.quietBoost : 0)
  )
}

/**
 * softmax 가중 비복원 추출로 최대 k명을 고른다. 지목된 사람은 항상 먼저 뽑는다.
 * `maxConsecutive`에 걸린 후보는 제외한다.
 */
export function pickSpeakers(
  candidates: readonly SpeakerFeatures[],
  k: number,
  rng: Rng,
  w: SchedulerWeights,
  maxConsecutive: number,
): ParticipantId[] {
  const pool = candidates.filter((c) => c.consecutive < maxConsecutive)
  const out: ParticipantId[] = []
  for (const c of pool) if (c.mentioned && out.length < k) out.push(c.id)
  let rest = pool.filter((c) => !out.includes(c.id))
  while (out.length < k && rest.length > 0) {
    const scores = rest.map((c) => speakerScore(c, w))
    const max = Math.max(...scores)
    const weights = new Map(rest.map((c, i) => [c.id, Math.exp(((scores[i] as number) - max) / w.temperature)]))
    const chosen = rng.weighted(rest, (c) => weights.get(c.id) ?? 0)
    out.push(chosen.id)
    rest = rest.filter((c) => c.id !== chosen.id)
  }
  return out
}

/** 관심사 키워드 단순 매칭(MVP). */
export function matchesInterest(text: string, interests: readonly string[]): boolean {
  return interests.some((kw) => kw.length >= 2 && text.includes(kw))
}
