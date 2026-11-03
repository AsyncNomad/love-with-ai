import { z } from 'zod'
import type { CastParticipant, PersonaFlavor } from '@heart/shared'
import { TRAIT_AXES } from '@heart/shared'
import { traitWord } from '@heart/engine'
import type { TaskSpec } from '../task'
import { LAUGH_THRESHOLD, checkDialogue, hasCasualWord, hasForeignScript, isPolite, limitLaughter, similarity } from '../validate'

/**
 * 인격 서술 생성(design.md §8.1-6). 구조적 값(이름·나이·직업·성향)은 서버가 정했고 LLM은 바꾸지 못한다.
 * 이 호출에는 다른 참가자 정보가 전혀 들어가지 않는다.
 */

function structural(cast: CastParticipant): string {
  return [
    `이름: ${cast.name}, ${cast.gender === 'female' ? '여성' : '남성'}, ${cast.age}세`,
    `직업: ${cast.occupation}, 사는 곳: ${cast.region}`,
    `관심사: ${cast.interests.join(', ')}`,
    `성격: ${TRAIT_AXES.map((a) => traitWord(a, cast.traits[a])).join(', ')}`,
    `유머: ${cast.speech.humorStyle} 스타일`,
    `분위기: ${cast.appearance.vibe}`,
  ].join('\n')
}

const SYSTEM = '너는 연애 리얼리티 프로그램의 가상 출연자 설정을 쓰는 작가다. 주어진 사실은 절대 바꾸지 않는다. 평범하고 현실적인 한국 20~30대처럼 쓴다. 지나치게 완벽하거나 모두에게 다정한 인물로 만들지 않는다. 실존 인물을 언급하지 않는다. 처음 만난 사람에게는 누구나 존댓말을 쓴다. 반말이나 사투리를 쓰는 설정은 넣지 않는다.'

const SPEECH_TOPIC = /반말|사투리/
const PERSONA_ATTEMPTS = 4

/** 말투 설명은 설명문이어야 한다(실측: "아무튼 그거야 그거야,ㅋㅋ 그거야, 😄"처럼 대사를 쓴 경우가 있었다). */
const DESCRIPTIVE_END = /(다|말투|스타일|편|톤|어조|방식)\.?$/

export type PersonaProfile = Pick<PersonaFlavor, 'background' | 'values' | 'likes' | 'flaws' | 'approach'>

const field = z.string().min(4).max(140)

export const personaProfileTask: TaskSpec<{ cast: CastParticipant }, PersonaProfile, PersonaProfile> = {
  id: 'persona_profile',
  ownerOf: (i) => i.cast.id,
  sampling: (ctx) => ctx.config.llm.persona,
  maxTokens: (ctx) => ctx.config.llm.maxTokens.persona_profile ?? 420,
  // 인격은 3일 내내 쓰이고, 실패하면 밋밋한 템플릿으로 대체된다. 캐스팅 때 한 번뿐이라 몇 번 더 시도한다(실측: 7명 중 3명 대체).
  attempts: () => PERSONA_ATTEMPTS,
  schema: () => z.object({ background: field, values: field, likes: field, flaws: field, approach: field }),
  build: (i) => ({
    system: SYSTEM,
    user: `[정해진 사실]\n${structural(i.cast)}\n\n[쓸 것] JSON으로만 답한다. 각 항목은 한두 문장.\n- background: 성장 배경이나 지금 관심사를 갖게 된 계기\n- values: 연애에서 중요하게 여기는 것\n- likes: 구체적인 취향(음식, 음악, 주말 보내는 법)\n- flaws: 솔직한 단점 하나 이상\n- approach: 처음 만난 사람에게 다가가는 방식과 호감을 표현하는 속도`,
    view: null,
    meta: { name: i.cast.name },
  }),
  finish: (raw) => {
    if (Object.values(raw).some(hasForeignScript)) return { issues: ['foreign_script'] }
    // "반말·사투리로 편하게 다가간다" 같은 설정은 대화 내내 반말 이야기로 번지고 존댓말 검증과 부딪힌다(실측).
    if (Object.values(raw).some((v) => SPEECH_TOPIC.test(v))) return { issues: ['speech_level'] }
    return { value: raw }
  },
}

export interface PersonaVoiceInput {
  cast: CastParticipant
  profile: PersonaProfile
  /** 이미 만든 다른 참가자의 예시 대사. 말투가 겹치지 않게 비교만 한다(프롬프트에는 넣지 않는다). */
  othersLines: string[]
}

export interface PersonaVoice {
  speechDescription: string
  exampleLines: string[]
}

export const personaVoiceTask: TaskSpec<PersonaVoiceInput, PersonaVoice, PersonaVoice> = {
  id: 'persona_voice',
  ownerOf: (i) => i.cast.id,
  sampling: (ctx) => ctx.config.llm.persona,
  maxTokens: (ctx) => ctx.config.llm.maxTokens.persona_voice ?? 360,
  attempts: () => PERSONA_ATTEMPTS,
  schema: () => z.object({ speechDescription: z.string().min(4).max(140), exampleLines: z.array(z.string().min(2).max(70)).length(5) }),
  build: (i) => {
    const s = i.cast.speech
    const hints = [
      s.length === 'short' ? '말이 짧다' : '적당히 길게 말한다',
      s.laughter >= LAUGH_THRESHOLD ? '웃길 때만 가끔 ㅋㅋ를 쓴다' : 'ㅋㅋ 같은 웃음 표현을 쓰지 않는다',
      s.emoji >= 0.5 ? '이모티콘을 가끔 쓴다' : '이모티콘을 안 쓴다',
    ].join(', ')
    return {
      system: SYSTEM,
      user: `[정해진 사실]\n${structural(i.cast)}\n성향: ${i.profile.approach}\n말버릇 힌트: ${hints}\n\n[쓸 것] JSON으로만 답한다.\n- speechDescription: 이 사람의 메신저 말투를 설명하는 한 문장(어미, 말버릇, 리듬). 대사가 아니라 "~하는 말투"처럼 설명으로 쓴다.\n- exampleLines: 이 사람이 대화 중에 할 법한 말 5개. 순서대로 상대 말에 맞장구, 상대 말에 공감하며 자기 경험을 짧게 덧붙이는 말, 놀라거나 신기할 때 하는 말, 가벼운 농담, 쑥스럽거나 곤란할 때 하는 말. 인사말·자기소개·질문은 쓰지 않는다. 번호나 따옴표 없이 대사만 쓴다. 다른 사람 이름은 쓰지 않는다. 처음 만난 사이라 존댓말을 쓰고, 한국 사람이 실제로 쓰는 자연스러운 말투로 쓴다.`,
      view: null,
      meta: { name: i.cast.name },
    }
  },
  finish: (raw, i, ctx) => {
    // 모델이 지시문의 번호표 "(1)"나 따옴표를 그대로 붙이는 경우가 있다(실측).
    const lines = raw.exampleLines.map((l) =>
      l
        .trim()
        .replace(/^\(?\d+[).]\s*/, '')
        .replace(/^["“”'‘’]+|["“”'‘’]+$/g, '')
        .trim(),
    ).map((l) => limitLaughter(l, i.cast.speech.laughter))
    for (const line of lines) {
      const issues = checkDialogue({ text: line, speakerName: i.cast.name, maxChars: 70, unknownNames: [], recentOwn: [] }, ctx.config.validation)
      if (issues.length > 0) return { issues }
    }
    // 처음 만난 사이의 예시 대사는 존댓말이어야 한다. 반말 예시는 실제 대화도 반말로 끌고 간다(실측).
    if (lines.filter(isPolite).length < 3 || lines.some((l) => hasCasualWord(l))) return { issues: ['not_polite'] }
    if (hasForeignScript(raw.speechDescription)) return { issues: ['foreign_script'] }
    if (SPEECH_TOPIC.test(raw.speechDescription) || !DESCRIPTIVE_END.test(raw.speechDescription.trim())) return { issues: ['bad_description'] }
    const overlap = lines.filter((l) => i.othersLines.some((o) => similarity(o, l) >= 0.5)).length
    if (overlap >= 2) return { issues: ['persona_overlap'] }
    const description = i.cast.speech.laughter >= LAUGH_THRESHOLD ? raw.speechDescription.trim() : limitLaughter(raw.speechDescription.replace(/['"]?ㅋ+['"]?(를|와|나|도)?/g, ''), 0)
    return { value: { speechDescription: description, exampleLines: lines } }
  },
}
