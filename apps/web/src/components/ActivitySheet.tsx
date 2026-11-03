import { useState } from 'react'
import type { Command, PromptView } from '@heart/shared'
import { Modal } from './Modal'
import styles from './PromptSheet.module.css'

interface Props {
  prompt: Extract<PromptView, { kind: 'activity' }>
  send(command: Command): Promise<{ ok: boolean; error?: string }>
}

/** 2일차 활동 선택(game-rules.md §5.4): 1지망과 2지망을 차례로 고른다. */
export function ActivitySheet({ prompt, send }: Props) {
  const [picked, setPicked] = useState<string[]>([])
  const toggle = (id: string): void => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 2 ? [...cur, id] : cur))
  return (
    <Modal title="오후 활동 선택" onClose={null}>
      <p className={styles.desc}>하고 싶은 활동을 1지망, 2지망 순서로 골라 주세요. 같은 활동을 고른 사람끼리 함께 갑니다.</p>
      <div className={styles.options}>
        {prompt.options.map((o) => {
          const rank = picked.indexOf(o.id)
          return (
            <button key={o.id} className={`${styles.option} ${rank >= 0 ? styles.chosen : ''}`} onClick={() => toggle(o.id)}>
              <span className={styles.rank}>{rank >= 0 ? `${rank + 1}지망` : ''}</span>
              <span className={styles.name}>{o.name}</span>
              <span className={styles.meta}>{o.description}</span>
            </button>
          )
        })}
      </div>
      <div className={styles.actions}>
        <button className={styles.primary} disabled={picked.length < 2} onClick={() => void send({ type: 'chooseActivity', first: picked[0] ?? '', second: picked[1] ?? '' })}>
          선택 완료
        </button>
      </div>
    </Modal>
  )
}
