import type { HumanView } from '@heart/shared'
import { Avatar } from './Avatar'
import styles from './PromptSheet.module.css'

interface Props {
  view: HumanView
  candidateIds: string[]
  selected: readonly string[]
  onToggle(id: string): void
  /** 나이·직업 줄을 보여 줄지 */
  showMeta?: boolean
}

/** 선택 창들이 함께 쓰는 참가자 카드 격자. 공개된 정보(이름·나이·직업)만 보여 준다. */
export function CandidateGrid({ view, candidateIds, selected, onToggle, showMeta = true }: Props) {
  return (
    <div className={styles.grid}>
      {candidateIds.map((id) => {
        const p = view.participants[id]
        return (
          <button key={id} className={`${styles.card} ${selected.includes(id) ? styles.chosen : ''}`} onClick={() => onToggle(id)}>
            <Avatar participant={p} size={72} />
            <span className={styles.name}>{p?.name ?? '?'}</span>
            {showMeta && <span className={styles.meta}>{[p?.age ? `${p.age}세` : null, p?.occupation].filter(Boolean).join(' · ') || ' '}</span>}
          </button>
        )
      })}
    </div>
  )
}
