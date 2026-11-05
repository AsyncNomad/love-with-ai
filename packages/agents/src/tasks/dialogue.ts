import { z } from 'zod'
import type { ParticipantId, RoomId, SpeechProposalKind } from '@heart/shared'
import { ageRelation } from '@heart/engine'
import { ObservationView } from '../observation'
import { COMMON_RULES, conversationSection, joinSections, memorySection, peopleSection, personaSection, sharedHistorySection, situationSection } from '../prompts'
import type { TaskSpec } from '../task'
import {
  checkDialogue,
  dropDayOverSentences,
  dropEchoedSentences,
  dropMirroredSentences,
  fitLength,
  fixAddress,
  hasBareNameAddress,
  hasEmoji,
  hasParticleError,
  hasCasualWord,
  hasSelfHonorific,
  isCasual,
  limitLaughter,
  normalizeUtterance,
  sentencesOf,
  stripEmoji,
} from '../validate'

export type DialogueMode = 'reply' | 'start_topic' | 'greeting' | 'newcomer_greeting' | 'open_private' | 'wrap_up' | 'follow_up' | 'propose_casual'

export interface DialogueInput {
  speakerId: ParticipantId
  roomId: RoomId
  mode: DialogueMode
  /** 1:1(사람 수 2)인지. 길이 상한이 달라진다. */
  isPrivate: boolean
  /** propose_casual일 때: 누구에게 어떤 말 놓기를 제안하는지(game-rules.md §11.3). 서버가 조건을 판정해서 준다. */
  speechOffer?: { targetId: ParticipantId; kind: SpeechProposalKind }
}

export interface DialogueOutput {
  text: string | null
}

const INSTRUCTIONS: Record<DialogueMode, string> = {
  reply: '대화 흐름에 맞게 다음 말을 한 마디 해라. 방금 나온 말에 대답하거나 반응하는 것이 먼저다. 할 말이 없으면 침묵해도 된다.',
  follow_up: '방금 나온 말에 자연스럽게 이어서 한 마디 해라. 굳이 할 말이 없으면 침묵해라.',
  start_topic: '대화가 잠시 끊겼다. 지금 장소나 방금까지 나온 얘기와 이어지는 가벼운 화제를 꺼내라. 이미 나온 얘기를 반복하지 마라.',
  greeting: '방금 숙소 거실에 처음 들어왔다. 먼저 와 있던 사람들에게 짧게 인사하고 이름을 말해라. 나이나 직업은 아직 말하지 않는다.',
  newcomer_greeting: '둘째 날 새 입주자로 숙소 거실에 들어왔다. 먼저 와 있던 사람들에게 인사하고 이름, 나이, 직업을 짧게 소개해라.',
  open_private: '단둘이 이야기할 시간이 생겼다. 상대에게 먼저 가볍게 말을 건다. 상대에 대해 궁금했던 것이나 아까 나눈 이야기를 한 문장으로 꺼낸다. 하루를 정리하는 긴 소감은 말하지 않는다.',
  propose_casual: '이 사람과 이야기가 꽤 편해졌다.',
  wrap_up: '대화 시간이 곧 끝난다. 새 화제를 꺼내지 말고 자연스럽게 마무리하는 말을 해라.',
}

/** 소형 모델이 돌려 쓰는 상투적 표현(감지용, 실측). 최근 대화에 여러 번 나왔는데 또 쓰면 다시 쓰게 한다. */
const STOCK_PHRASES = ['오늘 하루', '편안하', '분위기', '시간이 빨리', '기억에 남', '다행']

/**
 * 말 놓기 제안의 상황 설명(game-rules.md §11.3). 무엇을 제안하는지만 알리고 문구는 주지 않는다(qa-rules.md 1.2).
 * 제안 자체는 아직 존댓말로 한다.
 */
function offerNote(view: ObservationView, i: DialogueInput): string {
  const offer = i.speechOffer
  if (i.mode !== 'propose_casual' || !offer) return ''
  const name = view.label(offer.targetId)
  const age = ageRelation(view.self().cast.age, view.known(offer.targetId).age) ?? ''
  const what =
    offer.kind === 'mutual'
      ? '서로 말을 편하게 하자고 제안한다'
      : offer.kind === 'ask'
        ? '네가 말을 편하게 해도 되는지 조심스럽게 묻는다'
        : '상대에게 너한테는 편하게 말을 놓으라고 권한다'
  return ` 상대: ${name}(${age}). 지금 ${what}. 그 말 한 마디만 하고, 아직은 존댓말로 말한다.`
}

function metooCount(texts: readonly string[]): number {
  return texts.filter((t) => /^\s*저도/.test(t)).length
}

function hourOf(sim: string): number {
  const m = /^D\d (\d{2}):/.exec(sim)
  return m ? Number(m[1]) : 12
}

export const dialogueTask: TaskSpec<DialogueInput, { action: 'speak' | 'silent'; text: string }, DialogueOutput> = {
  id: 'dialogue',
  ownerOf: (i) => i.speakerId,
  sampling: (ctx, i) => {
    const base = ctx.config.llm.dialogue
    const offset = ctx.state.participants.get(i.speakerId)?.cast.speech.temperatureOffset ?? 0
    return { ...base, temperature: Math.max(0.1, base.temperature + offset) }
  },
  maxTokens: (ctx) => ctx.config.llm.maxTokens.dialogue ?? 120,
  // 무엇이 문제였는지 알리고, 걸린 문장이 있으면 모델 자신의 문장을 그대로 짚어 준다.
  // 새 낱말이나 예시를 주지 않는다(qa-rules.md 1.2). 막연한 지시만으로는 같은 실수를 되풀이했다(실측: 반말 거부 22건).
  retryHint: (issues, rejected) => {
    const quote = (pred: (s: string) => boolean): string => {
      const hit = rejected ? sentencesOf(rejected.text).find(pred) : undefined
      return hit ? ` 걸린 문장: "${hit}"` : ''
    }
    const hints: string[] = []
    if (issues.includes('repetition')) hints.push('방금 쓴 말은 이미 이 방에서 나온 말과 겹친다. 같은 이야기를 되풀이하지 말고 새로운 말을 하거나, 할 말이 없으면 침묵한다.')
    if (issues.includes('speech_level')) hints.push(`방금 쓴 말에 반말이 섞였다. 처음부터 끝까지 존댓말로 쓴다.${quote((s) => isCasual(s) || hasCasualWord(s))}`)
    if (issues.includes('too_long')) hints.push('방금 쓴 말이 너무 길다. 한 문장으로 짧게 쓴다.')
    if (issues.includes('foreign_script')) hints.push('한국어로만 쓴다.')
    if (issues.includes('self_third_person')) hints.push('기억을 읽어 주듯 해설하지 말고, 네가 직접 상대에게 하는 말로 쓴다. 자기 이름을 3인칭으로 쓰지 않는다.')
    if (issues.includes('self_honorific')) hints.push(`방금 쓴 말에서 자기 자신의 행동에 높임 표현을 썼다. 자기 일은 높이지 않고 쓴다.${quote(hasSelfHonorific)}`)
    if (issues.includes('stock_phrase')) hints.push('방금 쓴 말에 네가 최근에 이미 쓴 표현이 또 들어 있다. 같은 표현을 되풀이하지 말고 다르게 쓴다.')
    if (issues.includes('grammar')) hints.push(`방금 쓴 말에 1인칭 조사가 틀린 곳이 있다. 문법에 맞게 다시 쓴다.${quote(hasParticleError)}`)
    if (issues.includes('address')) hints.push('상대 이름만 덩그러니 불렀다. 이름을 부르지 않거나 자연스러운 호칭으로 쓴다.')
    if (issues.includes('time_mismatch')) hints.push('지금은 하루가 끝나지 않았다. 하루를 다 보낸 것처럼 묻거나 말하지 않는다.')
    return hints.length > 0 ? hints.join(' ') : null
  },
  schema: (i) => {
    const mustSpeak = i.mode === 'greeting' || i.mode === 'newcomer_greeting' || i.mode === 'open_private' || i.mode === 'propose_casual'
    return z.object({
      action: mustSpeak ? z.literal('speak') : z.enum(['speak', 'silent']),
      text: z.string().max(240),
    })
  },
  build: (i, ctx) => {
    const view = new ObservationView(ctx.state, i.speakerId, ctx.config)
    const others = view.presentOthers(i.roomId)
    const maxChars = i.isPrivate ? ctx.config.validation.maxChars.private : ctx.config.validation.maxChars.group
    const firstMeeting = others.length > 0 && others.every((id) => view.speechLevel(id) === 'polite' && view.speechLevelFrom(id) === 'polite')
    // 처음 만난 사이에 취미·주말 같은 질문을 갑자기 던지는 경우가 많았다(실측). 자리에 맞는 화제를 알려 준다.
    const meetingHint = !firstMeeting
      ? ''
      : i.mode === 'start_topic'
        ? '\n아직 서로 잘 모르는 사이라 존댓말을 쓴다. 처음 만난 자리에 어울리는 가벼운 얘기를 한다.'
        : '\n아직 서로 잘 모르는 사이라 존댓말을 쓴다.'
    // 같은 취미 이야기로 맴도는 것을 막는다(실측: 3일 내내 러닝·와인). 새 화제를 꺼낼 때는 피하고, 대답할 때는 되풀이하지 않는다.
    const worn = view.wornTopics(ctx.config.pools.interests.map((x) => x.split(' ')[0] ?? x))
    const topicHint =
      worn.length === 0
        ? ''
        : i.mode === 'start_topic' || i.mode === 'open_private'
          ? `\n이미 여러 번 나온 화제(${worn.join(', ')})는 꺼내지 않고 다른 이야기를 한다.`
          : `\n${worn.join(', ')} 이야기는 이미 많이 했다. 상대가 먼저 꺼내지 않으면 다시 꺼내지 않는다.`
    // 장소 이름을 메시지마다 되풀이하는 경우가 많았다(실측: 데이트 내내 "바닷가 카페에서"). 이미 두 번 말했으면 그만 말하게 한다.
    // 맞장구("저도요", "저도 ~해요")로만 이어지는 대화를 막는다. 실측: 3일차 거실에서 셋 중 하나가 "저도"로 시작했다.
    const mirroring = metooCount(view.roomMessages(i.roomId, 6, 1200).map((m) => m.text)) >= 2
    const metooHint = mirroring ? '\n맞장구만 이어지고 있다. 따라 하지 말고 네 생각이나 상대와 다른 점을 말한다.' : ''
    // 상투 표현은 목록을 프롬프트에 적지 않는다(금지 낱말을 보여 주면 오히려 떠오른다, qa-rules.md 1.2). 반복됐다는 사실만 알리고, 쓰면 출력 검증에서 다시 쓰게 한다.
    const stock = view.wornTopics(STOCK_PHRASES, 30, 3)
    const stockHint = stock.length > 0 ? '\n최근 대화에 같은 표현이 여러 번 되풀이됐다. 남이 쓴 표현을 따라 쓰지 않는다.' : ''
    const place = view.roomLocation(i.roomId)
    const placeHint =
      i.roomId !== 'living' && view.ownRecentMessages(6).filter((t) => t.includes(place)).length >= 2 ? `\n${place} 이야기는 이미 했다. 장소 이야기를 또 꺼내지 않는다.` : ''
    const system = joinSections(
      COMMON_RULES,
      personaSection(view),
      `[출력 규칙]\nJSON으로만 답한다. 말할 때는 {"action":"speak","text":"..."}, 침묵할 때는 {"action":"silent","text":""}.\n실제 메신저처럼 한두 문장, ${maxChars}자 이내로 쓴다. 매번 질문으로 끝내지 않는다. 웃음 표현(ㅋㅋ)은 인물 설정에 있을 때만 쓴다.`,
    )
    const user = joinSections(
      situationSection(view, i.roomId),
      peopleSection(view, ctx, others),
      sharedHistorySection(view),
      memorySection(view, ctx, others),
      conversationSection(view, ctx, i.roomId),
      `[지금 할 일]\n${INSTRUCTIONS[i.mode]}${offerNote(view, i)}${i.mode === 'propose_casual' ? '' : `${meetingHint}${topicHint}${stockHint}${metooHint}${placeHint}`}`,
    )
    const self = view.self().cast
    return { system, user, view, meta: { mode: i.mode, speakerName: self.name, roomId: i.roomId } }
  },
  finish: (raw, i, ctx, built) => {
    if (raw.action === 'silent') return { value: { text: null } }
    const view = built.view as ObservationView
    const cast = ctx.state.participants.get(i.speakerId)?.cast
    const speakerName = cast?.name ?? ''
    const maxChars = i.isPrivate ? ctx.config.validation.maxChars.private : ctx.config.validation.maxChars.group
    // 존댓말을 쓰는 상대가 한 명이라도 있으면 존댓말이어야 한다(game-rules.md §11.6). 서로 놓자는 제안에 받아들이며 하는 첫 반말은 응답 작업이 따로 다룬다.
    const mustBePolite = view.presentOthers(i.roomId).some((id) => view.speechLevel(id) === 'polite')
    const knownNames = [...view.knownNames()]
      .filter((id) => id !== i.speakerId)
      .map((id) => view.known(id).name)
      .filter((n): n is string => n !== null)
    const addressed = fixAddress(normalizeUtterance(raw.text, speakerName), knownNames)
    const laughed = limitLaughter(addressed, cast?.speech.laughter ?? 0)
    if (laughed.length === 0) return { value: { text: null } }
    // 이 방의 최근 문장(누가 했든)을 되풀이한 문장은 지운다. 다 지워지면 반복으로 거부하고 다시 만든다.
    const recentRoom = view.roomMessages(i.roomId, 10, 2000).filter((m) => m.speakerId !== 'pd').map((m) => m.text)
    const othersRecent = view.roomMessages(i.roomId, 3, 600).filter((m) => m.speakerId !== 'pd' && !m.isSelf).map((m) => m.text)
    const deduped = dropMirroredSentences(dropEchoedSentences(laughed, recentRoom), othersRecent)
    if (deduped.length === 0) return { issues: ['repetition'] }
    const timed = dropDayOverSentences(deduped, hourOf(ctx.state.simTime))
    if (timed.length === 0) return { issues: ['time_mismatch'] }
    const lastOwn = view.ownRecentMessages(1)[0]
    const normalized = lastOwn && hasEmoji(lastOwn) ? stripEmoji(timed) : timed
    if (normalized.length === 0) return { value: { text: null } }
    const fitted = fitLength(normalized, maxChars) ?? normalized
    const issues = checkDialogue(
      {
        text: fitted,
        speakerName,
        maxChars,
        unknownNames: view.unknownNames(),
        recentOwn: view.ownRecentMessages(ctx.config.validation.repetitionWindow),
        mustBePolite,
        knownNames,
      },
      ctx.config.validation,
    )
    // 실측: 기억 요약 문장을 대사로 옮겨 "송건우 씨는 …, 김하린과 여행 이야기를 나누며 …"처럼 자기를 3인칭으로 해설했다.
    // 인사·자기소개가 아닌데 자기 전체 이름이 나오면 해설로 보고 다시 쓰게 한다.
    // "저 김하린입니다"(자기소개)는 괜찮고, "김하린과 …", "김하린은 …"처럼 3인칭 조사가 붙으면 해설이다.
    if (hasSelfHonorific(fitted)) issues.push('self_honorific')
    if (hasParticleError(fitted)) issues.push('grammar')
    if (mustBePolite && hasBareNameAddress(fitted, knownNames)) issues.push('address')
    // 방 전체에서 흔해진 표현을 누가 쓰든 거부하면 너무 엄격했다(실측: 거부 16건, 생성 실패 증가).
    // 방에서 되풀이되고 있고, 이 사람도 최근에 이미 쓴 표현을 또 쓸 때만 다시 쓰게 한다(감지·거부만 한다, qa-rules.md 2).
    const worn = view.wornTopics(STOCK_PHRASES, 30, 3)
    const ownRecent = view.ownRecentMessages(5)
    if (worn.some((p) => fitted.includes(p) && ownRecent.some((t) => t.includes(p)))) issues.push('stock_phrase')
    if (speakerName.length > 0 && new RegExp(`${speakerName}(과|와|은|는|이가|의|을|를|에게|한테|씨)`).test(fitted)) issues.push('self_third_person')
    return issues.length > 0 ? { issues } : { value: { text: fitted } }
  },
}
