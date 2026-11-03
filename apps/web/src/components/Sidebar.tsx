import type { HumanView, RoomView } from '@heart/shared'
import { roomDisplay, simTimeLabel } from '../lib/format'
import { AvatarStack } from './Avatar'
import styles from './Sidebar.module.css'

interface Props {
  view: HumanView
  rooms: RoomView[]
  selectedId: string | null
  unread: Set<string>
  onSelect(id: string): void
  /** false면 접혀서 폭이 0이 된다(왼쪽 위 ☰ 버튼). */
  open: boolean
}

export function Sidebar({ view, rooms, selectedId, unread, onSelect, open }: Props) {
  return (
    <aside className={`${styles.sidebar} ${open ? '' : styles.collapsed}`} aria-hidden={!open}>
      <header className={styles.brand}>
        <div className={styles.logo} aria-hidden>
          <svg viewBox="0 0 64 64" width="44" height="44">
            <path d="M32 46s-14-8.6-14-18a7.5 7.5 0 0 1 14-3.7A7.5 7.5 0 0 1 46 28c0 9.4-14 18-14 18z" fill="#fff" />
          </svg>
        </div>
        <div className={styles.brandName}>하트 하우스</div>
        {view.stage && (
          <div className={styles.stage}>
            {simTimeLabel(view.stage.simTime)} · {view.stage.label}
          </div>
        )}
      </header>
      <nav className={styles.list}>
        {rooms.map((room) => (
          <RoomItem key={room.id} room={room} view={view} selected={room.id === selectedId} unread={unread.has(room.id)} onSelect={onSelect} />
        ))}
      </nav>
    </aside>
  )
}

function RoomItem({ room, view, selected, unread, onSelect }: { room: RoomView; view: HumanView; selected: boolean; unread: boolean; onSelect(id: string): void }) {
  const d = roomDisplay(room, view)
  const last = view.messages[room.id]?.at(-1)
  const sender = last?.senderId ? view.participants[last.senderId] : undefined
  const preview = last ? `${last.kind === 'pd' ? 'PD: ' : sender && room.kind !== 'private' && !sender.isMe ? `${sender.name}: ` : ''}${last.text}` : ''
  const typing = (view.typing[room.id] ?? []).length > 0
  return (
    <button className={`${styles.item} ${selected ? styles.selected : ''} ${room.status === 'closed' ? styles.closed : ''}`} onClick={() => onSelect(room.id)}>
      {room.kind === 'pd' ? (
        <span className={styles.pdIcon}>📣</span>
      ) : room.kind === 'living' ? (
        <span className={styles.pdIcon}>🏠</span>
      ) : (
        <AvatarStack participants={d.avatarIds.map((id) => view.participants[id])} />
      )}
      <span className={styles.itemText}>
        <span className={styles.itemTitle}>
          {room.kind !== 'pd' && room.kind !== 'living' && <span className={styles.icon}>{d.icon}</span>}
          {d.title}
          {room.kind !== 'pd' && room.kind !== 'living' && <span className={styles.location}>{room.location}</span>}
        </span>
        <span className={styles.preview}>{typing ? '입력 중…' : preview}</span>
      </span>
      {unread && <span className={styles.dot} />}
    </button>
  )
}
