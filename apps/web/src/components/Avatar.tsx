import type { ParticipantView } from '@heart/shared'
import { initials } from '../lib/format'
import styles from './Avatar.module.css'

const PALETTE = ['#f8c8d4', '#c9def5', '#d8cff2', '#cdebd9', '#f7dcc2', '#f2d0e8', '#cfe6ec']

function tint(id: string): string {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length] ?? PALETTE[0]!
}

interface Props {
  participant: ParticipantView | undefined
  size?: number
  onClick?: () => void
}

/** 프로필 사진. 없으면(사람, 생성 실패) 이니셜 아바타를 쓴다(D22). */
export function Avatar({ participant, size = 48, onClick }: Props) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) }
  const className = `${styles.avatar} ${onClick ? styles.clickable : ''}`
  if (!participant) return <span className={className} style={{ ...style, background: '#e5e5e5' }} />
  if (participant.avatarUrl) {
    return <img className={className} style={style} src={participant.avatarUrl} alt={participant.name} onClick={onClick} draggable={false} />
  }
  const bg = participant.isMe ? '#111' : tint(participant.id)
  return (
    <span className={className} style={{ ...style, background: bg, color: participant.isMe ? '#fff' : '#333' }} onClick={onClick}>
      {initials(participant.name)}
    </span>
  )
}

/** 그룹방 목록용 겹친 아바타 */
export function AvatarStack({ participants, size = 52 }: { participants: (ParticipantView | undefined)[]; size?: number }) {
  if (participants.length <= 1) return <Avatar participant={participants[0]} size={size} />
  const small = Math.round(size * 0.62)
  return (
    <span className={styles.stack} style={{ width: size, height: size }}>
      {participants.slice(0, 4).map((p, i) => (
        <span key={p?.id ?? i} className={styles.stackItem} data-i={i}>
          <Avatar participant={p} size={small} />
        </span>
      ))}
    </span>
  )
}
