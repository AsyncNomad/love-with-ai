import { dropEchoedSentences, type DialogueMode } from '@heart/agents'
import type { AnyEvent, GameConfig, ParticipantId, RoomId } from '@heart/shared'
import { findMentions, getRelationship, matchesInterest, pairKey, pickSpeakers, type Rng, type SpeakerFeatures } from '@heart/engine'
import type { AgentService } from './agent-service'
import { Priority } from './gpu-queue'
import type { House } from './house'
import type { GameSession } from './session'
import { mayConcernSpeech, type SpeechEtiquette, type SpeechPick } from './speech-etiquette'
import type { Countdown, GameClock } from './timers'

/** 장면이 반응하는 PD 안내 키. 브런치·활동 방의 상황 카드다(game-rules.md §5.2). */
export const SITUATION_CARD = 'situation_card'

export interface SceneDeps {
  session: GameSession
  house: House
  agents: AgentService
  clock: GameClock
  rng: Rng
  typing: (roomId: RoomId, participantIds: ParticipantId[]) => void
  speech: SpeechEtiquette
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
  /** 사람이 마지막으로 말한 뒤 말한 AI. 사람의 말 하나에 같은 사람이 두 번 답하지 않게 한다(실측: A·B·A가 같은 질문에 두 번 답했다). */
  private readonly spokeSinceHuman = new Set<ParticipantId>()
  private readonly inFlight = new Map<ParticipantId, InFlight>()
  private readonly typingIds = new Set<ParticipantId>()
  private readonly recent: RecentMessage[] = []
  private readonly lastSpokeAt = new Map<ParticipantId, number>()
  private utterances = 0
  /** 이 장면에서 지금까지 나온 메시지 수(recent는 최근 30개만 들고 있다). */
  private messageCount = 0
  /** 한 장면에서는 말 놓기를 한 번만 제안한다(game-rules.md §11.2). */
  private proposedInScene = false
  /** 제안 요청을 걸어 두었다(같은 틱에 두 번 걸지 않게). 제안하는 말이 실제로 올라가야 proposedInScene이 된다. */
  private proposalRequested = false
  /** 제안하려고 했지만 제안으로 읽히지 않은 횟수. 장면마다 두 번까지 시도한다. */
  private proposalAttempts = 0
  /** AI가 사람에게 한 말 놓기 제안. 사람의 다음 말로 대답을 판정한다. */
  private pendingHumanAnswer: { proposalId: string; proposerId: ParticipantId; kind: SpeechPick['kind']; said: string } | null = null
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
    // 대답을 듣지 못한 제안은 "대답 없음"으로 닫는다. 같은 쌍에서 다시 제안하지 않는다.
    if (this.pendingHumanAnswer && this.humanId) {
      const p = this.pendingHumanAnswer
      this.pendingHumanAnswer = null
      this.deps.speech.answer(this.roomId, p.proposalId, p.proposerId, this.humanId, p.kind, 'none')
    }
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
    if (e.type === 'PD_ANNOUNCED' && e.payload.roomId === this.roomId && e.payload.key === SITUATION_CARD) {
      this.onSituationCard()
      return
    }
    if (e.type !== 'MESSAGE_SENT' || e.payload.roomId !== this.roomId) return
    const speaker = e.actor
    this.recent.push({ speakerId: speaker, text: e.payload.text })
    this.messageCount++
    if (this.recent.length > 30) this.recent.shift()
    this.lastSpokeAt.set(speaker, this.deps.clock.now())
    this.lastMessageAt = this.deps.clock.now()

    if (speaker === this.humanId) {
      this.spokeSinceHuman.clear()
      this.onHumanMessage(e.seq, e.payload.text)
    } else {
      this.spokeSinceHuman.add(speaker)
      this.onAiMessage(speaker)
    }
    if (!this.isBackground) this.armIdle()
  }

  private onHumanMessage(seq: number, text: string): void {
    this.lastHumanSeq = seq
    this.chainBudget = this.config.scheduler.maxChainAfterHuman
    for (const f of this.inFlight.values()) if (!f.replyToHuman) f.controller.abort()
    if (!this.accepting) return
    // AI가 말 놓기를 제안한 뒤, 사람이 말투와 관련된 말을 하면 그것을 대답으로 읽는다. 대화는 평소처럼 이어진다.
    // 관련 없는 말은 판정에 넘기지 않고 계속 기다린다. 실측(17회차): 상관없는 "오늘 하루 어떠셨어요?"를 받아들임으로 판정했고,
    // 몇 마디 뒤에 온 진짜 대답("좋아요, 우리 말 편하게 해요")은 버려졌다.
    if (this.pendingHumanAnswer && this.humanId && mayConcernSpeech(text)) {
      const p = this.pendingHumanAnswer
      const human = this.humanId
      this.pendingHumanAnswer = null
      void this.deps.agents.judgeHumanAnswer(text, p.proposerId, p.kind, p.said).then((answer) => this.deps.speech.answer(this.roomId, p.proposalId, p.proposerId, human, p.kind, answer))
    } else if (!this.pendingHumanAnswer && mayConcernSpeech(text)) {
      // 사람이 말 놓기를 제안했을 수 있다. 판정이 끝날 때까지 답할 사람을 고르지 않는다(제안 받은 사람이 대답하게).
      void this.handleHumanOffer(text)
      return
    }
    this.replyToHuman()
  }

  private replyToHuman(): void {
    if (!this.accepting) return
    const max = this.isPrivate ? 1 : this.config.scheduler.maxRespondersToHuman
    const k = Math.min(max, this.deps.rng.chance(0.55) ? 1 : 2)
    const responders = this.choose(k)
    if (responders.length > 0) this.humanWaitingSince = this.deps.clock.now()
    for (const r of responders) this.request(r, 'reply', Priority.P0_HUMAN_WAITING, true)
  }

  /** PD가 상황 카드(브런치·활동)를 내면 한 명이 먼저 반응하고, 몇 마디가 이어질 수 있게 한다. */
  private onSituationCard(): void {
    if (!this.accepting) return
    this.chainBudget = this.config.scheduler.maxChainAfterHuman
    const first = this.choose(1)[0]
    if (first) this.request(first, 'reply', this.isBackground ? Priority.P4_BACKGROUND : Priority.P1_SCENE, false)
    if (!this.isBackground) this.armIdle()
  }

  private onAiMessage(speaker: ParticipantId): void {
    if (this.isBackground) {
      this.utterances++
      this.silentStreak = 0
      if (this.utterances >= (this.opts.targetUtterances ?? 5)) {
        this.stop()
        return
      }
      if (this.maybeProposeCasual(Priority.P4_BACKGROUND)) return
      const next = this.choose(1, speaker)[0]
      if (next) this.request(next, 'reply', Priority.P4_BACKGROUND, false)
      return
    }
    if (this.maybeProposeCasual(Priority.P1_SCENE)) return
    if (this.chainBudget > 0 && this.deps.rng.chance(this.config.scheduler.followUpChance)) {
      const next = this.choose(1, speaker, this.spokeSinceHuman)[0]
      if (next) {
        this.chainBudget--
        this.request(next, 'follow_up', Priority.P1_SCENE, false)
      }
    }
  }

  /**
   * 조건이 맞으면 이 장면에서 한 번, 말 놓기를 제안하게 한다(game-rules.md §11.2). 제안을 걸었으면 true.
   * 이 판정은 AI의 말이 방에 올라가는 순간에 돈다. 그때 방금 말한 AI는 아직 생성 중으로 잡혀 있어서, 요청은 그 정리가 끝난 뒤로 미룬다.
   * 실측(14회차): 미루지 않아 사람과의 1:1에서는 제안이 한 번도 나오지 않았다(조건을 만족한 순간 35번, 제안 1번).
   */
  private maybeProposeCasual(priority: number): boolean {
    if (this.proposedInScene || this.proposalRequested || this.messageCount < this.config.speech.minSceneMessages) return false
    const pick = this.deps.speech.pick(this.deps.house.members(this.roomId), this.humanId, this.isPrivate, this.deps.rng)
    if (!pick) return false
    this.proposalRequested = true
    queueMicrotask(() => {
      this.proposalRequested = false
      if (!this.accepting || this.proposedInScene || this.inFlight.has(pick.proposerId)) return
      this.request(pick.proposerId, 'propose_casual', priority, false, pick)
    })
    return true
  }

  /** 제안하는 말이 나온 뒤: 제안을 남기고, 상대가 AI면 바로 대답하게 하고, 사람이면 다음 말을 기다린다. */
  private async afterProposal(pick: SpeechPick, said: string): Promise<void> {
    const { speech, agents } = this.deps
    // 사람이 끼어들어 제안 생성이 취소되면 다시 기회가 있다. 제안하는 말이 올라간 뒤에만 "이 장면에서 제안함"으로 본다.
    this.proposedInScene = true
    // 실제로 말 놓기 제안이었는지 확인한다. 실측(15회차): "잠이 안 오시면 천천히 쉬는 시간이라도…"를 제안으로 기록했다.
    // 대화와 상태가 어긋나면 안 되므로, 제안으로 읽히지 않으면 기록하지 않고 한 번 더 기회를 준다.
    if (!(await agents.verifySpeechOffer(said))) {
      this.proposalAttempts++
      if (this.proposalAttempts < 2) this.proposedInScene = false
      return
    }
    const proposalId = speech.propose(this.roomId, pick.proposerId, pick.targetId, pick.kind)
    if (pick.targetId === this.humanId) {
      this.pendingHumanAnswer = { proposalId, proposerId: pick.proposerId, kind: pick.kind, said }
      return
    }
    const res = await agents.speechResponse(pick.targetId, pick.proposerId, pick.kind, this.roomId, this.isBackground ? Priority.P4_BACKGROUND : Priority.P1_SCENE)
    const spoke = res !== null && (await this.sayAfterTyping(pick.targetId, res.text))
    speech.answer(this.roomId, proposalId, pick.proposerId, pick.targetId, pick.kind, spoke && res ? res.answer : 'none')
  }

  /** 사람이 말 놓기를 제안했는지 판정하고, 제안이면 받은 AI가 대답한다. 아니면 평소처럼 답한다. */
  private async handleHumanOffer(text: string): Promise<void> {
    const human = this.humanId
    const ais = this.deps.house.members(this.roomId).filter((id) => id !== human)
    const offer = human ? await this.deps.agents.judgeSpeechOffer(text, ais) : null
    if (!this.active) return
    if (!offer || !human || this.deps.session.state.speechProposals.has(pairKey(human, offer.targetId))) {
      this.replyToHuman()
      return
    }
    const proposalId = this.deps.speech.propose(this.roomId, human, offer.targetId, offer.offer)
    const res = await this.deps.agents.speechResponse(offer.targetId, human, offer.offer, this.roomId, Priority.P0_HUMAN_WAITING)
    const spoke = res !== null && (await this.sayAfterTyping(offer.targetId, res.text))
    this.deps.speech.answer(this.roomId, proposalId, human, offer.targetId, offer.offer, spoke && res ? res.answer : 'none')
  }

  private async sayAfterTyping(speakerId: ParticipantId, text: string): Promise<boolean> {
    const t = this.config.timing.typing
    this.setTyping(speakerId, true)
    await this.deps.clock.wait(Math.min(t.maxMs, t.baseMs + t.perCharMs * text.length)).promise
    this.setTyping(speakerId, false)
    // 백그라운드 장면은 정해진 발언 수에 닿으면 먼저 끝난다. 말 놓기 대답은 방이 열려 있는 동안이면 올린다(실측 15회차: 대답 전에 장면이 끝났다).
    return this.deps.house.isOpen(this.roomId) && this.deps.house.say(this.roomId, speakerId, text, this.isBackground)
  }

  private choose(k: number, exclude?: ParticipantId, alsoExclude?: ReadonlySet<ParticipantId>): ParticipantId[] {
    const state = this.deps.session.state
    const human = this.humanId
    const sc = this.config.scheduler
    const last = this.recent.at(-1)
    const window = this.recent.slice(-sc.recentWindow)
    const now = this.deps.clock.now()
    const candidates: SpeakerFeatures[] = []
    for (const id of this.deps.house.members(this.roomId)) {
      if (id === human || id === exclude || alsoExclude?.has(id) || this.inFlight.has(id)) continue
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

  private request(speakerId: ParticipantId, mode: DialogueMode, priority: number, replyToHuman: boolean, offer?: SpeechPick): void {
    if (!this.accepting || this.inFlight.has(speakerId)) return
    if (this.inFlight.size >= this.config.scheduler.maxInFlightPerScene) return
    const entry: InFlight = { controller: new AbortController(), replyToHuman }
    this.inFlight.set(speakerId, entry)
    let useMode = mode
    if (this.wrapUpPending && mode !== 'greeting' && mode !== 'propose_casual') {
      this.wrapUpPending = false
      useMode = 'wrap_up'
    }
    void this.generate(speakerId, useMode, priority, entry, this.lastHumanSeq, useMode === 'propose_casual' ? offer : undefined)
  }

  private async generate(speakerId: ParticipantId, mode: DialogueMode, priority: number, entry: InFlight, seenHumanSeq: number, offer?: SpeechPick): Promise<void> {
    const { clock, agents, house } = this.deps
    const timing = this.config.timing
    let spoke = false
    try {
      const started = clock.now()
      const countAtStart = this.messageCount
      const speechOffer = offer ? { targetId: offer.targetId, kind: offer.kind } : undefined
      const generated = await agents.speak({ speakerId, roomId: this.roomId, mode, isPrivate: this.isPrivate, ...(speechOffer ? { speechOffer } : {}) }, priority, entry.controller.signal, () =>
        this.setTyping(speakerId, true),
      )
      if (generated === null || this.isStale(entry, seenHumanSeq)) return
      // 사람의 말에 두 명이 동시에 답하면 서로의 답을 못 본 채 같은 말을 한다(실측: 둘 다 "영화 좋아하시나요?").
      // 생성하는 동안 이 방에 새로 올라온 말과 겹치는 문장은 지우고, 남는 게 없으면 말하지 않는다.
      const arrived = this.recent.slice(-Math.min(this.recent.length, this.messageCount - countAtStart)).map((m) => m.text)
      const text = arrived.length > 0 && this.messageCount > countAtStart ? dropEchoedSentences(generated, arrived) : generated
      if (text.length === 0) return
      const typingMs = Math.min(timing.typing.maxMs, timing.typing.baseMs + timing.typing.perCharMs * text.length) - (clock.now() - started)
      const gapMs = timing.minGapMs - (clock.now() - this.lastMessageAt)
      const delay = Math.max(typingMs, gapMs, 0)
      if (delay > 0) await clock.wait(delay).promise
      if (this.isStale(entry, seenHumanSeq)) return
      spoke = house.say(this.roomId, speakerId, text, this.isBackground)
      if (spoke && offer) void this.afterProposal(offer, text)
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
