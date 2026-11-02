import type { Command, ParticipantId, PromptView } from '@heart/shared'
import { validateBallot, type EligibilityRule } from '@heart/engine'
import type { House } from './house'
import type { HumanViewProjector } from './human-view'
import type { PauseController } from './pause'
import type { GameSession } from './session'

export type CommandResult = { ok: true } | { ok: false; error: string }

interface Pending<T> {
  prompt: PromptView
  resolve: (value: T | undefined) => void
}

/**
 * 사람의 명령 처리와 사람에게 묻는 선택(투표·초대·자기소개). 사람도 AI와 같은 검증을 거친다.
 * 사람이 쓴 "PD 공지: …" 같은 문장은 그냥 메시지다. 상태는 서버 이벤트로만 바뀐다.
 */
export class HumanGateway {
  private readonly votes = new Map<string, Pending<ParticipantId | null>>()
  private readonly invites = new Map<string, Pending<ParticipantId[]>>()
  private intro: Pending<string> | null = null
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
        const pending = this.votes.get(command.voteId)
        if (!pending) return { ok: false, error: 'no_open_vote' }
        const err = validateBallot(this.session.state, this.rule, command.voteId, this.humanId, command.targetId)
        if (err) return { ok: false, error: err }
        this.votes.delete(command.voteId)
        this.projector.resolvePrompt(pending.prompt.id)
        pending.resolve(command.targetId)
        return { ok: true }
      }
      case 'respondInvite': {
        const pending = this.invites.get(command.voteId)
        if (!pending || pending.prompt.kind !== 'invite') return { ok: false, error: 'no_open_invite' }
        const allowed = pending.prompt.candidateIds
        if (command.acceptIds.some((id) => !allowed.includes(id)) || command.acceptIds.length > pending.prompt.maxAccept) {
          return { ok: false, error: 'invalid_invite' }
        }
        this.invites.delete(command.voteId)
        this.projector.resolvePrompt(pending.prompt.id)
        pending.resolve([...new Set(command.acceptIds)])
        return { ok: true }
      }
      case 'submitIntro': {
        const pending = this.intro
        if (!pending) return { ok: false, error: 'no_intro_turn' }
        this.intro = null
        this.projector.resolvePrompt(pending.prompt.id)
        pending.resolve(command.text)
        return { ok: true }
      }
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

  requestVote(voteId: string, prompt: Omit<Extract<PromptView, { kind: 'vote' }>, 'id' | 'kind' | 'voteId'>): Promise<ParticipantId | null | undefined> {
    return new Promise((resolve) => {
      const full: PromptView = { id: `vote:${voteId}`, kind: 'vote', voteId, ...prompt }
      this.votes.set(voteId, { prompt: full, resolve })
      this.projector.upsertPrompt(full)
    })
  }

  requestInvite(voteId: string, candidateIds: ParticipantId[], maxAccept: number): Promise<ParticipantId[] | undefined> {
    return new Promise((resolve) => {
      const full: PromptView = { id: `invite:${voteId}`, kind: 'invite', voteId, candidateIds, maxAccept }
      this.invites.set(voteId, { prompt: full, resolve })
      this.projector.upsertPrompt(full)
    })
  }

  requestIntro(maxChars: number): Promise<string | undefined> {
    return new Promise((resolve) => {
      const full: PromptView = { id: 'intro', kind: 'intro', maxChars }
      this.intro = { prompt: full, resolve }
      this.projector.upsertPrompt(full)
    })
  }

  /** 응답 시간이 지나면 질문을 거두고 undefined로 끝낸다. */
  expire(kind: 'vote' | 'invite' | 'intro', voteId = ''): void {
    if (kind === 'vote') {
      const p = this.votes.get(voteId)
      if (!p) return
      this.votes.delete(voteId)
      this.projector.resolvePrompt(p.prompt.id)
      p.resolve(undefined)
    } else if (kind === 'invite') {
      const p = this.invites.get(voteId)
      if (!p) return
      this.invites.delete(voteId)
      this.projector.resolvePrompt(p.prompt.id)
      p.resolve(undefined)
    } else if (this.intro) {
      const p = this.intro
      this.intro = null
      this.projector.resolvePrompt(p.prompt.id)
      p.resolve(undefined)
    }
  }

  /** 사람이 이 방의 대화를 건너뛰면 resolve된다(game-rules.md §8.1). */
  skipSignal(roomId: string): { promise: Promise<void>; dispose: () => void } {
    let resolve!: () => void
    const promise = new Promise<void>((r) => (resolve = r))
    this.skipWaiters.set(roomId, resolve)
    return { promise, dispose: () => this.skipWaiters.delete(roomId) }
  }
}
