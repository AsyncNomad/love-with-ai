import type { AnyEvent, EventDraft, GameConfig } from '@heart/shared'
import { EVENT_SCHEMA_VERSION, parseEventPayload } from '@heart/shared'
import { applyEvent, createRunState, findMentions, type FoldOptions, type RunState } from '@heart/engine'
import type { RunSink } from './ports'

export function foldOptionsFor(config: GameConfig): FoldOptions {
  return {
    relationshipInitial: config.relationship.initial,
    interactionWeights: config.relationship.exposureWeights,
    mentions: (state, text, candidates) =>
      findMentions(
        text,
        candidates.map((id) => ({ id, name: state.participants.get(id)?.cast.name ?? '' })),
      ),
  }
}

export type EventListener = (event: AnyEvent) => void

/**
 * 게임 상태의 유일한 소유자. 모든 변경은 commit()을 거친다:
 * payload 검증 → 저장소 기록 → fold → 구독자 알림.
 */
export class GameSession {
  readonly state: RunState
  private readonly listeners = new Set<EventListener>()
  private readonly fold: FoldOptions
  private notifying = false
  private readonly queue: AnyEvent[] = []

  constructor(
    readonly runId: string,
    readonly config: GameConfig,
    private readonly sink: RunSink,
    private readonly elapsedMs: () => number,
  ) {
    this.state = createRunState(runId)
    this.fold = foldOptionsFor(config)
  }

  commit(draft: EventDraft): AnyEvent {
    if (draft.idempotencyKey) {
      const existing = this.state.idempotencyKeys.get(draft.idempotencyKey)
      if (existing !== undefined) return this.state.events[existing - 1] as AnyEvent
    }
    const payload = parseEventPayload(draft.type, draft.payload)
    const event = {
      runId: this.runId,
      seq: this.state.lastSeq + 1,
      type: draft.type,
      actor: draft.actor ?? 'server',
      visibility: draft.visibility,
      payload,
      simTime: this.state.simTime,
      wallMs: this.elapsedMs(),
      idempotencyKey: draft.idempotencyKey ?? null,
      schemaVersion: EVENT_SCHEMA_VERSION,
    } as AnyEvent
    this.sink.append(event)
    applyEvent(this.state, event, this.fold)
    this.notify(event)
    return event
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 구독자가 알림 안에서 다시 commit해도 순서가 지켜지도록 큐로 전달한다. */
  private notify(event: AnyEvent): void {
    this.queue.push(event)
    if (this.notifying) return
    this.notifying = true
    try {
      while (this.queue.length > 0) {
        const e = this.queue.shift() as AnyEvent
        for (const l of [...this.listeners]) l(e)
      }
    } finally {
      this.notifying = false
    }
  }
}
