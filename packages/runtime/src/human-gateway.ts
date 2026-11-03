import type { Command, EpilogueView, ParticipantId, PromptView } from '@heart/shared'
import { containsName, validateBallot, type EligibilityRule } from '@heart/engine'
import type { House } from './house'
import type { HumanViewProjector } from './human-view'
import type { PauseController } from './pause'
import type { GameSession } from './session'

export type CommandResult = { ok: true } | { ok: false; error: string }

type PromptBody<K extends PromptView['kind']> = Omit<Extract<PromptView, { kind: K }>, 'id' | 'kind'>

interface Pending {
  prompt: PromptView
  resolve: (value: unknown) => void
}

export interface ActivityAnswer {
  first: string
  second: string
}

export interface TargetedText {
  targetId: ParticipantId | null
  text: string
}

/**
 * 사람의 명령 처리와 사람에게 묻는 선택(투표·초대·자기소개·활동·카드·우체통·에필로그).
 * 사람도 AI와 같은 검증을 거친다. 사람이 쓴 "PD 공지: …" 같은 문장은 그냥 메시지다. 상태는 서버 이벤트로만 바뀐다.
 * 열린 질문은 프롬프트 id로 관리한다. 응답 시간이 지나면 expire(id)로 거두고 undefined로 끝낸다.
 */
export class HumanGateway {
  private readonly pending = new Map<string, Pending>()
  private readonly skipWaiters = new Map<string, () => void>()
  private readonly handledCommands = new Map<string, CommandResult>()

  constructor(
    private readonly session: GameSession,
    private readonly house: House,
    private readonly projector: HumanViewProjector,
    private readonly pause: PauseController,
    private readonly rule: EligibilityRule,
  ) {}

  get humanId(): ParticipantId {
    const id = this.session.state.humanId
    if (!id) throw new Error('human not cast yet')
    return id
  }

  /** command_id 기준 멱등 처리. 같은 명령을 다시 보내도 결과는 한 번만 반영된다. */
  handle(commandId: string, command: Command): CommandResult {
    const prev = this.handledCommands.get(commandId)
    if (prev) return prev
    const result = this.dispatch(command)
    this.handledCommands.set(commandId, result)
    return result
  }

  private dispatch(command: Command): CommandResult {
    switch (command.type) {
      case 'createRun':
        return { ok: false, error: 'run_already_exists' }
      case 'sendMessage': {
        if (this.session.state.status !== 'running') return { ok: false, error: 'not_running' }
        return this.house.say(command.roomId, this.humanId, command.text, false) ? { ok: true } : { ok: false, error: 'not_in_room' }
      }
      case 'submitVote': {
        const id = `vote:${command.voteId}`
        if (!this.pending.has(id)) return { ok: false, error: 'no_open_vote' }
        const err = validateBallot(this.session.state, this.rule, command.voteId, this.humanId, command.targetId)
        if (err) return { ok: false, error: err }
        return this.answer(id, command.targetId)
      }
      case 'respondInvite': {
        const p = this.open('invite', `invite:${command.voteId}`)
        if (!p) return { ok: false, error: 'no_open_invite' }
        if (command.acceptIds.some((x) => !p.candidateIds.includes(x)) || command.acceptIds.length > p.maxAccept) return { ok: false, error: 'invalid_invite' }
        return this.answer(p.id, [...new Set(command.acceptIds)])
      }
      case 'submitIntro':
        return this.open('intro', 'intro') ? this.answer('intro', command.text) : { ok: false, error: 'no_intro_turn' }
      case 'chooseActivity': {
        const p = this.open('activity', 'activity')
        if (!p) return { ok: false, error: 'no_open_activity' }
        const ids = p.options.map((o) => o.id)
        if (!ids.includes(command.first) || !ids.includes(command.second) || command.first === command.second) return { ok: false, error: 'invalid_activity' }
        return this.answer(p.id, { first: command.first, second: command.second } satisfies ActivityAnswer)
      }
      case 'sendCard':
      case 'askQuestion': {
        const p = command.type === 'sendCard' ? this.open('card', 'card') : this.open('mailboxAsk', 'mailboxAsk')
        if (!p) return { ok: false, error: 'not_open' }
        if (command.targetId === null) return this.answer(p.id, { targetId: null, text: '' } satisfies TargetedText)
        if (!p.candidateIds.includes(command.targetId)) return { ok: false, error: 'ineligible_target' }
        const text = command.text.trim()
        if (text.length === 0 || text.length > p.maxChars) return { ok: false, error: 'invalid_text' }
        // 익명 카드에 자기 이름을 쓰면 거부한다(game-rules.md §5.5). AI와 같은 규칙이다.
        const me = this.session.state.participants.get(this.humanId)?.cast.name ?? ''
        if (command.type === 'sendCard' && containsName(text, me)) return { ok: false, error: 'sender_name' }
        return this.answer(p.id, { targetId: command.targetId, text } satisfies TargetedText)
      }
      case 'answerQuestion': {
        const p = this.open('mailboxAnswer', `answer:${command.questionId}`)
        if (!p) return { ok: false, error: 'no_open_question' }
        if (command.text.length > p.maxChars) return { ok: false, error: 'invalid_text' }
        return this.answer(p.id, command.text)
      }
      case 'closeEpilogue':
        return this.open('epilogue', 'epilogue') ? this.answer('epilogue', true) : { ok: false, error: 'no_epilogue' }
      case 'skipTalk': {
        const waiter = this.skipWaiters.get(command.roomId)
        if (!waiter) return { ok: false, error: 'not_skippable' }
        this.skipWaiters.delete(command.roomId)
        waiter()
        return { ok: true }
      }
      case 'resume': {
        if (!this.pause.has('afk') && !this.pause.has('llm_unavailable')) return { ok: false, error: 'not_paused' }
        this.pause.resume('afk')
        this.pause.resume('llm_unavailable')
        this.projector.resolvePrompt('resume')
        return { ok: true }
      }
    }
  }

  private open<K extends PromptView['kind']>(kind: K, id: string): Extract<PromptView, { kind: K }> | null {
    const p = this.pending.get(id)?.prompt
    return p && p.kind === kind ? (p as Extract<PromptView, { kind: K }>) : null
  }

  private answer(id: string, value: unknown): CommandResult {
    const p = this.pending.get(id)
    if (!p) return { ok: false, error: 'not_open' }
    this.pending.delete(id)
    this.projector.resolvePrompt(id)
    p.resolve(value)
    return { ok: true }
  }

  private ask<T>(prompt: PromptView): Promise<T | undefined> {
    return new Promise((resolve) => {
      this.pending.set(prompt.id, { prompt, resolve: resolve as (v: unknown) => void })
      this.projector.upsertPrompt(prompt)
    })
  }

  requestVote(voteId: string, body: Omit<PromptBody<'vote'>, 'voteId'>): Promise<ParticipantId | null | undefined> {
    return this.ask({ id: `vote:${voteId}`, kind: 'vote', voteId, ...body })
  }

  requestInvite(voteId: string, candidateIds: ParticipantId[], maxAccept: number): Promise<ParticipantId[] | undefined> {
    return this.ask({ id: `invite:${voteId}`, kind: 'invite', voteId, candidateIds, maxAccept })
  }

  requestIntro(maxChars: number): Promise<string | undefined> {
    return this.ask({ id: 'intro', kind: 'intro', maxChars })
  }

  requestActivity(options: PromptBody<'activity'>['options']): Promise<ActivityAnswer | undefined> {
    return this.ask({ id: 'activity', kind: 'activity', options })
  }

  requestCard(candidateIds: ParticipantId[], maxChars: number): Promise<TargetedText | undefined> {
    return this.ask({ id: 'card', kind: 'card', candidateIds, maxChars })
  }

  requestQuestion(candidateIds: ParticipantId[], maxChars: number): Promise<TargetedText | undefined> {
    return this.ask({ id: 'mailboxAsk', kind: 'mailboxAsk', candidateIds, maxChars })
  }

  requestAnswer(questionId: string, askerId: ParticipantId, question: string, maxChars: number): Promise<string | undefined> {
    return this.ask({ id: `answer:${questionId}`, kind: 'mailboxAnswer', questionId, askerId, question, maxChars })
  }

  /** 에필로그는 사람이 닫을 때까지 기다린다(game-rules.md §3 EPILOGUE). */
  showEpilogue(epilogue: EpilogueView): Promise<true | undefined> {
    return this.ask({ id: 'epilogue', kind: 'epilogue', epilogue })
  }

  /** 응답 시간이 지나면 질문을 거두고 undefined로 끝낸다. 이미 답했으면 아무것도 하지 않는다. */
  expire(promptId: string): void {
    const p = this.pending.get(promptId)
    if (!p) return
    this.pending.delete(promptId)
    this.projector.resolvePrompt(promptId)
    p.resolve(undefined)
  }

  /** 사람이 이 방의 대화를 건너뛰면 resolve된다(game-rules.md §8.1). */
  skipSignal(roomId: string): { promise: Promise<void>; dispose: () => void } {
    let resolve!: () => void
    const promise = new Promise<void>((r) => (resolve = r))
    this.skipWaiters.set(roomId, resolve)
    return { promise, dispose: () => this.skipWaiters.delete(roomId) }
  }
}
