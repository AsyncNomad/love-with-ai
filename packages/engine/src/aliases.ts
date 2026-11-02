import type { ParticipantId } from '@signal/shared'

const HANGUL_START = 0xac00
const HANGUL_END = 0xd7a3

function hasBatchim(ch: string): boolean {
  const code = ch.charCodeAt(0)
  if (code < HANGUL_START || code > HANGUL_END) return false
  return (code - HANGUL_START) % 28 !== 0
}

const HANGUL_ONLY = /^[가-힣]+$/

/**
 * 부르는 이름(given name). 한글 3글자면 성 1글자, 4글자면 성 2글자를 뗀다.
 * 영문 닉네임("Jay")이나 2글자 이름은 그대로 쓴다.
 */
export function givenName(fullName: string): string {
  if (!HANGUL_ONLY.test(fullName)) return fullName
  if (fullName.length === 3) return fullName.slice(1)
  if (fullName.length === 4) return fullName.slice(2)
  return fullName
}

/**
 * 한국어 호칭 변형(design.md §11.1). 전체 이름, 이름, 이름+씨/님, 이름+아/야, 받침 있으면 이름+이.
 */
export function aliasesFor(fullName: string): string[] {
  const given = givenName(fullName)
  const last = given.at(-1) ?? ''
  const batchim = hasBatchim(last)
  const set = new Set<string>([fullName, given, `${given}씨`, `${given} 씨`, `${given}님`, batchim ? `${given}아` : `${given}야`])
  if (batchim) set.add(`${given}이`)
  return [...set]
}

export interface NamedParticipant {
  id: ParticipantId
  name: string
}

/** 본문에서 지목된 참가자. 이름이 다른 단어의 일부로 우연히 겹치는 경우는 감수한다(풀에서 흔한 단어 이름을 뺀다). */
export function findMentions(text: string, candidates: readonly NamedParticipant[]): ParticipantId[] {
  const out: ParticipantId[] = []
  for (const c of candidates) {
    if (text.includes(givenName(c.name)) || text.includes(c.name)) out.push(c.id)
  }
  return out
}

/** 본문에 등장한 이름(전체 또는 이름 2글자)을 가진 참가자. canary 검사에 쓴다. */
export function containsName(text: string, fullName: string): boolean {
  return text.includes(fullName) || text.includes(givenName(fullName))
}
