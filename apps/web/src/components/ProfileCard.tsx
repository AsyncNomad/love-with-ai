import type { ParticipantView } from '@signal/shared'
import { heart } from '../lib/format'
import { Avatar } from './Avatar'
import { Modal } from './Modal'
import styles from './ProfileCard.module.css'

/** 사람이 공개적으로 알게 된 정보만 보여 준다. 아직 공개되지 않은 항목은 '비공개'. */
export function ProfileCard({ participant, onClose }: { participant: ParticipantView; onClose(): void }) {
  return (
    <Modal title="프로필" onClose={onClose}>
      <div className={styles.body}>
        <Avatar participant={participant} size={148} />
        <div className={styles.name}>
          {heart(participant)} {participant.name}
        </div>
        <dl className={styles.facts}>
          <dt>나이</dt>
          <dd>{participant.age !== null ? `${participant.age}세` : '비공개'}</dd>
          <dt>직업</dt>
          <dd>{participant.occupation ?? '비공개'}</dd>
        </dl>
        {!participant.isHuman && <p className={styles.notice}>AI로 생성한 가상 인물입니다.</p>}
      </div>
    </Modal>
  )
}
