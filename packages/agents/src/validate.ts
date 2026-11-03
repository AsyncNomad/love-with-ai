import type { ValidationConfig } from '@heart/shared'
import { containsName, givenName } from '@heart/engine'

/** design.md §7.5: 규칙 기반 출력 검증. 의미 판정은 하지 않는다(D8). */

export type IssueCode =
  | 'empty'
  | 'too_long'
  | 'impersonation_line'
  | 'system_impersonation'
  | 'unknown_name'
  | 'repetition'
  | 'intro_mismatch'
  | 'bad_choice'
  | 'foreign_script'
  | 'speech_level'

export interface DialogueCheckInput {
  text: string
  /** 그 자리의 모든 상대와 존댓말 사이인가(design.md D13). 참이면 반말 어미를 거부한다. */
  mustBePolite?: boolean
  speakerName: string
  maxChars: number
  unknownNames: readonly string[]
  recentOwn: readonly string[]
}

const SPEAKER_LABEL = /^\s*[[(]?([가-힣A-Za-z]{1,8})[\])]?\s*[:：]\s*/

/** 모델이 흔히 붙이는 자기 이름표·따옴표·줄바꿈을 정리한다. 다른 사람 이름표는 남겨서 검증에서 걸리게 한다. */
export function normalizeUtterance(raw: string, speakerName: string): string {
  const unquote = (t: string): string => t.trim().replace(/^["“”']+|["“”']+$/g, '').trim()
  let text = unquote(raw)
  const m = SPEAKER_LABEL.exec(text)
  if (m && (m[1] === speakerName || m[1] === givenName(speakerName))) text = unquote(text.slice(m[0].length))
  return text.replace(/\s*\n+\s*/g, ' ').trim()
}

/** 문장 경계에서 잘라 길이를 맞춘다. 자를 수 없으면 null. */
export function fitLength(text: string, maxChars: number): string | null {
  if (text.length <= maxChars) return text
  const head = text.slice(0, maxChars)
  const cut = Math.max(...['. ', '? ', '! ', '~ ', '요 ', 'ㅋ '].map((d) => head.lastIndexOf(d)))
  if (cut >= maxChars * 0.4) return head.slice(0, cut + 1).trim()
  return null
}

export function checkDialogue(input: DialogueCheckInput, cfg: ValidationConfig): IssueCode[] {
  const issues: IssueCode[] = []
  const { text } = input
  if (text.trim().length === 0) return ['empty']
  if (text.length > input.maxChars) issues.push('too_long')
  if (SPEAKER_LABEL.test(text) || /\s[가-힣]{2,4}\s*[:：]\s/.test(text)) issues.push('impersonation_line')
  if (cfg.impersonationPatterns.some((p) => new RegExp(p).test(text))) issues.push('system_impersonation')
  if (input.unknownNames.some((n) => containsName(text, n))) issues.push('unknown_name')
  if (hasForeignScript(text)) issues.push('foreign_script')
  if (input.mustBePolite && isCasual(text)) issues.push('speech_level')
  const recent = input.recentOwn.slice(-cfg.repetitionWindow)
  if (recent.some((r) => similarity(r, text) >= cfg.repetitionThreshold)) issues.push('repetition')
  return issues
}

/**
 * 한국어 출력에 섞인 한자·가나를 찾는다. 다국어 모델(Qwen)에서 실측으로 나온 누출이다
 * (예: "필라테스课上"). 라틴 문자는 닉네임·영단어로 흔히 쓰이므로 허용한다.
 */
export function hasForeignScript(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text)
}

const POLITE_ENDING = /(요|니다|니까|세요|죠|에요|예요|군요|네요|래요|까요)[.!?~ㅋㅎ\s]*$/

/** 존댓말로 끝나는 문장인가(대략적인 판정). */
export function isPolite(text: string): boolean {
  return POLITE_ENDING.test(text.trim())
}

const CASUAL_ENDING = /[다야자어아해지냐니래게걸까러봐줘와돼워]\s*[.!?~ㅋㅎ,\s]*$/

/** 분명한 반말 어미로 끝나는가. 감탄사·짧은 반응("ㅋㅋㅋ", "오 진짜")은 반말로 보지 않는다. */
export function isCasual(text: string): boolean {
  // "이름만 알면 돼. ㅋㅋ"처럼 웃음만 따로 붙은 조각은 걷어 내고 마지막 진짜 문장으로 판정한다(실측).
  const sentences = text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((s) => /[가-힣]/.test(s))
  const last = sentences.at(-1) ?? ''
  return !isPolite(last) && CASUAL_ENDING.test(last)
}

/** 문자 3-gram Jaccard 유사도. */
export function similarity(a: string, b: string): number {
  const grams = (s: string): Set<string> => {
    const t = s.replace(/\s+/g, '')
    const out = new Set<string>()
    for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3))
    return out
  }
  const ga = grams(a)
  const gb = grams(b)
  if (ga.size === 0 || gb.size === 0) return a.trim() === b.trim() ? 1 : 0
  let inter = 0
  for (const g of ga) if (gb.has(g)) inter++
  return inter / (ga.size + gb.size - inter)
}
