import type { CastParticipant, PersonaFlavor, RelationshipConfig } from '@heart/shared'
import { TRAIT_AXES } from '@heart/shared'
import { traitWord, type CompatHint, type RelationshipState } from '@heart/engine'
import { LAUGH_THRESHOLD } from './validate'

/** 숫자 성향을 자연어로 바꾼 인물 소개(D12). 본인 프롬프트에만 들어간다. */
export function renderPersona(cast: CastParticipant, flavor: PersonaFlavor | null): string {
  const gender = cast.gender === 'female' ? '여' : '남'
  const lines = [
    `이름: ${cast.name} (${gender}, ${cast.age}세)`,
    `직업: ${cast.occupation} / 사는 곳: ${cast.region}`,
    `관심사: ${cast.interests.join(', ')}`,
    `성격: ${TRAIT_AXES.map((a) => traitWord(a, cast.traits[a])).join(', ')}.`,
  ]
  if (flavor) {
    lines.push(
      `배경: ${flavor.background}`,
      `가치관: ${flavor.values}`,
      `좋아하는 것: ${flavor.likes}`,
      `단점: ${flavor.flaws}`,
      `사람에게 다가가는 방식: ${flavor.approach}`,
    )
  }
  lines.push(`말투: ${speechRules(cast, flavor)}`)
  if (flavor && flavor.exampleLines.length > 0) {
    lines.push('말투 예시:', ...flavor.exampleLines.map((l) => `- "${l}"`))
  }
  return lines.join('\n')
}

function speechRules(cast: CastParticipant, flavor: PersonaFlavor | null): string {
  const s = cast.speech
  const parts: string[] = []
  if (flavor) parts.push(flavor.speechDescription)
  parts.push(s.length === 'short' ? '말이 짧고 간결하다' : s.length === 'medium' ? '적당한 길이로 말한다' : '조금 길게 설명하는 편이다')
  parts.push(s.laughter >= LAUGH_THRESHOLD ? '정말 웃길 때만 가끔 ㅋㅋ를 쓴다(한 메시지에 한 번 이하)' : 'ㅋㅋ 같은 웃음 표현은 쓰지 않는다')
  parts.push(s.emoji >= 0.5 ? '이모티콘을 종종 쓴다' : '이모티콘은 거의 안 쓴다')
  parts.push(s.questionTendency >= 0.6 ? '질문을 자주 던진다' : '질문보다 자기 얘기를 하는 편이다')
  if (s.humorStyle) parts.push(`${s.humorStyle} 유머`)
  return parts.join(', ')
}

export function relationshipWords(r: RelationshipState): string {
  const words: string[] = []
  words.push(r.interest >= 60 ? '관심이 많이 간다' : r.interest >= 45 ? '조금 궁금하다' : r.interest < 30 ? '별로 끌리지 않는다' : '아직 덤덤하다')
  if (r.comfort >= 60) words.push('대화가 편하다')
  else if (r.comfort < 30) words.push('대화가 조금 불편하다')
  if (r.trust < 30) words.push('조금 경계된다')
  return words.join(', ')
}

export function compatWords(hint: CompatHint): string | null {
  switch (hint) {
    case 'good':
      return '이야기할수록 결이 잘 맞는다고 느낀다'
    case 'off':
      return '어딘가 템포가 다르다고 느낀다'
    case 'neutral':
      return '잘 맞는지는 아직 모르겠다'
    case 'unknown':
      return null
  }
}

export function relationshipDetail(r: RelationshipState, hint: CompatHint, _cfg: RelationshipConfig): string {
  const c = compatWords(hint)
  return c ? `${relationshipWords(r)}, ${c}` : relationshipWords(r)
}
