import type { CastParticipant, PersonaFlavor } from '@heart/shared'

/** 인격 생성이 거듭 실패했을 때 쓰는 템플릿(design.md §8.1-7). 게임 진행을 막지 않는다. */
export function fallbackFlavor(cast: CastParticipant): PersonaFlavor {
  const first = cast.interests[0] ?? '산책'
  const second = cast.interests[1] ?? '음악'
  const outgoing = cast.traits.extraversion >= 55
  return {
    background: `${cast.region}에서 ${cast.occupation}로 지내고 있고, 요즘은 ${first}에 빠져 있다.`,
    values: '대화가 편하고 서로의 시간을 존중하는 관계를 원한다.',
    likes: `쉬는 날에는 ${first}이나 ${second}로 시간을 보낸다.`,
    flaws: outgoing ? '말이 앞설 때가 있고 쉽게 들뜬다.' : '속마음을 표현하는 데 시간이 걸린다.',
    approach: outgoing ? '먼저 말을 걸고 가볍게 질문을 던진다.' : '상대가 먼저 다가오면 차분하게 대화를 이어 간다.',
    speechDescription: outgoing ? '밝고 리액션이 큰 말투' : '차분하고 짧은 말투',
    exampleLines: outgoing
      ? ['오 맞아요, 저도 그렇게 생각해요!', `저도 그거 알아요. ${first} 할 때 딱 그렇더라고요`, '와 진짜요? 신기하네요', '저 생각보다 허당이에요', '아 그건 좀 쑥스럽네요']
      : ['네, 그럴 것 같아요.', `저도 비슷해요. ${first} 하다 보면 그렇더라고요.`, '아, 그건 처음 알았어요.', '저 의외로 웃긴 편이에요.', '음, 그건 잘 모르겠어요.'],
  }
}
