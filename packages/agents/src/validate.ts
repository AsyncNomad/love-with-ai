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

export interface DialogueCheckInput {
  text: string
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
  const recent = input.recentOwn.slice(-cfg.repetitionWindow)
  if (recent.some((r) => similarity(r, text) >= cfg.repetitionThreshold)) issues.push('repetition')
  return issues
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
