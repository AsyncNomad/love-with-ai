import { useState, type FormEvent } from 'react'
import { humanProfileSchema, type Command, type Gender } from '@heart/shared'
import styles from './Onboarding.module.css'

const INTERESTS = ['영화', '러닝', '음악 감상', '요리', '등산', '전시회', '독서', '캠핑', '보드게임', '여행', '사진', '게임', '맛집 탐방', '베이킹', '뮤지컬', '반려동물', '커피', '테니스']

interface Props {
  send(command: Command): Promise<{ ok: boolean; error?: string }>
}

/** PD 캐스팅(기획 §3). 최소한의 정보만 받는다(§45). 성인 전용(D2). */
export function Onboarding({ send }: Props) {
  const [name, setName] = useState('')
  const [gender, setGender] = useState<Gender>('male')
  const [age, setAge] = useState('')
  const [region, setRegion] = useState('')
  const [occupation, setOccupation] = useState('')
  const [personality, setPersonality] = useState('')
  const [interests, setInterests] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const toggle = (it: string): void => setInterests((cur) => (cur.includes(it) ? cur.filter((x) => x !== it) : cur.length < 5 ? [...cur, it] : cur))

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const parsed = humanProfileSchema.safeParse({ name, gender, age: Number(age), region, occupation, personality, interests })
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0]
      setError(field === 'age' ? '만 19세 이상만 참가할 수 있어요.' : '빈칸을 채워 주세요.')
      return
    }
    setBusy(true)
    const ack = await send({ type: 'createRun', profile: parsed.data })
    setBusy(false)
    if (!ack.ok) setError(ack.error === 'run_in_progress' ? '이미 진행 중인 게임이 있어요.' : '서버에 연결할 수 없어요.')
  }

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={submit}>
        <div className={styles.pd}>
          <span className={styles.pdBadge}>PD</span>
          <p>
            축하합니다! <b>하트 하우스</b>에 캐스팅되셨어요.
            <br />
            3일 동안 함께 지낼 입주자들을 만나기 전에, 간단한 정보를 알려 주세요.
          </p>
        </div>
        <div className={styles.row}>
          <label>
            이름(닉네임)
            <input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} placeholder="김지수" />
          </label>
          <label className={styles.narrow}>
            나이
            <input value={age} inputMode="numeric" onChange={(e) => setAge(e.target.value.replace(/\D/g, ''))} placeholder="27" />
          </label>
        </div>
        <div className={styles.field}>
          성별
          <div className={styles.segment}>
            {(['male', 'female'] as const).map((g) => (
              <button type="button" key={g} className={gender === g ? styles.on : ''} onClick={() => setGender(g)}>
                {g === 'male' ? '남성' : '여성'}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.row}>
          <label>
            사는 곳
            <input value={region} maxLength={20} onChange={(e) => setRegion(e.target.value)} placeholder="서울 마포구" />
          </label>
          <label>
            직업 또는 신분
            <input value={occupation} maxLength={30} onChange={(e) => setOccupation(e.target.value)} placeholder="개발자" />
          </label>
        </div>
        <label className={styles.field}>
          성격 (선택)
          <textarea value={personality} maxLength={200} rows={2} onChange={(e) => setPersonality(e.target.value)} placeholder="처음엔 조용하지만 친해지면 장난이 많아요" />
        </label>
        <div className={styles.field}>
          관심사 (최대 5개)
          <div className={styles.chips}>
            {INTERESTS.map((it) => (
              <button type="button" key={it} className={interests.includes(it) ? styles.chipOn : styles.chip} onClick={() => toggle(it)}>
                {it}
              </button>
            ))}
          </div>
        </div>
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.submit} disabled={busy}>
          입주하기
        </button>
        <p className={styles.notice}>다른 입주자들은 모두 AI로 생성한 가상 인물입니다. 입력한 정보는 이 컴퓨터에만 저장됩니다.</p>
      </form>
    </div>
  )
}
