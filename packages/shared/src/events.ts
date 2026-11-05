import { z } from 'zod'
import {
  castParticipantSchema,
  humanProfileSchema,
  personaFlavorSchema,
  roomKindSchema,
  stageIdSchema,
  voteKindSchema,
  MEMORY_KINDS,
  SPEECH_ANSWERS,
  SPEECH_LEVELS,
  SPEECH_PROPOSAL_KINDS,
} from './domain'

export const EVENT_SCHEMA_VERSION = 1

/** design.md §5.1 */
export const visibilitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('room') }),
  z.object({ kind: z.literal('house') }),
  z.object({ kind: z.literal('participants'), ids: z.array(z.string()) }),
  z.object({ kind: z.literal('server') }),
])
export type Visibility = z.infer<typeof visibilitySchema>

const relationshipDeltaSchema = z.object({
  interest: z.number(),
  comfort: z.number(),
  trust: z.number(),
  curiosity: z.number(),
})

export const eventPayloadSchemas = {
  RUN_CREATED: z.object({ seed: z.string(), human: humanProfileSchema, timeScale: z.number().positive() }),
  PARTICIPANT_CAST: z.object({ participant: castParticipantSchema }),
  PERSONA_FLAVORED: z.object({ participantId: z.string(), flavor: personaFlavorSchema, fallback: z.boolean() }),
  AVATAR_READY: z.object({ participantId: z.string(), url: z.string().nullable() }),
  CASTING_COMPLETED: z.object({}),
  STAGE_STARTED: z.object({ stage: stageIdSchema, simTime: z.string() }),
  HOUSE_ENTERED: z.object({ participantId: z.string() }),
  PROFILE_DISCLOSED: z.object({
    subjectId: z.string(),
    fields: z.object({ name: z.string().optional(), age: z.number().optional(), occupation: z.string().optional() }),
  }),
  ROOM_OPENED: z.object({ roomId: z.string(), kind: roomKindSchema, location: z.string() }),
  ROOM_CLOSED: z.object({ roomId: z.string() }),
  MEMBER_JOINED: z.object({ roomId: z.string(), participantId: z.string() }),
  MEMBER_LEFT: z.object({ roomId: z.string(), participantId: z.string() }),
  MESSAGE_SENT: z.object({ roomId: z.string(), text: z.string(), background: z.boolean() }),
  PD_ANNOUNCED: z.object({ roomId: z.string().nullable(), key: z.string(), text: z.string() }),
  VOTE_OPENED: z.object({ voteId: z.string(), kind: voteKindSchema }),
  VOTE_COMMITTED: z.object({
    voteId: z.string(),
    voterId: z.string(),
    targetId: z.string().nullable(),
    reason: z.string().nullable(),
    auto: z.boolean(),
  }),
  VOTE_CLOSED: z.object({ voteId: z.string() }),
  INVITE_DECIDED: z.object({
    voteId: z.string(),
    targetId: z.string(),
    candidateIds: z.array(z.string()),
    acceptedIds: z.array(z.string()),
  }),
  TALKS_PLANNED: z.object({
    stage: stageIdSchema,
    slots: z.array(z.array(z.object({ members: z.array(z.string()), required: z.boolean() }))),
    dropped: z.array(z.array(z.string())),
  }),
  TALK_SKIPPED: z.object({ roomId: z.string(), participantId: z.string() }),
  /** 2일차 활동 지망(game-rules.md §5.4). 본인만 안다. */
  ACTIVITY_CHOSEN: z.object({ participantId: z.string(), first: z.string(), second: z.string(), auto: z.boolean() }),
  /** 시그널 카드 작성(§5.5). 보낸 사람만 안다. 유보하면 targetId가 null이다. */
  SIGNAL_CARD_SENT: z.object({ senderId: z.string(), targetId: z.string().nullable(), text: z.string() }),
  /** 시그널 카드 전달. 받는 사람만 보고, 보낸 사람을 가리키는 값은 어떤 필드에도 넣지 않는다. */
  SIGNAL_CARD_RECEIVED: z.object({ recipientId: z.string(), text: z.string() }),
  /** 시그널 우체통(§6.1). 질문자와 수신자만 안다. */
  MAILBOX_QUESTION: z.object({ questionId: z.string(), askerId: z.string(), targetId: z.string(), text: z.string() }),
  MAILBOX_ANSWER: z.object({ questionId: z.string(), answererId: z.string(), text: z.string() }),
  /** 최종 매칭 계산 결과(§6.4). 발표는 PD 안내로 따로 한다. */
  MATCHES_COMPUTED: z.object({ voteId: z.string(), pairs: z.array(z.tuple([z.string(), z.string()])) }),
  MEMORY_RECORDED: z.object({
    memoryId: z.string(),
    ownerId: z.string(),
    kind: z.enum(MEMORY_KINDS),
    content: z.string(),
    aboutIds: z.array(z.string()),
    sourceSeqs: z.array(z.number().int()),
  }),
  RELATIONSHIP_UPDATED: z.object({
    sourceId: z.string(),
    targetId: z.string(),
    deltas: relationshipDeltaSchema,
    significant: z.boolean(),
    reason: z.string(),
    evidenceSeqs: z.array(z.number().int()),
  }),
  /** 옛 회차 호환용(대칭). 새 코드는 SPEECH_LEVEL_SET을 쓴다(D38). */
  SPEECH_LEVEL_CHANGED: z.object({ aId: z.string(), bId: z.string(), level: z.enum(SPEECH_LEVELS) }),
  /** 말 놓기 제안(game-rules.md §11). 그 방에 있던 사람이 안다. */
  SPEECH_PROPOSED: z.object({ proposalId: z.string(), roomId: z.string(), fromId: z.string(), toId: z.string(), kind: z.enum(SPEECH_PROPOSAL_KINDS) }),
  SPEECH_ANSWERED: z.object({ proposalId: z.string(), roomId: z.string(), fromId: z.string(), toId: z.string(), answer: z.enum(SPEECH_ANSWERS) }),
  /** 방향 있는 말투 변경: fromId가 toId에게 쓰는 말투. 두 당사자만 안다. */
  SPEECH_LEVEL_SET: z.object({ fromId: z.string(), toId: z.string(), level: z.enum(SPEECH_LEVELS) }),
  LLM_OUTPUT_REJECTED: z.object({ task: z.string(), ownerId: z.string().nullable(), reasons: z.array(z.string()) }),
  RUN_PAUSED: z.object({ reason: z.string() }),
  RUN_RESUMED: z.object({}),
  RUN_COMPLETED: z.object({ reason: z.string() }),
} as const

export type EventType = keyof typeof eventPayloadSchemas
export type EventPayloads = { [K in EventType]: z.infer<(typeof eventPayloadSchemas)[K]> }

export type Actor = string | 'server' | 'pd'

export interface EventEnvelope {
  runId: string
  seq: number
  actor: Actor
  visibility: Visibility
  simTime: string
  /** 회차 시작 후 단조 경과 시간(ms). 벽시계를 쓰지 않는다(D15). */
  wallMs: number
  idempotencyKey: string | null
  schemaVersion: number
}

export type GameEvent<K extends EventType = EventType> = EventEnvelope & { type: K; payload: EventPayloads[K] }
export type AnyEvent = { [K in EventType]: GameEvent<K> }[EventType]

export type EventDraft = {
  [K in EventType]: {
    type: K
    payload: EventPayloads[K]
    actor?: Actor
    visibility: Visibility
    idempotencyKey?: string
  }
}[EventType]

export type EventOf<K extends EventType> = Extract<AnyEvent, { type: K }>

export function isEvent<K extends EventType>(e: AnyEvent, type: K): e is EventOf<K> {
  return e.type === type
}

/** 저장소 경계에서 쓰는 검증. 알 수 없는 타입이나 잘못된 payload는 예외를 던진다. */
export function parseEventPayload<K extends EventType>(type: K, payload: unknown): EventPayloads[K] {
  const schema = eventPayloadSchemas[type] as unknown as z.ZodType<EventPayloads[K]>
  return schema.parse(payload)
}

export function isEventType(value: string): value is EventType {
  return Object.hasOwn(eventPayloadSchemas, value)
}

/** 이벤트의 방(있다면). room 가시성 판정에 쓴다. */
export function eventRoomId(e: AnyEvent): string | null {
  const p = e.payload as { roomId?: unknown }
  return typeof p.roomId === 'string' ? p.roomId : null
}
