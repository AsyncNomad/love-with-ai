import type { ParticipantId, RoomId, RoomKind } from '@heart/shared'
import { currentMembers, mustParticipant } from '@heart/engine'
import type { GameSession } from './session'

export const LIVING_ROOM: RoomId = 'living'
const PRIVATE_LOCATIONS = ['마당', '테라스', '서재', '루프탑', '정원 벤치', '주방'] as const

/**
 * 공간 조작(방, 멤버십, 입장, 공개, PD 안내). 모든 변경은 이벤트로 남는다.
 * 가시성은 여기서 정한다: 방 안의 일은 room, 하우스 전체 공지는 house, 개인 안내는 participants.
 */
export class House {
  private roomCounter = 0
  private locationCursor = 0

  constructor(private readonly session: GameSession) {}

  private get state() {
    return this.session.state
  }

  openLiving(): void {
    if (this.state.rooms.has(LIVING_ROOM)) return
    this.session.commit({ type: 'ROOM_OPENED', payload: { roomId: LIVING_ROOM, kind: 'living', location: '거실' }, visibility: { kind: 'server' } })
  }

  openRoom(kind: RoomKind, location?: string): RoomId {
    const roomId = `room_${String(++this.roomCounter).padStart(3, '0')}`
    const loc = location ?? PRIVATE_LOCATIONS[this.locationCursor++ % PRIVATE_LOCATIONS.length] ?? '마당'
    this.session.commit({ type: 'ROOM_OPENED', payload: { roomId, kind, location: loc }, visibility: { kind: 'server' } })
    return roomId
  }

  closeRoom(roomId: RoomId): void {
    const room = this.state.rooms.get(roomId)
    if (!room || room.closedSeq !== null) return
    this.session.commit({ type: 'ROOM_CLOSED', payload: { roomId }, visibility: { kind: 'room' } })
  }

  join(roomId: RoomId, pid: ParticipantId): void {
    const room = this.state.rooms.get(roomId)
    if (!room || room.closedSeq !== null || currentMembers(room).includes(pid)) return
    this.session.commit({ type: 'MEMBER_JOINED', payload: { roomId, participantId: pid }, visibility: { kind: 'room' } })
  }

  leave(roomId: RoomId, pid: ParticipantId): void {
    const room = this.state.rooms.get(roomId)
    if (!room || !currentMembers(room).includes(pid)) return
    this.session.commit({ type: 'MEMBER_LEFT', payload: { roomId, participantId: pid }, visibility: { kind: 'room' } })
  }

  /** 지금 있는 방에서 나와 대상 방으로 옮긴다. */
  moveTo(roomId: RoomId, pid: ParticipantId): void {
    for (const r of this.roomsOf(pid)) if (r !== roomId) this.leave(r, pid)
    this.join(roomId, pid)
  }

  roomsOf(pid: ParticipantId): RoomId[] {
    return [...this.state.rooms.values()].filter((r) => r.closedSeq === null && currentMembers(r).includes(pid)).map((r) => r.id)
  }

  members(roomId: RoomId): ParticipantId[] {
    const room = this.state.rooms.get(roomId)
    return room ? currentMembers(room) : []
  }

  isOpen(roomId: RoomId): boolean {
    const room = this.state.rooms.get(roomId)
    return !!room && room.closedSeq === null
  }

  /**
   * 하우스 입장(game-rules.md §4.1): 입장 이벤트, 새 입주자 이름의 하우스 공개,
   * 그리고 이미 와 있던 사람들의 이름을 새 입주자에게만 알려 준다(마주 보고 인사하는 순간).
   */
  enterHouse(pid: ParticipantId): void {
    const p = mustParticipant(this.state, pid)
    if (p.enteredSeq !== null) return
    const residents = [...this.state.participants.values()].filter((x) => x.enteredSeq !== null).map((x) => x.cast)
    this.session.commit({ type: 'HOUSE_ENTERED', payload: { participantId: pid }, visibility: { kind: 'house' }, idempotencyKey: `enter:${pid}` })
    this.session.commit({ type: 'PROFILE_DISCLOSED', payload: { subjectId: pid, fields: { name: p.cast.name } }, visibility: { kind: 'house' } })
    for (const r of residents) {
      this.session.commit({ type: 'PROFILE_DISCLOSED', payload: { subjectId: r.id, fields: { name: r.name } }, visibility: { kind: 'participants', ids: [pid] } })
    }
  }

  disclose(pid: ParticipantId, fields: { age?: number; occupation?: string }): void {
    this.session.commit({ type: 'PROFILE_DISCLOSED', payload: { subjectId: pid, fields }, visibility: { kind: 'house' } })
  }

  /** PD 안내. roomId가 있으면 그 방에만, to가 있으면 그 사람에게만, 둘 다 없으면 하우스 전체에. */
  announce(key: string, text: string, opts: { roomId?: RoomId; to?: ParticipantId[] } = {}): void {
    const roomId = opts.roomId ?? null
    const visibility = opts.to ? { kind: 'participants' as const, ids: opts.to } : roomId ? { kind: 'room' as const } : { kind: 'house' as const }
    this.session.commit({ type: 'PD_ANNOUNCED', actor: 'pd', payload: { roomId, key, text }, visibility })
  }

  say(roomId: RoomId, speakerId: ParticipantId, text: string, background: boolean): boolean {
    if (!this.isOpen(roomId) || !this.members(roomId).includes(speakerId)) return false
    this.session.commit({ type: 'MESSAGE_SENT', actor: speakerId, payload: { roomId, text, background }, visibility: { kind: 'room' } })
    return true
  }
}
