import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { HumanView, MessageView, RoomView } from '@signal/shared'
import { roomDisplay } from '../lib/format'
import { Avatar } from './Avatar'
import { TimerChip } from './TimerChip'
import styles from './ChatPane.module.css'

interface Props {
  view: HumanView
  timerSyncedAt: number
  room: RoomView | null
  onSend(roomId: string, text: string): Promise<boolean>
  onSkip(roomId: string): void
  onProfile(id: string): void
}

export function ChatPane({ view, timerSyncedAt, room, onSend, onSkip, onProfile }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const messages = room ? (view.messages[room.id] ?? []) : []
  const typing = room ? (view.typing[room.id] ?? []) : []

  useLayoutEffect(() => {
    const el = listRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [messages.length, typing.length, room?.id])

  useEffect(() => {
    stickRef.current = true
  }, [room?.id])

  if (!room) return <main className={styles.pane} />
  const d = roomDisplay(room, view)
  const canWrite = room.kind !== 'pd' && room.isMember && room.status === 'open' && view.status === 'running'
  const canSkip = canWrite && room.kind !== 'living'
  const partner = room.kind === 'private' ? view.participants[room.memberIds.find((id) => id !== view.meId) ?? ''] : undefined

  return (
    <main className={styles.pane}>
      <div className={styles.topBar}>
        <button className={styles.pill} onClick={() => partner && onProfile(partner.id)} disabled={!partner}>
          {partner ? <Avatar participant={partner} size={30} /> : <span className={styles.pillIcon}>{d.icon}</span>}
          {partner && <span>{d.icon}</span>}
          <span className={styles.pillTitle}>{d.title}</span>
          {room.kind !== 'pd' && room.kind !== 'living' && <span className={styles.pillSub}>{room.location}</span>}
        </button>
        <TimerChip timer={view.timer} syncedAt={timerSyncedAt} />
      </div>
      <div
        className={styles.list}
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        {messages.map((m, i) => (
          <Message key={m.seq} m={m} prev={messages[i - 1]} view={view} group={room.kind !== 'private'} onProfile={onProfile} />
        ))}
        {typing.length > 0 && (
          <div className={styles.typingRow}>
            <span className={styles.typingName}>{typing.map((id) => view.participants[id]?.name ?? '').join(', ')}</span>
            <span className={styles.typingBubble}>
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
      </div>
      {room.kind !== 'pd' && <Composer key={room.id} disabled={!canWrite} closed={room.status === 'closed' || !room.isMember} onSend={(t) => onSend(room.id, t)} onSkip={canSkip ? () => onSkip(room.id) : null} />}
    </main>
  )
}

function Message({ m, prev, view, group, onProfile }: { m: MessageView; prev: MessageView | undefined; view: HumanView; group: boolean; onProfile(id: string): void }) {
  if (m.kind === 'pd') {
    return (
      <div className={styles.pdRow}>
        <span className={styles.pd}>
          <b>PD</b> {m.text}
        </span>
      </div>
    )
  }
  const sender = m.senderId ? view.participants[m.senderId] : undefined
  const mine = sender?.isMe ?? false
  const firstOfRun = !prev || prev.senderId !== m.senderId || prev.kind === 'pd'
  if (mine) {
    return (
      <div className={`${styles.row} ${styles.mine} ${firstOfRun ? styles.runStart : ''}`}>
        <span className={`${styles.bubble} ${styles.bubbleMine}`}>{m.text}</span>
      </div>
    )
  }
  return (
    <div className={`${styles.row} ${firstOfRun ? styles.runStart : ''}`}>
      <span className={styles.avatarSlot}>{group && firstOfRun && <Avatar participant={sender} size={36} onClick={() => sender && onProfile(sender.id)} />}</span>
      <span className={styles.stackCol}>
        {group && firstOfRun && <span className={styles.sender}>{sender?.name ?? '?'}</span>}
        <span className={styles.bubble}>{m.text}</span>
      </span>
    </div>
  )
}

function Composer({ disabled, closed, onSend, onSkip }: { disabled: boolean; closed: boolean; onSend(text: string): Promise<boolean>; onSkip: (() => void) | null }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!disabled) inputRef.current?.focus()
  }, [disabled])

  const submit = async (e?: FormEvent): Promise<void> => {
    e?.preventDefault()
    const t = text.trim()
    if (!t || disabled || busy) return
    setBusy(true)
    const ok = await onSend(t)
    setBusy(false)
    if (ok) setText('')
    inputRef.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <form className={styles.composer} onSubmit={submit}>
      {onSkip && (
        <button type="button" className={styles.skip} onClick={onSkip} title="이 대화를 마치고 거실로 돌아갑니다">
          대화 마치기
        </button>
      )}
      <div className={styles.inputWrap}>
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          maxLength={300}
          disabled={disabled}
          placeholder={closed ? '대화가 끝난 방입니다' : disabled ? '지금은 말할 수 없어요' : '메시지 보내기'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className={styles.send} disabled={disabled || !text.trim() || busy} aria-label="보내기">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </form>
  )
}
