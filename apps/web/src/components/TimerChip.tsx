import { useEffect, useState } from 'react'
import type { TimerView } from '@signal/shared'
import { clock } from '../lib/format'
import styles from './TimerChip.module.css'

/** 서버가 보낸 남은 시간을 받은 시각부터 스스로 줄여 나간다. 멈춤 상태면 그대로 둔다. */
export function TimerChip({ timer, syncedAt }: { timer: TimerView | null; syncedAt: number }) {
  const [now, setNow] = useState(() => performance.now())

  useEffect(() => {
    if (!timer || timer.paused) return
    const id = setInterval(() => setNow(performance.now()), 250)
    return () => clearInterval(id)
  }, [timer])

  if (!timer) return null
  const elapsed = Math.max(0, now - syncedAt)
  const remaining = timer.paused ? timer.remainingMs : timer.remainingMs - elapsed
  const urgent = !timer.paused && remaining < 20_000
  return (
    <div className={`${styles.chip} ${urgent ? styles.urgent : ''}`}>
      <span className={styles.label}>{timer.label}</span>
      <span className={styles.time}>
        {timer.paused ? '⏸ ' : ''}
        {clock(remaining)}
      </span>
    </div>
  )
}
