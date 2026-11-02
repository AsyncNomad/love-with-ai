import type { CastingView } from '@signal/shared'
import styles from './StatusScreens.module.css'

export function CastingScreen({ casting }: { casting: CastingView | null }) {
  const label =
    casting?.phase === 'images' ? '입주자들의 프로필 사진을 촬영하고 있어요' : casting?.phase === 'persona' ? '이번 시즌 입주자들을 캐스팅하고 있어요' : '준비 중이에요'
  const ratio = casting && casting.total > 0 ? casting.done / casting.total : 0
  return (
    <div className={styles.center}>
      <div className={styles.pulse} />
      <p className={styles.title}>{label}</p>
      {casting && (
        <>
          <div className={styles.bar}>
            <span style={{ width: `${Math.round(ratio * 100)}%` }} />
          </div>
          <p className={styles.sub}>
            {casting.done} / {casting.total}
          </p>
        </>
      )}
    </div>
  )
}

export function Banner({ text, action, bottom = false }: { text: string; action?: { label: string; onClick(): void }; bottom?: boolean }) {
  return (
    <div className={`${styles.banner} ${bottom ? styles.bottom : ''}`}>
      <span>{text}</span>
      {action && <button onClick={action.onClick}>{action.label}</button>}
    </div>
  )
}
