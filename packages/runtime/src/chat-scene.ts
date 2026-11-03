import type { DialogueMode } from '@heart/agents'
import type { AnyEvent, GameConfig, ParticipantId, RoomId } from '@heart/shared'
import { findMentions, getRelationship, matchesInterest, pickSpeakers, type Rng, type SpeakerFeatures } from '@heart/engine'
import type { AgentService } from './agent-service'
import { Priority } from './gpu-queue'
import type { House } from './house'
import type { GameSession } from './session'
import type { Countdown, GameClock } from './timers'

export interface SceneDeps {
  session: GameSession
  house: House
  agents: AgentService
  clock: GameClock
  rng: Rng
  typing: (roomId: RoomId, participantIds: ParticipantId[]) => void
}

export interface SceneOptions {
  roomId: RoomId
  /** live: 사람이 보는 방(사람 입력에 반응). background: 사람이 없는 방(목표 발언 수까지 생성). */
  mode: 'live' | 'background'
  targetUtterances?: number
  opener?: { speakerId: ParticipantId; mode: DialogueMode }
}

interface InFlight {
  controller: AbortController
  replyToHuman: boolean
}

interface RecentMessage {
  speakerId: ParticipantId
  text: string
}

/**
 * 한 방의 대화 진행자(design.md §11). 누가 말할지는 여기서 정하고, 무엇을 말할지는 그 참가자의 LLM 호출이 정한다.
 * 모든 대사는 한 번에 한 사람씩, 실제 이벤트로 기록된다.
 */
export class ChatScene {
  readonly done: Promise<void>
  private resolveDone!: () => void
  private active = false
  private accepting = false
  private chainBudget = 0
  private readonly inFlight = new Map<ParticipantId, InFlight>()
  private readonly typingIds = new Set<ParticipantId>()
  private readonly recent: RecentMessage[] = []
  private readonly lastSpokeAt = new Map<ParticipantId, number>()
  private utterances = 0
  private silentStreak = 0
  private idle: Countdown | null = null
  private idleToken = 0
  private humanWaitingSince: number | null = null
  private wrapUpPending = false
  private lastMessageAt = Number.NEGATIVE_INFINITY
  private lastHumanSeq = 0
  private startedAt = 0
  private unsub: (() => void) | null = null
  private settleWaiters: (() => void)[] = []

  constructor(
    private readonly deps: SceneDeps,
    readonly opts: SceneOptions,
  ) {
    this.done = new Promise((r) => (this.resolveDone = r))
  }

  private get config(): GameConfig {
    return this.deps.session.config
  }

  private get humanId(): ParticipantId | null {
    return this.deps.session.state.humanId
  }

  get roomId(): RoomId {
    return this.opts.roomId
  }

  get isBackground(): boolean {
    return this.opts.mode === 'background'
  }

  get isPrivate(): boolean {
    return this.deps.house.members(this.roomId).length <= 2
  }

  start(): this {
    if (this.active) return this
    this.active = true
    this.accepting = true
    this.startedAt = this.deps.clock.now()
    this.unsub = this.deps.session.subscribe((e) => this.onEvent(e))
    const opener = this.opts.opener
    if (opener) this.request(opener.speakerId, opener.mode, this.isBackground ? Priority.P4_BACKGROUND : Priority.P1_SCENE, false)
    else if (this.isBackground) this.kick()
    if (!this.isBackground) this.armIdle()
    return this
  }

  /** 방금 들어온 발언(입장 인사 등)에 다른 AI가 최대 n번 반응할 수 있게 한다. */
  primeReactions(n: number): void {
    this.chainBudget = Math.max(this.chainBudget, n)
  }

  /** 다음 AI 발언을 마무리 멘트로 바꾼다(종료 직전). */
  setWrapUp(): void {
    this.wrapUpPending = true
  }

  /** 사람이 AI 응답을 유예 시간보다 오래 기다리는 중인가(1:1 타이머 정지 조건, design.md §12). */
  humanWaitHeld(): boolean {
    return this.humanWaitingSince !== null && this.deps.clock.now() - this.humanWaitingSince > this.config.timing.aiWaitPauseGraceMs
  }

  /** 새 발언은 받지 않고, 진행 중인 생성이 유예 안에 끝나면 내보낸 뒤 멈춘다. */
  async finish(graceMs: number): Promise<void> {
    if (!this.active) return
    this.accepting = false
    this.cancelIdle()
    if (this.inFlight.size > 0) {
      const grace = this.deps.clock.wait(graceMs)
      await Promise.race([grace.promise, new Promise<void>((r) => this.settleWaiters.push(r))])
      grace.cancel()
    }
    this.stop()
  }

  stop(): void {
    if (!this.active) return
    this.active = false
    this.accepting = false
    this.cancelIdle()
    for (const f of this.inFlight.values()) f.controller.abort()
    this.unsub?.()
    this.unsub = null
    this.typingIds.clear()
    this.deps.typing(this.roomId, [])
    this.resolveDone()
  }

  private onEvent(e: AnyEvent): void {
    if (!this.active) return
    if (e.type === 'ROOM_CLOSED' && e.payload.roomId === this.roomId) {
      this.stop()
      return
    }
    if (e.type !== 'MESSAGE_SENT' || e.payload.roomId !== this.roomId) return
    const speaker = e.actor
    this.recent.push({ speakerId: speaker, text: e.payload.text })
    if (this.recent.length > 30) this.recent.shift()
    this.lastSpokeAt.set(speaker, this.deps.clock.now())
    this.lastMessageAt = this.deps.clock.now()

    if (speaker === this.humanId) this.onHumanMessage(e.seq)
    else this.onAiMessage(speaker)
    if (!this.isBackground) this.armIdle()
  }

  private onHumanMessage(seq: number): void {
    this.lastHumanSeq = seq
    this.chainBudget = this.config.scheduler.maxChainAfterHuman
    for (const f of this.inFlight.values()) if (!f.replyToHuman) f.controller.abort()
    if (!this.accepting) return
    const max = this.isPrivate ? 1 : this.config.scheduler.maxRespondersToHuman
    const k = Math.min(max, this.deps.rng.chance(0.55) ? 1 : 2)
    const responders = this.choose(k)
    if (responders.length > 0) this.humanWaitingSince = this.deps.clock.now()
    for (const r of responders) this.request(r, 'reply', Priority.P0_HUMAN_WAITING, true)
  }

  private onAiMessage(speaker: ParticipantId): void {
    if (this.isBackground) {
      this.utterances++
      this.silentStreak = 0
      if (this.utterances >= (this.opts.targetUtterances ?? 5)) {
        this.stop()
        return
      }
      const next = this.choose(1, speaker)[0]
      if (next) this.request(next, 'reply', Priority.P4_BACKGROUND, false)
      return
    }
    if (this.chainBudget > 0 && this.deps.rng.chance(this.config.scheduler.followUpChance)) {
      const next = this.choose(1, speaker)[0]
      if (next) {
        this.chainBudget--
        this.request(next, 'follow_up', Priority.P1_SCENE, false)
      }
    }
  }

  private choose(k: number, exclude?: ParticipantId): ParticipantId[] {
    const state = this.deps.session.state
    const human = this.humanId
    const sc = this.config.scheduler
    const last = this.recent.at(-1)
    const window = this.recent.slice(-sc.recentWindow)
    const now = this.deps.clock.now()
    const candidates: SpeakerFeatures[] = []
    for (const id of this.deps.house.members(this.roomId)) {
      if (id === human || id === exclude || this.inFlight.has(id)) continue
      const cast = state.participants.get(id)?.cast
      if (!cast) continue
      let consecutive = 0
      for (let i = this.recent.length - 1; i >= 0 && this.recent[i]?.speakerId === id; i--) consecutive++
      candidates.push({
        id,
        mentioned: !!last && last.speakerId !== id && findMentions(last.text, [{ id, name: cast.name }]).length > 0,
        topicMatch: !!last && matchesInterest(last.text, cast.interests),
        participatedRecently: this.recent.slice(-4).some((m) => m.speakerId === id),
        extraversion: cast.traits.extraversion,
        interestInSpeaker: last && last.speakerId !== id ? getRelationship(state, id, last.speakerId, this.config.relationship.initial).interest : 50,
        recentCount: window.filter((m) => m.speakerId === id).length,
        consecutive,
        quiet: now - (this.lastSpokeAt.get(id) ?? this.startedAt) > sc.quietThresholdMs,
      })
    }
    return pickSpeakers(candidates, k, this.deps.rng, sc.weights, sc.maxConsecutive)
  }

  private request(speakerId: ParticipantId, mode: DialogueMode, priority: number, replyToHuman: boolean): void {
    if (!this.accepting || this.inFlight.has(speakerId)) return
    if (this.inFlight.size >= this.config.scheduler.maxInFlightPerScene) return
    const entry: InFlight = { controller: new AbortController(), replyToHuman }
    this.inFlight.set(speakerId, entry)
    let useMode = mode
    if (this.wrapUpPending && mode !== 'greeting') {
      this.wrapUpPending = false
      useMode = 'wrap_up'
    }
    void this.generate(speakerId, useMode, priority, entry, this.lastHumanSeq)
  }

  private async generate(speakerId: ParticipantId, mode: DialogueMode, priority: number, entry: InFlight, seenHumanSeq: number): Promise<void> {
    const { clock, agents, house } = this.deps
    const timing = this.config.timing
    let spoke = false
    try {
      const started = clock.now()
      const text = await agents.speak({ speakerId, roomId: this.roomId, mode, isPrivate: this.isPrivate }, priority, entry.controller.signal, () =>
        this.setTyping(speakerId, true),
      )
      if (text === null || this.isStale(entry, seenHumanSeq)) return
      const typingMs = Math.min(timing.typing.maxMs, timing.typing.baseMs + timing.typing.perCharMs * text.length) - (clock.now() - started)
      const gapMs = timing.minGapMs - (clock.now() - this.lastMessageAt)
      const delay = Math.max(typingMs, gapMs, 0)
      if (delay > 0) await clock.wait(delay).promise
      if (this.isStale(entry, seenHumanSeq)) return
      spoke = house.say(this.roomId, speakerId, text, this.isBackground)
    } finally {
      if (this.inFlight.get(speakerId) === entry) this.inFlight.delete(speakerId)
      this.setTyping(speakerId, false)
      if (entry.replyToHuman && ![...this.inFlight.values()].some((f) => f.replyToHuman)) this.humanWaitingSince = null
      this.afterSettle(speakerId, spoke)
    }
  }

  private isStale(entry: InFlight, seenHumanSeq: number): boolean {
    return !this.active || entry.controller.signal.aborted || (!entry.replyToHuman && this.lastHumanSeq > seenHumanSeq)
  }

  private afterSettle(speakerId: ParticipantId, spoke: boolean): void {
    if (this.inFlight.size === 0) {
      const waiters = this.settleWaiters
      this.settleWaiters = []
      for (const w of waiters) w()
    }
    if (!this.active || !this.isBackground || spoke) return
    this.silentStreak++
    if (this.silentStreak > 6) {
      this.stop()
      return
    }
    if (this.inFlight.size === 0) {
      const next = this.choose(1, speakerId)[0] ?? this.choose(1)[0]
      if (next) this.request(next, 'reply', Priority.P4_BACKGROUND, false)
      else this.stop()
    }
  }

  private kick(): void {
    const first = this.choose(1)[0]
    if (first) this.request(first, 'start_topic', Priority.P4_BACKGROUND, false)
    else this.stop()
  }

  private armIdle(): void {
    this.cancelIdle()
    if (!this.accepting) return
    const token = ++this.idleToken
    const { minMs, maxMs } = this.config.timing.idle
    this.idle = this.deps.clock.wait(this.deps.rng.int(minMs, maxMs))
    void this.idle.promise.then(() => {
      if (token !== this.idleToken || !this.accepting) return
      if (this.inFlight.size === 0) {
        const state = this.deps.session.state
        // 직전에 말한 사람은 새 화제를 꺼내지 않는다. 혼자 남은 AI가 대답 없는 상대에게 같은 말을 되풀이하던 문제(실측).
        const last = this.recent.at(-1)?.speakerId
        const ais = this.deps.house.members(this.roomId).filter((id) => id !== this.humanId && id !== last)
        if (ais.length > 0) {
          const starter = this.deps.rng.weighted(ais, (id) => 10 + (state.participants.get(id)?.cast.traits.extraversion ?? 50))
          const humanHere = this.humanId !== null && this.deps.house.members(this.roomId).includes(this.humanId)
          this.chainBudget = this.config.scheduler.maxChainAfterHuman
          this.request(starter, 'start_topic', humanHere ? Priority.P1_SCENE : Priority.P4_BACKGROUND, false)
        }
      }
      this.armIdle()
    })
  }

  private cancelIdle(): void {
    this.idleToken++
    this.idle?.cancel()
    this.idle = null
  }

  private setTyping(id: ParticipantId, on: boolean): void {
    if (on) this.typingIds.add(id)
    else this.typingIds.delete(id)
    if (this.active || !on) this.deps.typing(this.roomId, [...this.typingIds])
  }
}
