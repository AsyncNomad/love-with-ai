import type { ActivityOption, AgentRunner, DialogueInput, HumanSpeechOutput, SpeechResponseOutput, TaskResult, TaskSpec } from '@heart/agents'
import {
  LlmUnavailableError,
  activityChoiceTask,
  dialogueTask,
  humanSpeechTask,
  speechResponseTask,
  fallbackFlavor,
  inviteDecisionTask,
  mailboxAnswerTask,
  mailboxQuestionTask,
  memorySummaryTask,
  personaProfileTask,
  personaVoiceTask,
  relationshipEvalTask,
  selfIntroTask,
  signalCardTask,
  voteTask,
} from '@heart/agents'
import type { CastParticipant, ParticipantId, PersonaFlavor, SpeechAnswer, SpeechProposalKind, VoteKind } from '@heart/shared'
import { knownProfile, scaleDeltas, type Rng } from '@heart/engine'
import { Priority, type GpuQueue } from './gpu-queue'
import type { PauseController } from './pause'
import type { GameSession } from './session'

interface Tracked {
  label: string
  ownerId: string
  promise: Promise<void>
}

/**
 * AI 작업의 창구: GPU 큐에 넣고, 결과를 이벤트로 커밋한다.
 * LLM 서버가 죽으면 게임을 멈추고 재개를 기다렸다가 다시 시도한다(design.md §7.6).
 */
export class AgentService {
  private readonly background = new Set<Tracked>()
  private memoryCounter = 0

  constructor(
    private readonly session: GameSession,
    private readonly runner: AgentRunner,
    private readonly queue: GpuQueue,
    private readonly pause: PauseController,
    private readonly rng: Rng,
  ) {}

  private get config() {
    return this.session.config
  }

  async exec<I, Raw, R>(
    spec: TaskSpec<I, Raw, R>,
    input: I,
    priority: number,
    opts: { signal?: AbortSignal; onStart?: () => void } = {},
  ): Promise<TaskResult<R>> {
    for (;;) {
      try {
        const result = await this.queue.enqueue({
          priority,
          label: spec.id,
          ownerId: spec.ownerOf(input),
          ...(opts.signal ? { signal: opts.signal } : {}),
          run: (signal) => {
            opts.onStart?.()
            return this.runner.run(spec, input, signal)
          },
        })
        if (!result.ok && !result.aborted) {
          this.session.commit({
            type: 'LLM_OUTPUT_REJECTED',
            payload: { task: spec.id, ownerId: spec.ownerOf(input), reasons: result.issues },
            visibility: { kind: 'server' },
          })
        }
        return result
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return { ok: false, issues: ['aborted'], aborted: true }
        if (err instanceof LlmUnavailableError) {
          this.pause.pause('llm_unavailable')
          await this.pause.untilResumed()
          continue
        }
        throw err
      }
    }
  }

  async speak(input: DialogueInput, priority: number, signal?: AbortSignal, onStart?: () => void): Promise<string | null> {
    const res = await this.exec(dialogueTask, input, priority, { ...(signal ? { signal } : {}), ...(onStart ? { onStart } : {}) })
    return res.ok ? res.value.text : null
  }

  /** 인격 서술 2단계 생성. 실패하면 템플릿으로 대체한다(design.md §8.1-7). */
  async castFlavor(cast: CastParticipant, othersLines: string[]): Promise<{ flavor: PersonaFlavor; fallback: boolean }> {
    const profile = await this.exec(personaProfileTask, { cast }, Priority.P1_SCENE)
    if (!profile.ok) return { flavor: fallbackFlavor(cast), fallback: true }
    const voice = await this.exec(personaVoiceTask, { cast, profile: profile.value, othersLines }, Priority.P1_SCENE)
    if (!voice.ok) {
      const fb = fallbackFlavor(cast)
      return { flavor: { ...profile.value, speechDescription: fb.speechDescription, exampleLines: fb.exampleLines }, fallback: true }
    }
    return { flavor: { ...profile.value, ...voice.value }, fallback: false }
  }

  /** 투표 하나를 결정하고 커밋한다. 실패하면 유보로 확정한다(game-rules.md §7). */
  async vote(voteId: string, voterId: ParticipantId, kind: VoteKind, candidates: ParticipantId[]): Promise<void> {
    const shuffled = this.rng.shuffle(candidates)
    const res = candidates.length > 0 ? await this.exec(voteTask, { voterId, kind, candidateIds: shuffled }, Priority.P2_DECISION) : null
    const ok = res?.ok === true
    const targetId = ok ? res.value.targetId : null
    const reason = ok ? res.value.reason : null
    this.session.commit({
      type: 'VOTE_COMMITTED',
      actor: voterId,
      payload: { voteId, voterId, targetId, reason, auto: !ok },
      visibility: { kind: 'participants', ids: [voterId] },
      idempotencyKey: `vote:${voteId}:${voterId}`,
    })
    if (ok) this.recordChoiceMemory(voterId, kind, targetId, reason ?? '', res.evidenceSeqs)
  }

  async inviteDecision(voteId: string, targetId: ParticipantId, candidateIds: ParticipantId[]): Promise<ParticipantId[]> {
    const res = await this.exec(
      inviteDecisionTask,
      { targetId, candidateIds: this.rng.shuffle(candidateIds), maxAccept: this.config.assignment.inviteMaxAccept },
      Priority.P2_DECISION,
    )
    return res.ok ? res.value : []
  }

  async selfIntro(speakerId: ParticipantId, roomId: string): Promise<string | null> {
    const res = await this.exec(selfIntroTask, { speakerId, roomId }, Priority.P1_SCENE)
    return res.ok ? res.value : null
  }

  /** 2일차 활동 지망. 실패하면 null(호출자가 무작위로 정한다). 후보 순서는 매번 섞는다(D20). */
  async activityChoice(participantId: ParticipantId, options: ActivityOption[]): Promise<{ first: string; second: string } | null> {
    const res = await this.exec(activityChoiceTask, { participantId, options: this.rng.shuffle(options) }, Priority.P2_DECISION)
    return res.ok ? res.value : null
  }

  /** 시그널 카드. 실패하면 보내지 않은 것으로 한다(내용을 지어내지 않는다, 원칙 7). */
  async signalCard(senderId: ParticipantId, candidateIds: ParticipantId[]): Promise<{ targetId: ParticipantId | null; text: string }> {
    if (candidateIds.length === 0) return { targetId: null, text: '' }
    const res = await this.exec(signalCardTask, { senderId, candidateIds: this.rng.shuffle(candidateIds) }, Priority.P2_DECISION)
    return res.ok ? res.value : { targetId: null, text: '' }
  }

  async mailboxQuestion(askerId: ParticipantId, candidateIds: ParticipantId[]): Promise<{ targetId: ParticipantId | null; text: string }> {
    if (candidateIds.length === 0) return { targetId: null, text: '' }
    const res = await this.exec(mailboxQuestionTask, { askerId, candidateIds: this.rng.shuffle(candidateIds) }, Priority.P2_DECISION)
    return res.ok ? res.value : { targetId: null, text: '' }
  }

  async mailboxAnswer(answererId: ParticipantId, askerId: ParticipantId, question: string): Promise<string | null> {
    const res = await this.exec(mailboxAnswerTask, { answererId, askerId, question }, Priority.P2_DECISION)
    return res.ok ? res.value : null
  }

  /** 말 놓기 제안에 대한 AI의 응답(game-rules.md §11.4). 실패하면 null(제안은 대답 없음으로 끝난다). */
  async speechResponse(responderId: ParticipantId, proposerId: ParticipantId, kind: SpeechProposalKind, roomId: string, priority: number): Promise<SpeechResponseOutput | null> {
    const res = await this.exec(speechResponseTask, { responderId, proposerId, kind, roomId }, priority)
    return res.ok ? res.value : null
  }

  /** 누군가의 말(사람의 말, 또는 AI가 제안하려고 한 말)에서 말 놓기 제안을 읽는다(§11.5). 아니면 null. */
  async judgeSpeechOffer(text: string, candidateIds: ParticipantId[]): Promise<{ targetId: ParticipantId; offer: SpeechProposalKind } | null> {
    if (candidateIds.length === 0) return null
    const res = await this.exec(humanSpeechTask, { mode: 'offer', text, candidateIds }, Priority.P0_HUMAN_WAITING)
    const v: HumanSpeechOutput | null = res.ok ? res.value : null
    return v?.kind === 'offer' ? { targetId: v.targetId, offer: v.offer } : null
  }

  /** AI의 제안에 대한 사람의 대답을 읽는다. 불확실하면 none. */
  async judgeHumanAnswer(text: string, proposerId: ParticipantId, kind: SpeechProposalKind, said: string): Promise<SpeechAnswer> {
    const res = await this.exec(humanSpeechTask, { mode: 'answer', text, candidateIds: [], proposal: { proposerId, kind, said } }, Priority.P1_SCENE)
    return res.ok && res.value.kind === 'answer' ? res.value.answer : 'none'
  }

  /** 장면이 끝난 뒤 관계 평가. 백그라운드(P5)로 돌린다. */
  reflectLater(ownerId: ParticipantId, targetIds: ParticipantId[], sinceSeq: number, label: string): void {
    if (targetIds.length === 0) return
    this.track(`reflect:${label}`, ownerId, async () => {
      const res = await this.exec(relationshipEvalTask, { ownerId, targetIds, sinceSeq, sceneLabel: label }, Priority.P5_REFLECTION)
      if (!res.ok) return
      for (const ev of res.value) {
        const deltas = scaleDeltas(ev.deltas, ev.significant, this.config.relationship)
        this.session.commit({
          type: 'RELATIONSHIP_UPDATED',
          payload: { sourceId: ownerId, targetId: ev.targetId, deltas, significant: ev.significant, reason: ev.impression, evidenceSeqs: res.evidenceSeqs },
          visibility: { kind: 'participants', ids: [ownerId] },
        })
        if (ev.impression) this.recordMemory(ownerId, 'impression', ev.impression, [ev.targetId], res.evidenceSeqs)
        // 말투는 여기서 바꾸지 않는다. 말 놓기는 제안과 응답으로만 바뀐다(D38).
      }
    })
  }

  summarizeLater(ownerId: ParticipantId, sinceSeq: number, label: string): void {
    this.track(`summary:${label}`, ownerId, async () => {
      const res = await this.exec(memorySummaryTask, { ownerId, sinceSeq, label }, Priority.P5_REFLECTION)
      if (res.ok) this.recordMemory(ownerId, 'summary', res.value, [], res.evidenceSeqs)
    })
  }

  /** 투표 전처럼 결과가 필요할 때 백그라운드 작업을 앞당기고 모두 기다린다. */
  async flushBackground(priority: number = Priority.P2_DECISION): Promise<void> {
    while (this.background.size > 0) {
      this.queue.promote((job) => job.priority >= Priority.P5_REFLECTION, priority)
      await Promise.all([...this.background].map((t) => t.promise))
    }
  }

  private track(label: string, ownerId: string, fn: () => Promise<void>): void {
    const entry: Tracked = { label, ownerId, promise: Promise.resolve() }
    entry.promise = fn()
      .catch((err: unknown) => {
        if (!(err instanceof Error && err.name === 'AbortError')) throw err
      })
      .finally(() => this.background.delete(entry))
    this.background.add(entry)
  }

  private recordChoiceMemory(ownerId: ParticipantId, kind: VoteKind, targetId: ParticipantId | null, reason: string, sources: number[]): void {
    const label = { first_impression: '첫인상 선택', night: '심야 선택', date: '마지막 데이트 선택', final: '최종 선택' }[kind]
    const name = targetId ? (knownProfile(this.session.state, ownerId, targetId).name ?? '그 사람') : ''
    const content = targetId ? `${label}에서 ${name}을(를) 골랐다. ${reason}`.trim() : `${label}에서 아무도 고르지 않았다.`
    this.recordMemory(ownerId, 'choice', content, targetId ? [targetId] : [], sources)
  }

  private recordMemory(ownerId: ParticipantId, kind: 'summary' | 'impression' | 'choice', content: string, aboutIds: ParticipantId[], sourceSeqs: number[]): void {
    this.session.commit({
      type: 'MEMORY_RECORDED',
      payload: { memoryId: `m_${++this.memoryCounter}`, ownerId, kind, content, aboutIds, sourceSeqs },
      visibility: { kind: 'participants', ids: [ownerId] },
    })
  }
}
