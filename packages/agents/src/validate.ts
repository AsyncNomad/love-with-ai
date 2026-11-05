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
  | 'self_third_person'
  | 'self_honorific'
  | 'grammar'
  | 'address'
  | 'stock_phrase'

export interface DialogueCheckInput {
  text: string
  /** 그 자리의 모든 상대와 존댓말 사이인가(design.md D13). 참이면 반말 어미를 거부한다. */
  mustBePolite?: boolean
  speakerName: string
  maxChars: number
  unknownNames: readonly string[]
  recentOwn: readonly string[]
  /** 화자가 아는 다른 참가자의 전체 이름. 반말 호칭("수아야") 판정과 영어 이름 허용에 쓴다. */
  knownNames?: readonly string[]
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

/**
 * 소형 모델이 자주 틀리는 1인칭 조사(실측: "저가 베이킹을…", "제가도 좋아해요", "제가랑은"). 고쳐 넣지 않고 감지만 한다.
 * 서버가 낱말을 바꿔 넣으면 그 인물이 한 말이 아니게 된다(qa-rules.md 1.3). 걸리면 다시 쓰게 한다.
 */
export function hasParticleError(text: string): boolean {
  return /(^|[\s,])저가(?=\s)|제가도|제가랑/.test(text)
}

/** 문장 단위로 나눈다(마침표·물음표·느낌표·물결 뒤 공백). */
export function sentencesOf(text: string): string[] {
  const out: string[] = []
  for (const part of text.split(/(?<=[.!?~])\s+/).map((s) => s.trim())) {
    if (part.length === 0) continue
    // 이모티콘·웃음만 있는 조각은 앞 문장에 붙인다(그 문장과 함께 남거나 지워진다).
    if (!/[가-힣A-Za-z0-9]/.test(part) && out.length > 0) out[out.length - 1] += ` ${part}`
    else out.push(part)
  }
  return out
}

/**
 * 이 방에서 최근에 나온 문장(본인·다른 사람 모두)을 되풀이한 문장을 지운다.
 * 실측: 다른 참가자의 말을 이모티콘까지 그대로 옮기거나("저도요! 제가 주말에 러닝도 해요. 😄"),
 * 매 메시지 끝에 같은 문장("지수 씨랑 함께 뛰는 게 정말 좋겠네요")을 붙였다. 메시지 전체 유사도로는 잡히지 않는다.
 * 남는 문장이 없으면 빈 문자열을 돌려준다(호출자가 반복으로 거부한다).
 */
export function dropEchoedSentences(text: string, recent: readonly string[], threshold = 0.6): string {
  const seen = recent.flatMap(sentencesOf).filter((s) => s.replace(/\s/g, '').length >= 8)
  if (seen.length === 0) return text
  const all = sentencesOf(text)
  const kept = all.filter((s) => s.replace(/\s/g, '').length < 8 || !seen.some((r) => isRepeat(r, s, threshold) || similarity(r, s) >= threshold))
  // 지우고 나서 "그리고요." 같은 짧은 조각만 남으면 말이 안 된다(실측). 통째로 반복으로 본다.
  if (kept.length < all.length && kept.join('').replace(/\s/g, '').length < 8) return ''
  return kept.join(' ')
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
  const known = input.knownNames ?? []
  if (hasForeignScript(text) || hasEnglishWord(text, known)) issues.push('foreign_script')
  if (input.mustBePolite && (isCasual(text) || hasCasualWord(text, known))) issues.push('speech_level')
  const recent = input.recentOwn.slice(-cfg.repetitionWindow)
  if (recent.some((r) => isRepeat(r, text, cfg.repetitionThreshold))) issues.push('repetition')
  return issues
}

/**
 * 한국어 출력에 섞인 한자·가나를 찾는다. 다국어 모델(Qwen)에서 실측으로 나온 누출이다
 * (예: "필라테스课上"). 라틴 문자는 닉네임·영단어로 흔히 쓰이므로 허용한다.
 */
export function hasForeignScript(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text)
}

/**
 * 한국어 문장 속 소문자 영단어(실측: "많은 people 만나는"). 대문자로 시작하는 이름·약어(Jay, MBTI)와
 * 아는 참가자 이름은 허용한다.
 */
export function hasEnglishWord(text: string, allowed: readonly string[] = []): boolean {
  const ok = new Set(allowed.map((a) => a.toLowerCase()))
  return (text.match(/(?<![A-Za-z])[a-z]{3,}(?![A-Za-z])/g) ?? []).some((w) => !ok.has(w))
}

const POLITE_ENDING = /(요|니다|니까|세요|죠|에요|예요|군요|네요|래요|까요)[.!?~ㅋㅎ\s]*$/

/** 존댓말로 끝나는 문장인가(대략적인 판정). */
export function isPolite(text: string): boolean {
  return POLITE_ENDING.test(text.trim())
}

const TAIL = String.raw`\s*[.!?~ㅋㅎ,\s]*$`
const CASUAL_ENDING = new RegExp(String.raw`(?:[다야자어아해지냐니래게걸까러봐줘와돼워든군]|(?<=[가-힣])네|구나)` + TAIL)
/** 마지막이 아닌 문장에서 반말로 보는 어미. "맛있겠다!" 같은 혼잣말 감탄(-다)은 존댓말 사이에서도 흔해서 뺀다. */
const STRONG_CASUAL_ENDING = new RegExp(String.raw`(?:[야자어아해지냐줘워까니]|(?<=[가-힣])네|거든|구나)` + TAIL)

/**
 * 분명한 반말 어미로 끝나는 문장이 있는가. 감탄사·짧은 반응("ㅋㅋㅋ", "오 진짜", "네!")은 반말로 보지 않는다.
 * 마지막 문장만 보면 "야, 귀엽네. 같이 가요?" 같은 섞어 쓰기를 놓친다(실측). 앞 문장은 분명한 어미만 본다.
 */
export function isCasual(text: string): boolean {
  // "이름만 알면 돼. ㅋㅋ"처럼 웃음만 따로 붙은 조각은 걷어 낸다(실측).
  const sentences = text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((s) => /[가-힣]/.test(s))
  const last = sentences.at(-1) ?? ''
  if (!isPolite(last) && !NOT_CASUAL.test(last) && CASUAL_ENDING.test(last)) return true
  return sentences.slice(0, -1).some((s) => (s.match(/[가-힣]/g) ?? []).length >= 2 && !isPolite(s) && !NOT_CASUAL.test(s) && STRONG_CASUAL_ENDING.test(s))
}

/**
 * 반말 어미처럼 끝나지만 존댓말 대화에서도 자연스러운 끝맺음. 감탄 반응("아, 여행 계획이라니."), 청유("~합시다"),
 * 이음 조각("전시회도 충분히 봤으니.")이다. 실측(10·11회차): 반말 거부의 약 3분의 1이 이것이었다.
 */
// 이음 조각("~그런지.")은 물음표로 끝나면 반말 의문("뭐 했는지?")일 수 있어 물음표 없이만 허용한다.
const NOT_CASUAL = /(라니|으니|[가-힣]니까|[ㅂ읍]시다|합시다|갑시다|봅시다)[.!?~\s]*$|[는런인한던]지[.!~\s]*$/

const EDGE = String.raw`(?:^|[\s,.!?~])`
const END = String.raw`(?=$|[\s,.!?~])`
/** 어미가 존댓말이어도 반말인 낱말(실측: "안녕, 저는 ~예요", "야, ~", "내 손톱이"). */
const CASUAL_WORD = new RegExp(`${EDGE}(?:안녕|야|나는|난|내가|나도|나랑|나한테|나를|내|너는|넌|네가|너도|니가|너랑|너한테|너를)${END}`)

/** 반말 낱말이나 반말 호칭("수아야", "우진아")이 있는가. */
export function hasCasualWord(text: string, knownNames: readonly string[] = []): boolean {
  if (CASUAL_WORD.test(text)) return true
  return knownNames
    .map(givenName)
    .filter((g) => /^[가-힣]+$/.test(g))
    .some((g) => new RegExp(`${EDGE}${g}(?:아|야)${END}`).test(text))
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function nameForms(names: readonly string[]): string[] {
  return [...new Set(names.flatMap((n) => [n, givenName(n)]))]
    .filter((f) => f.length > 0)
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
}

/**
 * 번역투 호칭 정리. 소형 모델은 영어처럼 "수아, 주말엔 ~", "개발자님, ~"처럼 이름·호칭을 맨 앞에 불러 말을 건다(실측).
 * 메시지 맨 앞의 호칭은 지운다(지우기만 하고 바꿔 넣지 않는다, qa-rules.md 1.3).
 */
export function fixAddress(text: string, names: readonly string[]): string {
  const forms = nameForms(names)
  // 이름이 아닌 호칭("개발자님, ~")도 맨 앞이면 지운다(실측: 직업으로 불렀다).
  const titleLead = /^\s*[가-힣A-Za-z]{2,8}\s?님\s*[,!]\s*/
  if (forms.length === 0) return text.replace(titleLead, '').trim()
  const alt = forms.join('|')
  const lead = new RegExp(String.raw`^\s*(?:${alt})(?:\s*(?:씨|님)|아|야)?\s*[,!~]+\s*`)
  let out = text
  for (let i = 0; i < 3 && (lead.test(out) || titleLead.test(out)); i++) out = out.replace(lead, '').replace(titleLead, '')
  return out.trim()
}

/** 문장 중간에 이름만 덩그러니 부른 호칭("안녕하세요, 우진!")을 감지한다. 존댓말 사이에서 걸리면 다시 쓰게 한다. */
export function hasBareNameAddress(text: string, names: readonly string[]): boolean {
  const forms = nameForms(names)
  if (forms.length === 0) return false
  return new RegExp(String.raw`(^|[\s,])(${forms.join('|')})(?=\s*[,.!?~]|$)`).test(text)
}

/**
 * 웃음 표현(ㅋ·ㅎ) 정리. 소형 모델은 인물 설정과 상관없이 "ㅋㅋ"를 남발한다(실측). 프롬프트만으로는 막히지 않아 코드로 강제한다.
 * - 웃음을 잘 안 쓰는 인물(laughter < LAUGH_THRESHOLD): 모두 지운다.
 * - 잘 쓰는 인물: "ㅋㅋㅋㅋ" 같은 연속은 두 글자로 줄이고, 한 메시지에 한 번만 남긴다.
 */
export const LAUGH_THRESHOLD = 0.65

export function limitLaughter(text: string, laughter: number): string {
  let out: string
  if (laughter < LAUGH_THRESHOLD) {
    out = text.replace(/[ㅋㅎ]+/g, '')
  } else {
    let kept = false
    out = text.replace(/[ㅋㅎ]+/g, (m) => {
      if (kept) return ''
      kept = true
      return m.slice(0, 2)
    })
  }
  return out
    .replace(/\s+([.,!?~])/g, '$1')
    .replace(/([.!?])\s*\./g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function grams(s: string): Set<string> {
  const t = s.replace(/\s+/g, '')
  const out = new Set<string>()
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3))
  return out
}

/**
 * 반복 판정. 전체 유사도(Jaccard)뿐 아니라, 한쪽이 다른 쪽을 거의 포함하는 경우도 잡는다
 * (실측: 직전 발언에 질문 한 줄을 덧붙인 메시지가 Jaccard 기준을 빠져나갔다).
 */
export function isRepeat(prev: string, next: string, threshold: number): boolean {
  if (similarity(prev, next) >= threshold) return true
  const a = grams(prev)
  const b = grams(next)
  if (a.size < 8 || b.size < 8) return false
  let inter = 0
  for (const g of a) if (b.has(g)) inter++
  return inter / Math.min(a.size, b.size) >= 0.8
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

/**
 * 하루가 끝나지 않았는데 하루를 다 보낸 것처럼 묻거나 말하는 문장(실측: 아침 9시에 여럿이 "오늘 하루도 편안하게 보내셨나요?").
 * 저녁(18시) 전에는 이런 문장을 지운다.
 */
const DAY_OVER = /오늘 하루(는|도|가)?[^.?!]{0,12}(보내셨|보냈|지났|지나갔|어떠셨|어땠|괜찮으셨|마무리)/

export function dropDayOverSentences(text: string, hour: number): string {
  if (hour >= 18) return text
  return sentencesOf(text)
    .filter((s) => !DAY_OVER.test(s))
    .join(' ')
}

const EMOJI = /\p{Extended_Pictographic}\uFE0F?/gu

export function hasEmoji(text: string): boolean {
  return new RegExp(EMOJI.source, 'u').test(text)
}

/** 이모티콘을 지운다. 직전 메시지에 이모티콘을 썼으면 이번에는 쓰지 않게 하는 데 쓴다(실측: 모든 메시지에 😊). */
export function stripEmoji(text: string): string {
  return text.replace(EMOJI, '').replace(/\s{2,}/g, ' ').trim()
}

/**
 * 남이 방금 한 말을 자기 이야기처럼 가져가는 문장(실측: 사람이 "계획은 숙소 정도만 잡아요" → AI "저도 계획은 숙소 정도만 잡는 편이라서",
 * "제가 숙소 정도만 잡는 편이라서"). "저도·제가·저는"으로 시작하고 남의 최근 말과 3-gram이 절반 넘게, 또는 6개 이상 겹치면 지운다.
 */
export function dropMirroredSentences(text: string, othersRecent: readonly string[]): string {
  const theirs = othersRecent.map(grams).filter((g) => g.size >= 6)
  if (theirs.length === 0) return text
  const all = sentencesOf(text)
  const kept = all.filter((s) => {
    const m = /^\s*(저도|제가|저는|저 역시)\s*/.exec(s)
    if (!m) return true
    const mine = grams(s.slice(m[0].length))
    if (mine.size < 6) return true
    return !theirs.some((g) => {
      let inter = 0
      for (const x of mine) if (g.has(x)) inter++
      // 비율만 보면 덧붙인 절 때문에 빠져나간다. 8글자 넘는 같은 구절(3-gram 6개)이 있으면 가져온 것으로 본다.
      return inter >= 6 || inter / Math.min(mine.size, g.size) >= 0.5
    })
  })
  if (kept.length < all.length && kept.join('').replace(/\s/g, '').length < 8) return ''
  return kept.join(' ')
}

/** 자기 자신에게 높임말을 쓴 문장(실측: "저도 요즘은 커피보다 차를 더 많이 드시네요"). */
const SELF_HONORIFIC = /(저는|저도|제가|저 역시)[^.?!]{0,24}(드시|하시|계시|주무시|가시|오시|보시|좋아하시)(네요|어요|고 있|죠|는데요|면서)/

export function hasSelfHonorific(text: string): boolean {
  return sentencesOf(text).some((s) => SELF_HONORIFIC.test(s) && !/씨|님/.test(s))
}
