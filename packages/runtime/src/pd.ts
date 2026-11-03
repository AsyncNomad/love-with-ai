/**
 * PD 멘트 템플릿(D18). 공식 안내는 틀리면 안 되는 정보이므로 LLM을 쓰지 않는다.
 * PD는 이미 확정된 이벤트를 말로 옮길 뿐이고, PD의 말로 상태가 바뀌지 않는다.
 */
export const PD = {
  welcome: () => '이곳은 앞으로 3일 동안 생활할 하트 하우스입니다. 잠시 후 다른 입주자들이 도착할 예정입니다.',
  arrival: () => '새로운 입주자가 도착했습니다.',
  freeTalk: (min: string) => `모든 입주자가 도착했습니다. 지금부터 ${min} 동안 자유롭게 대화해 주세요.`,
  freeTalkEnd: () => '자유 대화 시간이 끝났습니다.',
  firstVote: () => '첫인상 선택을 시작하겠습니다. 가장 인상이 좋았던 이성 한 분을 선택해 주세요. 선택은 비공개입니다.',
  voteClosed: () => '선택이 마감되었습니다.',
  invites: () => '선택 결과를 바탕으로 대화 초대를 확인하고 있습니다.',
  firstTalks: () => '첫인상 대화를 시작합니다. 배정된 장소로 이동해 주세요.',
  noFirstTalk: () => '이번 첫인상 선택에서는 아쉽게도 대화 상대가 배정되지 않았습니다. 잠시 후 전체 대화가 다시 시작됩니다.',
  idleSlot: () => '이번 시간에는 배정된 대화가 없습니다. 거실에서 기다려 주세요.',
  talkStart: (min: string) => `대화 시간은 ${min}입니다.`,
  talkWarning: () => '대화 시간이 얼마 남지 않았습니다.',
  talkEnd: () => '시간이 종료되었습니다. 거실로 돌아가 주세요.',
  talkSkipped: () => '대화를 마치고 거실로 돌아갑니다.',
  waitingOthers: () => '다른 참가자들의 대화가 끝나기를 기다리고 있습니다.',
  regroup: () => '모두 거실로 돌아왔습니다. 잠시 후 저녁 일정이 시작됩니다.',
  introStart: () => '지금부터 자기소개 시간입니다. 나이와 직업을 공개해 주세요.',
  introCall: (name: string) => `${name} 님, 자기소개 부탁드립니다.`,
  eveningTalk: (min: string) => `${min} 동안 자유롭게 대화해 주세요. 그 뒤에 심야 선택이 있습니다.`,
  nightVote: () => '오늘 밤 더 이야기하고 싶은 이성 한 분을 선택해 주세요. 선택은 비공개입니다.',
  nightTalks: () => '심야 대화를 시작합니다. 선택한 사람, 그리고 나를 선택한 사람과 이야기할 수 있습니다.',
  noNightTalk: () => '오늘 밤은 배정된 대화가 없습니다. 거실에서 쉬어 주세요.',
  wrap: (day: number) => `${['', '첫째', '둘째', '셋째'][day] ?? day} 날이 끝났습니다. 모두 수고하셨습니다.`,
  notImplemented: () => '다음 일정은 아직 준비 중입니다. 여기까지 함께해 주셔서 감사합니다.',
  // 2일차(game-rules.md §5)
  morning: (min: string) => `좋은 아침입니다. 둘째 날이 시작되었습니다. ${min} 동안 거실에서 자유롭게 이야기해 주세요.`,
  brunch: () => '브런치 협동 미션을 시작합니다. 배정된 조별로 함께 브런치를 준비해 주세요.',
  catfishArrival: () => '새로운 입주자가 하트 하우스에 도착했습니다.',
  catfishProfile: (name: string, age: number, occupation: string) => `${name} 님은 ${age}세, ${occupation}입니다.`,
  freeTalkShort: (min: string) => `${min} 동안 거실에서 자유롭게 대화해 주세요.`,
  activityChoice: () => '오후 활동을 고를 시간입니다. 하고 싶은 활동을 1지망과 2지망으로 골라 주세요. 같은 활동을 고른 분들끼리 함께 갑니다.',
  activityGroups: () => '활동 그룹이 정해졌습니다. 배정된 장소로 이동해 주세요.',
  d2Regroup: (min: string) => `모두 숙소로 돌아왔습니다. 저녁 일정 전까지 ${min} 동안 자유롭게 이야기해 주세요.`,
  signalCard: () => '시그널 카드 시간입니다. 마음이 가는 이성 한 분에게 이름을 밝히지 않고 짧은 메시지를 보낼 수 있습니다.',
  signalCardDone: () => '시그널 카드가 모두 전달되었습니다.',
  // 3일차(game-rules.md §6)
  opening: () => '마지막 날 아침이 밝았습니다. 오늘 밤에는 최종 선택이 있습니다.',
  mailbox: () => '시그널 우체통 시간입니다. 더 알고 싶은 이성 한 분에게 질문 하나를 보낼 수 있습니다. 질문과 답은 두 사람만 볼 수 있습니다.',
  mailboxAnswers: () => '질문이 전달되었습니다. 받은 질문에 답해 주세요.',
  mailboxDone: () => '시그널 우체통이 마감되었습니다.',
  dateChoice: () => '마지막 데이트 상대를 고를 시간입니다. 함께 데이트하고 싶은 이성 한 분을 선택해 주세요. 선택은 비공개입니다.',
  finalDates: () => '마지막 데이트를 시작합니다. 배정된 장소로 이동해 주세요.',
  noFinalDate: () => '이번 마지막 데이트에는 배정된 상대가 없습니다. 거실에서 기다려 주세요.',
  lastDinner: (min: string) => `마지막 저녁입니다. 잠시 후 최종 선택이 있습니다. ${min} 동안 이야기를 나눠 주세요.`,
  finalVote: () => '최종 선택 시간입니다. 마음이 가는 이성 한 분을 선택해 주세요. 한 번 제출한 선택은 바꿀 수 없습니다.',
  revealStart: () => '최종 선택이 모두 끝났습니다. 지금부터 결과를 발표하겠습니다.',
  revealHumanPick: (name: string | null) => (name ? `당신은 ${name} 님을 선택했습니다.` : '당신은 아무도 선택하지 않았습니다.'),
  revealPartnerPick: (partner: string, pick: 'you' | string | null) =>
    pick === 'you' ? `${partner} 님은 당신을 선택했습니다.` : pick ? `${partner} 님은 ${pick} 님을 선택했습니다.` : `${partner} 님은 아무도 선택하지 않았습니다.`,
  revealOutcome: (matched: boolean) => (matched ? '축하합니다. 커플이 성사되었습니다.' : '아쉽게도 이번에는 커플이 성사되지 않았습니다.'),
  revealCouples: (couples: string[]) => (couples.length > 0 ? `이번 시즌 성사된 커플은 ${couples.join(', ')}입니다.` : '이번 시즌에는 성사된 커플이 없습니다.'),
  closing: () => '3일 동안 하트 하우스와 함께해 주셔서 감사합니다. 에필로그를 확인해 주세요.',
} as const

export function formatMinutes(ms: number): string {
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}초`
  const min = Math.floor(sec / 60)
  const rest = sec % 60
  return rest === 0 ? `${min}분` : `${min}분 ${rest}초`
}
