import type { Command, HumanView, PromptView } from '@heart/shared'
import { Avatar } from './Avatar'
import { Modal } from './Modal'
import styles from './EpilogueSheet.module.css'
import sheet from './PromptSheet.module.css'

interface Props {
  view: HumanView
  prompt: Extract<PromptView, { kind: 'epilogue' }>
  send(command: Command): Promise<{ ok: boolean; error?: string }>
}

/** 에필로그(game-rules.md §6.5): 공식 결과와 사람 본인의 날짜별 선택. 다른 참가자의 비공개 기록은 보여 주지 않는다. */
export function EpilogueSheet({ view, prompt, send }: Props) {
  const e = prompt.epilogue
  const name = (id: string | null): string => (id ? (view.participants[id]?.name ?? '?') : '선택하지 않음')
  const headline = e.finalPick === null ? '최종 선택을 하지 않았어요' : e.matched ? `${name(e.finalPick)} 님과 커플이 되었어요` : '이번에는 커플이 되지 못했어요'
  return (
    <Modal title="에필로그" onClose={null}>
      <div className={styles.hero}>
        {e.finalPick && <Avatar participant={view.participants[e.finalPick]} size={88} />}
        <p className={styles.headline}>{headline}</p>
        {e.finalPick && !e.matched && <p className={styles.sub}>{e.partnerPick === null ? `${name(e.finalPick)} 님은 아무도 선택하지 않았어요.` : `${name(e.finalPick)} 님은 ${name(e.partnerPick)} 님을 선택했어요.`}</p>}
      </div>
      <h3 className={styles.section}>나의 선택</h3>
      <ul className={styles.list}>
        {e.myChoices.map((c) => (
          <li key={c.label}>
            <span>{c.label}</span>
            <strong>{name(c.targetId)}</strong>
          </li>
        ))}
      </ul>
      <h3 className={styles.section}>성사된 커플</h3>
      {e.couples.length === 0 ? (
        <p className={styles.sub}>이번 시즌에는 성사된 커플이 없어요.</p>
      ) : (
        <ul className={styles.list}>
          {e.couples.map(([a, b]) => (
            <li key={`${a}-${b}`}>
              <strong>
                {name(a)} · {name(b)}
              </strong>
            </li>
          ))}
        </ul>
      )}
      <div className={sheet.actions}>
        <button className={sheet.primary} onClick={() => void send({ type: 'closeEpilogue' })}>
          마치기
        </button>
      </div>
    </Modal>
  )
}
