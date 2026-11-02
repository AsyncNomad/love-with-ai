import type { AnyEvent, CastingView, HumanView, ParticipantView, PromptView, RoomView, TimerView, ViewPatch } from '@signal/shared'
import { PD_ROOM_ID, STAGE_META, applyPatch, emptyHumanView } from '@signal/shared'
import { canObserve, currentMembers, knownProfile } from '@signal/engine'
import type { GameSession } from './session'

export type PatchListener = (patches: ViewPatch[]) => void

/**
 * 사람 시점 화면 상태(D23). AI와 똑같이 canObserve로 거른 정보만 담는다.
 * 일정(단계 이름·시각)과 타이머는 공개 정보라 그대로 보여 준다.
 */
export class HumanViewProjector {
  private view: HumanView = emptyHumanView()
  private readonly listeners = new Set<PatchListener>()
  private pending: ViewPatch[] = []
  private flushScheduled = false
  private readonly avatars = new Map<string, string | null>()

  constructor(private readonly session: GameSession) {
    session.subscribe((e) => this.onEvent(e))
  }

  snapshot(): HumanView {
    return this.view
  }

  subscribe(listener: PatchListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setTimer(timer: TimerView | null): void {
    this.emit({ type: 'timer', timer })
  }

  setCasting(casting: CastingView | null): void {
    this.emit({ type: 'casting', casting })
  }

  upsertPrompt(prompt: PromptView): void {
    this.emit({ type: 'prompt', prompt })
  }

  resolvePrompt(id: string): void {
    if (this.view.prompts.some((p) => p.id === id)) this.emit({ type: 'promptResolved', id })
  }

  setTyping(roomId: string, participantIds: string[]): void {
    const human = this.session.state.humanId
    const room = this.session.state.rooms.get(roomId)
    if (!human || !room || !currentMembers(room).includes(human)) return
    const prev = this.view.typing[roomId] ?? []
    if (prev.length === participantIds.length && prev.every((p, i) => p === participantIds[i])) return
    this.emit({ type: 'typing', roomId, participantIds })
  }

  private get humanId(): string | null {
    return this.session.state.humanId
  }

  private onEvent(e: AnyEvent): void {
    const state = this.session.state
    switch (e.type) {
      case 'RUN_CREATED': {
        const view = emptyHumanView()
        view.runId = state.runId
        view.status = 'casting'
        view.rooms[PD_ROOM_ID] = { id: PD_ROOM_ID, kind: 'pd', location: 'PD', status: 'open', memberIds: [], isMember: true, lastActivitySeq: e.seq }
        view.messages[PD_ROOM_ID] = []
        this.emit({ type: 'reset', view })
        return
      }
      case 'PARTICIPANT_CAST':
        if (e.payload.participant.isHuman) {
          this.view = { ...this.view, meId: e.payload.participant.id }
          this.emitParticipant(e.payload.participant.id)
        }
        return
      case 'AVATAR_READY':
        this.avatars.set(e.payload.participantId, e.payload.url)
        if (this.view.participants[e.payload.participantId]) this.emitParticipant(e.payload.participantId)
        return
      case 'CASTING_COMPLETED':
        this.emitStatus()
        return
      case 'STAGE_STARTED': {
        const meta = STAGE_META[e.payload.stage]
        this.emit({ type: 'stage', stage: { id: e.payload.stage, label: meta.label, day: meta.day, simTime: e.payload.simTime } })
        return
      }
      case 'RUN_PAUSED':
      case 'RUN_RESUMED':
      case 'RUN_COMPLETED':
        this.emitStatus()
        return
      default:
        break
    }
    const human = this.humanId
    if (!human || !canObserve(state, human, e)) return
    switch (e.type) {
      case 'PROFILE_DISCLOSED':
        this.emitParticipant(e.payload.subjectId)
        return
      case 'MEMBER_JOINED':
      case 'MEMBER_LEFT':
      case 'ROOM_CLOSED':
        this.emitRoom(e.payload.roomId, e.seq)
        if (e.type === 'MEMBER_JOINED') this.ensureParticipantStub(e.payload.participantId)
        return
      case 'MESSAGE_SENT':
        this.emit({ type: 'message', message: { seq: e.seq, roomId: e.payload.roomId, senderId: e.actor, kind: 'chat', text: e.payload.text, simTime: e.simTime } })
        this.bumpRoom(e.payload.roomId, e.seq)
        return
      case 'PD_ANNOUNCED': {
        const roomId = e.payload.roomId ?? PD_ROOM_ID
        this.emit({ type: 'message', message: { seq: e.seq, roomId, senderId: null, kind: 'pd', text: e.payload.text, simTime: e.simTime } })
        this.bumpRoom(roomId, e.seq)
        return
      }
      default:
        return
    }
  }

  private emitStatus(): void {
    const s = this.session.state
    const status = s.status === 'casting' ? 'casting' : s.status
    this.emit({ type: 'status', status, pauseReason: s.pauseReason, completedReason: s.completedReason })
  }

  private participantView(id: string): ParticipantView | null {
    const state = this.session.state
    const human = this.humanId
    const rec = state.participants.get(id)
    if (!rec || !human) return null
    const k = knownProfile(state, human, id)
    if (k.name === null) return null
    return {
      id,
      name: k.name,
      gender: rec.cast.gender,
      isHuman: rec.cast.isHuman,
      isMe: id === human,
      age: k.age,
      occupation: k.occupation,
      avatarUrl: this.avatars.get(id) ?? null,
    }
  }

  private emitParticipant(id: string): void {
    const p = this.participantView(id)
    if (p) this.emit({ type: 'participant', participant: p })
  }

  /** 이름을 모르는 사람이 방에 들어와도 화면이 깨지지 않게 한다(이름 공개 전에는 표시하지 않음). */
  private ensureParticipantStub(id: string): void {
    if (!this.view.participants[id]) this.emitParticipant(id)
  }

  private roomView(roomId: string, seq: number): RoomView | null {
    const room = this.session.state.rooms.get(roomId)
    const human = this.humanId
    if (!room || !human) return null
    const members = currentMembers(room)
    const prev = this.view.rooms[roomId]
    return {
      id: roomId,
      kind: room.kind,
      location: room.location,
      status: room.closedSeq === null ? 'open' : 'closed',
      memberIds: members.includes(human) || !prev ? members : prev.memberIds,
      isMember: members.includes(human),
      lastActivitySeq: Math.max(prev?.lastActivitySeq ?? 0, seq),
    }
  }

  private emitRoom(roomId: string, seq: number): void {
    const r = this.roomView(roomId, seq)
    if (r) this.emit({ type: 'room', room: r })
  }

  private bumpRoom(roomId: string, seq: number): void {
    const prev = this.view.rooms[roomId]
    if (prev) this.emit({ type: 'room', room: { ...prev, lastActivitySeq: seq } })
  }

  private emit(patch: ViewPatch): void {
    this.view = applyPatch(this.view, patch)
    this.pending.push(patch)
    if (this.flushScheduled) return
    this.flushScheduled = true
    queueMicrotask(() => {
      this.flushScheduled = false
      const batch = this.pending
      this.pending = []
      for (const l of [...this.listeners]) l(batch)
    })
  }
}
