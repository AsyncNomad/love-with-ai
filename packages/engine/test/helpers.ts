import type { AnyEvent, EventDraft } from '@signal/shared'
import { EVENT_SCHEMA_VERSION } from '@signal/shared'
import { defaultConfig } from '@signal/config'
import { applyEvent, createRunState, findMentions, type FoldOptions, type RunState } from '../src'

export const foldOptions: FoldOptions = {
  relationshipInitial: defaultConfig.relationship.initial,
  interactionWeights: defaultConfig.relationship.exposureWeights,
  mentions: (state, text, candidates) =>
    findMentions(
      text,
      candidates.map((id) => ({ id, name: state.participants.get(id)?.cast.name ?? '' })),
    ),
}

export class StateBuilder {
  readonly state: RunState = createRunState('run_test')

  push(draft: EventDraft): AnyEvent {
    const event = {
      ...draft,
      runId: this.state.runId,
      seq: this.state.lastSeq + 1,
      actor: draft.actor ?? 'server',
      simTime: this.state.simTime,
      wallMs: 0,
      idempotencyKey: draft.idempotencyKey ?? null,
      schemaVersion: EVENT_SCHEMA_VERSION,
    } as AnyEvent
    applyEvent(this.state, event, foldOptions)
    return event
  }
}
