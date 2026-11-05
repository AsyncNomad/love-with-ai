import type {
  AnyEvent,
  CastParticipant,
  GameEvent,
  HumanProfile,
  MemoryKind,
  ParticipantId,
  PersonaFlavor,
  RoomId,
  RoomKind,
  SpeechAnswer,
  SpeechLevel,
  SpeechProposalKind,
  StageId,
  VoteKind,
} from '@heart/shared'
import { STAGE_META } from '@heart/shared'

export interface Membership {
  participantId: ParticipantId
  joinedSeq: number
  /** 퇴장 이벤트의 seq. 퇴장 이벤트 자체는 퇴장자도 관찰한다. */
  leftSeq: number | null
}

export interface RoomRecord {
  id: RoomId
  kind: RoomKind
  location: string
  openedSeq: number
  closedSeq: number | null
  memberships: Membership[]
}

export interface ParticipantRecord {
  cast: CastParticipant
  castSeq: number
  flavor: PersonaFlavor | null
  flavorSeq: number | null
  avatarUrl: string | null
  enteredSeq: number | null
}

export interface Ballot {
  targetId: ParticipantId | null
  reason: string | null
  auto: boolean
  seq: number
}

export interface VoteRecord {
  id: string
  kind: VoteKind
  stage: StageId
  openedSeq: number
  closedSeq: number | null
  ballots: Map<ParticipantId, Ballot>
}

export interface RelationshipState {
  interest: number
  comfort: number
  trust: number
  curiosity: number
  /** 이 관계 상태를 만든 RELATIONSHIP_UPDATED seq 목록 */
  updateSeqs: number[]
}

export interface MemoryRecord {
  seq: number
  memoryId: string
  ownerId: ParticipantId
  kind: MemoryKind
  content: string
  aboutIds: ParticipantId[]
  sourceSeqs: number[]
}

export interface SpeechProposalRecord {
  proposalId: string
  fromId: ParticipantId
  toId: ParticipantId
  kind: SpeechProposalKind
  seq: number
  answer: SpeechAnswer | null
}

export type RunStatus = 'casting' | 'running' | 'paused' | 'completed'

export interface RunState {
  runId: string
  seed: string
  timeScale: number
  human: HumanProfile | null
  humanId: ParticipantId | null
  status: RunStatus
  pauseReason: string | null
  completedReason: string | null
  lastSeq: number
  stage: StageId | null
  simTime: string
  events: AnyEvent[]
  participants: Map<ParticipantId, ParticipantRecord>
  rooms: Map<RoomId, RoomRecord>
  votes: Map<string, VoteRecord>
  relationships: Map<string, RelationshipState>
  /** 방향 있는 말투: directedKey(from, to) → from이 to에게 쓰는 말투. 없으면 존댓말(D38). */
  speechLevels: Map<string, SpeechLevel>
  /** 말 놓기 제안 기록: pairKey → 제안. 한 쌍에 한 번만 제안한다(game-rules.md §11.2). */
  speechProposals: Map<string, SpeechProposalRecord>
  memories: MemoryRecord[]
  /** 쌍(정렬된 키)별 상호작용 가중치 합. 노출량 계산에 쓴다(design.md §10.2). */
  interaction: Map<string, number>
  idempotencyKeys: Map<string, number>
}

export function createRunState(runId: string): RunState {
  return {
    runId,
    seed: '',
    timeScale: 1,
    human: null,
    humanId: null,
    status: 'casting',
    pauseReason: null,
    completedReason: null,
    lastSeq: 0,
    stage: null,
    simTime: STAGE_META.CASTING.simTime,
    events: [],
    participants: new Map(),
    rooms: new Map(),
    votes: new Map(),
    relationships: new Map(),
    speechLevels: new Map(),
    speechProposals: new Map(),
    memories: [],
    interaction: new Map(),
    idempotencyKeys: new Map(),
  }
}

export const directedKey = (a: ParticipantId, b: ParticipantId): string => `${a}>${b}`
export const pairKey = (a: ParticipantId, b: ParticipantId): string => (a < b ? `${a}|${b}` : `${b}|${a}`)

export interface InteractionWeights {
  private: number
  groupMention: number
  groupAmbient: number
  backgroundMultiplier: number
}

export interface FoldOptions {
  relationshipInitial: { interest: number; comfort: number; trust: number; curiosity: number }
  interactionWeights: InteractionWeights
  /** 메시지 본문에서 지목된 참가자를 찾는다(aliases). 주입해서 fold를 순수하게 유지한다. */
  mentions: (state: RunState, text: string, candidates: ParticipantId[]) => ParticipantId[]
}

export function currentMembers(room: RoomRecord): ParticipantId[] {
  return room.memberships.filter((m) => m.leftSeq === null).map((m) => m.participantId)
}

export function membersAt(room: RoomRecord, seq: number): ParticipantId[] {
  return room.memberships
    .filter((m) => m.joinedSeq <= seq && (m.leftSeq === null || seq <= m.leftSeq))
    .map((m) => m.participantId)
}

export function getRelationship(
  state: RunState,
  source: ParticipantId,
  target: ParticipantId,
  initial: FoldOptions['relationshipInitial'],
): RelationshipState {
  return state.relationships.get(directedKey(source, target)) ?? { ...initial, updateSeqs: [] }
}

const clamp = (v: number): number => Math.max(0, Math.min(100, v))

/** 이벤트 하나를 상태에 반영한다. 상태는 세션이 단독으로 소유하므로 제자리에서 갱신한다. */
export function applyEvent(state: RunState, event: AnyEvent, opts: FoldOptions): void {
  if (event.seq !== state.lastSeq + 1) {
    throw new Error(`event seq gap: expected ${state.lastSeq + 1}, got ${event.seq}`)
  }
  state.lastSeq = event.seq
  state.events.push(event)
  if (event.idempotencyKey) state.idempotencyKeys.set(event.idempotencyKey, event.seq)

  switch (event.type) {
    case 'RUN_CREATED':
      state.seed = event.payload.seed
      state.human = event.payload.human
      state.timeScale = event.payload.timeScale
      break
    case 'PARTICIPANT_CAST': {
      const cast = event.payload.participant
      state.participants.set(cast.id, {
        cast,
        castSeq: event.seq,
        flavor: null,
        flavorSeq: null,
        avatarUrl: null,
        enteredSeq: null,
      })
      if (cast.isHuman) state.humanId = cast.id
      break
    }
    case 'PERSONA_FLAVORED': {
      const p = mustParticipant(state, event.payload.participantId)
      p.flavor = event.payload.flavor
      p.flavorSeq = event.seq
      break
    }
    case 'AVATAR_READY':
      mustParticipant(state, event.payload.participantId).avatarUrl = event.payload.url
      break
    case 'CASTING_COMPLETED':
      state.status = 'running'
      break
    case 'STAGE_STARTED':
      state.stage = event.payload.stage
      state.simTime = event.payload.simTime
      break
    case 'HOUSE_ENTERED':
      mustParticipant(state, event.payload.participantId).enteredSeq = event.seq
      break
    case 'PROFILE_DISCLOSED':
      break
    case 'ROOM_OPENED':
      if (state.rooms.has(event.payload.roomId)) throw new Error(`room already exists: ${event.payload.roomId}`)
      state.rooms.set(event.payload.roomId, {
        id: event.payload.roomId,
        kind: event.payload.kind,
        location: event.payload.location,
        openedSeq: event.seq,
        closedSeq: null,
        memberships: [],
      })
      break
    case 'ROOM_CLOSED': {
      const room = mustRoom(state, event.payload.roomId)
      room.closedSeq = event.seq
      for (const m of room.memberships) if (m.leftSeq === null) m.leftSeq = event.seq
      break
    }
    case 'MEMBER_JOINED': {
      const room = mustRoom(state, event.payload.roomId)
      if (room.closedSeq !== null) throw new Error(`cannot join closed room ${room.id}`)
      if (currentMembers(room).includes(event.payload.participantId)) break
      room.memberships.push({ participantId: event.payload.participantId, joinedSeq: event.seq, leftSeq: null })
      break
    }
    case 'MEMBER_LEFT': {
      const room = mustRoom(state, event.payload.roomId)
      const m = room.memberships.find((x) => x.participantId === event.payload.participantId && x.leftSeq === null)
      if (m) m.leftSeq = event.seq
      break
    }
    case 'MESSAGE_SENT':
      recordInteraction(state, event, opts)
      break
    case 'VOTE_OPENED':
      state.votes.set(event.payload.voteId, {
        id: event.payload.voteId,
        kind: event.payload.kind,
        stage: state.stage ?? 'CASTING',
        openedSeq: event.seq,
        closedSeq: null,
        ballots: new Map(),
      })
      break
    case 'VOTE_COMMITTED': {
      const vote = mustVote(state, event.payload.voteId)
      if (!vote.ballots.has(event.payload.voterId)) {
        vote.ballots.set(event.payload.voterId, {
          targetId: event.payload.targetId,
          reason: event.payload.reason,
          auto: event.payload.auto,
          seq: event.seq,
        })
      }
      break
    }
    case 'VOTE_CLOSED':
      mustVote(state, event.payload.voteId).closedSeq = event.seq
      break
    case 'MEMORY_RECORDED':
      state.memories.push({ seq: event.seq, ...event.payload })
      break
    case 'RELATIONSHIP_UPDATED': {
      const { sourceId, targetId, deltas } = event.payload
      const cur = getRelationship(state, sourceId, targetId, opts.relationshipInitial)
      state.relationships.set(directedKey(sourceId, targetId), {
        interest: clamp(cur.interest + deltas.interest),
        comfort: clamp(cur.comfort + deltas.comfort),
        trust: clamp(cur.trust + deltas.trust),
        curiosity: clamp(cur.curiosity + deltas.curiosity),
        updateSeqs: [...cur.updateSeqs, event.seq],
      })
      break
    }
    case 'SPEECH_LEVEL_CHANGED':
      // 옛 회차(대칭 말투) 호환: 양방향 모두 바꾼다.
      state.speechLevels.set(directedKey(event.payload.aId, event.payload.bId), event.payload.level)
      state.speechLevels.set(directedKey(event.payload.bId, event.payload.aId), event.payload.level)
      break
    case 'SPEECH_LEVEL_SET':
      state.speechLevels.set(directedKey(event.payload.fromId, event.payload.toId), event.payload.level)
      break
    case 'SPEECH_PROPOSED':
      state.speechProposals.set(pairKey(event.payload.fromId, event.payload.toId), {
        proposalId: event.payload.proposalId,
        fromId: event.payload.fromId,
        toId: event.payload.toId,
        kind: event.payload.kind,
        seq: event.seq,
        answer: null,
      })
      break
    case 'SPEECH_ANSWERED': {
      const p = state.speechProposals.get(pairKey(event.payload.fromId, event.payload.toId))
      if (p && p.proposalId === event.payload.proposalId) p.answer = event.payload.answer
      break
    }
    case 'RUN_PAUSED':
      state.status = 'paused'
      state.pauseReason = event.payload.reason
      break
    case 'RUN_RESUMED':
      state.status = 'running'
      state.pauseReason = null
      break
    case 'RUN_COMPLETED':
      state.status = 'completed'
      state.completedReason = event.payload.reason
      break
    case 'INVITE_DECIDED':
    case 'ACTIVITY_CHOSEN':
    case 'SIGNAL_CARD_SENT':
    case 'SIGNAL_CARD_RECEIVED':
    case 'MAILBOX_QUESTION':
    case 'MAILBOX_ANSWER':
    case 'MATCHES_COMPUTED':
    case 'TALKS_PLANNED':
    case 'TALK_SKIPPED':
    case 'LLM_OUTPUT_REJECTED':
      break
  }
}

function recordInteraction(state: RunState, event: GameEvent<'MESSAGE_SENT'>, opts: FoldOptions): void {
  const speaker = event.actor
  const room = state.rooms.get(event.payload.roomId)
  if (!room || !state.participants.has(speaker)) return
  const others = membersAt(room, event.seq).filter((id) => id !== speaker)
  const w = opts.interactionWeights
  const mult = event.payload.background ? w.backgroundMultiplier : 1
  const add = (other: ParticipantId, amount: number): void => {
    const key = pairKey(speaker, other)
    state.interaction.set(key, (state.interaction.get(key) ?? 0) + amount * mult)
  }
  if (others.length === 1) {
    add(others[0] as ParticipantId, w.private)
    return
  }
  const mentioned = new Set(opts.mentions(state, event.payload.text, others))
  for (const other of others) add(other, mentioned.has(other) ? w.groupMention : w.groupAmbient)
}

export function mustParticipant(state: RunState, id: ParticipantId): ParticipantRecord {
  const p = state.participants.get(id)
  if (!p) throw new Error(`unknown participant: ${id}`)
  return p
}

export function mustRoom(state: RunState, id: RoomId): RoomRecord {
  const r = state.rooms.get(id)
  if (!r) throw new Error(`unknown room: ${id}`)
  return r
}

export function mustVote(state: RunState, id: string): VoteRecord {
  const v = state.votes.get(id)
  if (!v) throw new Error(`unknown vote: ${id}`)
  return v
}

export function aiParticipants(state: RunState): ParticipantRecord[] {
  return [...state.participants.values()].filter((p) => !p.cast.isHuman)
}

export function enteredParticipants(state: RunState): ParticipantRecord[] {
  return [...state.participants.values()].filter((p) => p.enteredSeq !== null)
}
