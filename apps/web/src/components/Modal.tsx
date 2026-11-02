import { useEffect, type ReactNode } from 'react'
import styles from './Modal.module.css'

interface Props {
  title: string
  /** null이면 닫을 수 없다(서버가 답을 기다리는 선택). */
  onClose: (() => void) | null
  children: ReactNode
}

export function Modal({ title, onClose, children }: Props) {
  useEffect(() => {
    if (!onClose) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.backdrop} onClick={onClose ?? undefined}>
      <section className={styles.card} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <h2>{title}</h2>
          {onClose && (
            <button className={styles.close} onClick={onClose} aria-label="닫기">
              ×
            </button>
          )}
        </header>
        {children}
      </section>
    </div>
  )
}
