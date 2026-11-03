import { z } from 'zod'
import { humanProfileSchema, type Gender, type RoomKind, type StageId } from './domain'

/**
 * 서버와 웹 클라이언트 사이의 프로토콜. 서버는 사람 시점으로 이미 걸러진 정보만 보낸다(D23).
 */

export interface ParticipantView {
  id: string
  name: string
  gender: Gender
  isHuman: boolean
  isMe: boolean
  age: number | null
  occupation: string | null
  avatarUrl: string | null
}

export interface RoomView {
  id: string
  /** 'pd'는 PD 안내만 모아 보여 주는 가상 방이다. */
  kind: RoomKind | 'pd'
  location: string
  status: 'open' | 'closed'
  memberIds: string[]
  isMember: boolean
  /** 사람이 이 방에서 마지막으로 활동한 정렬 키. 목록 정렬에 쓴다. */
  lastActivitySeq: number
}

export interface MessageView {
  seq: number
  roomId: string
  /** null이면 PD·시스템 메시지 */
  senderId: string | null
  kind: 'chat' | 'pd'
  text: string
  simTime: string
}

export type PromptView =
  | {
      id: string
      kind: 'vote'
      voteId: string
      title: string
      description: string
      candidateIds: string[]
      allowAbstain: boolean
      confirmTwice: boolean
    }
  | { id: string; kind: 'invite'; voteId: string; candidateIds: string[]; maxAccept: number }
  | { id: string; kind: 'intro'; maxChars: number }
  | { id: string; kind: 'resume'; reason: string }
  | { id: string; kind: 'activity'; options: { id: string; name: string; description: string }[] }
  | { id: string; kind: 'card'; candidateIds: string[]; maxChars: number }
  | { id: string; kind: 'mailboxAsk'; candidateIds: string[]; maxChars: number }
  | { id: string; kind: 'mailboxAnswer'; questionId: string; askerId: string; question: string; maxChars: number }
  | { id: string; kind: 'epilogue'; epilogue: EpilogueView }

/** 에필로그(game-rules.md §6.5). 사람이 볼 수 있는 정보만 담는다. */
export interface EpilogueView {
  /** 사람 본인의 날짜별 선택 */
  myChoices: { label: string; targetId: string | null }[]
  /** 사람의 최종 선택과, 그 상대의 최종 선택(공개 규칙 §6.4) */
  finalPick: string | null
  partnerPick: string | null
  matched: boolean
  /** 성사된 커플 전체 */
  couples: [string, string][]
}

export interface TimerView {
  label: string
  totalMs: number
  remainingMs: number
  paused: boolean
}

export interface CastingView {
  phase: 'persona' | 'images' | 'ready'
  done: number
  total: number
}

export type RunStatus = 'idle' | 'casting' | 'running' | 'paused' | 'completed'

export interface HumanView {
  runId: string | null
  status: RunStatus
  completedReason: string | null
  pauseReason: string | null
  casting: CastingView | null
  stage: { id: StageId; label: string; day: number; simTime: string } | null
  timer: TimerView | null
  meId: string | null
  participants: Record<string, ParticipantView>
  rooms: Record<string, RoomView>
  messages: Record<string, MessageView[]>
  prompts: PromptView[]
  typing: Record<string, string[]>
}

export const PD_ROOM_ID = 'pd'

export function emptyHumanView(): HumanView {
  return {
    runId: null,
    status: 'idle',
    completedReason: null,
    pauseReason: null,
    casting: null,
    stage: null,
    timer: null,
    meId: null,
    participants: {},
    rooms: {},
    messages: {},
    prompts: [],
    typing: {},
  }
}

export type ViewPatch =
  | { type: 'reset'; view: HumanView }
  | { type: 'status'; status: RunStatus; pauseReason: string | null; completedReason: string | null }
  | { type: 'casting'; casting: CastingView | null }
  | { type: 'stage'; stage: HumanView['stage'] }
  | { type: 'timer'; timer: TimerView | null }
  | { type: 'participant'; participant: ParticipantView }
  | { type: 'room'; room: RoomView }
  | { type: 'message'; message: MessageView }
  | { type: 'prompt'; prompt: PromptView }
  | { type: 'promptResolved'; id: string }
  | { type: 'typing'; roomId: string; participantIds: string[] }

/** 서버(스냅샷 유지)와 클라이언트(화면 상태)가 함께 쓰는 순수 리듀서. */
export function applyPatch(view: HumanView, patch: ViewPatch): HumanView {
  switch (patch.type) {
    case 'reset':
      return patch.view
    case 'status':
      return { ...view, status: patch.status, pauseReason: patch.pauseReason, completedReason: patch.completedReason }
    case 'casting':
      return { ...view, casting: patch.casting }
    case 'stage':
      return { ...view, stage: patch.stage }
    case 'timer':
      return { ...view, timer: patch.timer }
    case 'participant':
      return { ...view, participants: { ...view.participants, [patch.participant.id]: patch.participant } }
    case 'room':
      return { ...view, rooms: { ...view.rooms, [patch.room.id]: patch.room } }
    case 'message': {
      const list = view.messages[patch.message.roomId] ?? []
      if (list.some((m) => m.seq === patch.message.seq)) return view
      return { ...view, messages: { ...view.messages, [patch.message.roomId]: [...list, patch.message] } }
    }
    case 'prompt':
      return { ...view, prompts: [...view.prompts.filter((p) => p.id !== patch.prompt.id), patch.prompt] }
    case 'promptResolved':
      return { ...view, prompts: view.prompts.filter((p) => p.id !== patch.id) }
    case 'typing':
      return { ...view, typing: { ...view.typing, [patch.roomId]: patch.participantIds } }
  }
}

export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('createRun'), profile: humanProfileSchema }),
  z.object({ type: z.literal('sendMessage'), roomId: z.string(), text: z.string().trim().min(1).max(300) }),
  z.object({ type: z.literal('submitVote'), voteId: z.string(), targetId: z.string().nullable() }),
  z.object({ type: z.literal('respondInvite'), voteId: z.string(), acceptIds: z.array(z.string()) }),
  z.object({ type: z.literal('submitIntro'), text: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal('skipTalk'), roomId: z.string() }),
  z.object({ type: z.literal('resume') }),
  z.object({ type: z.literal('chooseActivity'), first: z.string(), second: z.string() }),
  z.object({ type: z.literal('sendCard'), targetId: z.string().nullable(), text: z.string().trim().max(200) }),
  z.object({ type: z.literal('askQuestion'), targetId: z.string().nullable(), text: z.string().trim().max(200) }),
  z.object({ type: z.literal('answerQuestion'), questionId: z.string(), text: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal('closeEpilogue') }),
])
export type Command = z.infer<typeof commandSchema>

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello') }),
  z.object({ type: z.literal('command'), commandId: z.string().min(1).max(64), command: commandSchema }),
])
export type ClientMessage = z.infer<typeof clientMessageSchema>

export type ServerMessage =
  | { type: 'snapshot'; view: HumanView }
  | { type: 'patch'; patches: ViewPatch[] }
  | { type: 'ack'; commandId: string; ok: boolean; error?: string }
