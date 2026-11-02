import type { HumanView, ParticipantView, RoomView } from '@signal/shared'

export function heart(p: ParticipantView | undefined): string {
  if (!p) return ''
  return p.gender === 'female' ? '💗' : '🩵'
}

export function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function simTimeLabel(sim: string): string {
  const m = /^D(\d) (\d{2}):(\d{2})$/.exec(sim)
  if (!m) return ''
  const h = Number(m[2])
  return `${m[1]}일차 ${h >= 24 ? '자정' : `${String(h).padStart(2, '0')}:${m[3]}`}`
}

export interface RoomDisplay {
  title: string
  icon: string
  avatarIds: string[]
}

/** 방 이름: 거실은 🏠, 1:1은 상대 이름, 그룹은 참가자 이름 나열, PD는 📣. */
export function roomDisplay(room: RoomView, view: HumanView): RoomDisplay {
  const others = room.memberIds.filter((id) => id !== view.meId)
  if (room.kind === 'pd') return { title: 'PD 안내', icon: '📣', avatarIds: [] }
  if (room.kind === 'living') return { title: '거실', icon: '🏠', avatarIds: others.slice(0, 4) }
  const names = others.map((id) => view.participants[id]?.name ?? '?')
  if (others.length === 1) {
    const p = view.participants[others[0] ?? '']
    return { title: p?.name ?? '?', icon: heart(p), avatarIds: others }
  }
  return { title: names.join(', '), icon: '👥', avatarIds: others.slice(0, 4) }
}

/** 아바타 글자: 한글 3글자 이상이면 이름 첫 글자(성 제외), 그 밖에는 첫 글자. */
export function initials(name: string): string {
  return /^[가-힣]{3,}$/.test(name) ? name.slice(name.length === 4 ? 2 : 1, name.length === 4 ? 3 : 2) : name.slice(0, 1).toUpperCase()
}
