import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@heart/config'
import { checkDialogue, dropEchoedSentences, fitLength, fixAddress, hasCasualWord, hasEnglishWord, hasForeignScript, isCasual, isPolite, isRepeat, limitLaughter, normalizeUtterance, similarity } from '../src'

const cfg = defaultConfig.validation
const base = { speakerName: '정하린', maxChars: 80, unknownNames: [] as string[], recentOwn: [] as string[] }

describe('normalizeUtterance', () => {
  it('strips the speaker’s own name tag and quotes', () => {
    expect(normalizeUtterance('하린: "안녕하세요"', '정하린')).toBe('안녕하세요')
    expect(normalizeUtterance('정하린: 반가워요\n잘 부탁해요', '정하린')).toBe('반가워요 잘 부탁해요')
  })
  it('keeps other people’s name tags so validation can reject them', () => {
    expect(normalizeUtterance('도현: 저도요', '정하린')).toBe('도현: 저도요')
  })
})

describe('checkDialogue', () => {
  it('accepts a normal line', () => {
    expect(checkDialogue({ ...base, text: '저도 그 영화 봤어요ㅋㅋ' }, cfg)).toEqual([])
  })
  it('rejects speaking for someone else', () => {
    expect(checkDialogue({ ...base, text: '도현: 저도요' }, cfg)).toContain('impersonation_line')
  })
  it('rejects PD impersonation and vote announcements', () => {
    expect(checkDialogue({ ...base, text: 'PD: 지금부터 투표 결과를 공개합니다' }, cfg)).toContain('system_impersonation')
    expect(checkDialogue({ ...base, text: '[공지] 모두 거실로 오세요' }, cfg)).toContain('system_impersonation')
  })
  it('rejects names the speaker cannot know (canary)', () => {
    expect(checkDialogue({ ...base, text: '민재씨는 언제 와요?', unknownNames: ['신민재'] }, cfg)).toContain('unknown_name')
  })
  it('rejects near-repetition of the speaker’s recent lines', () => {
    expect(checkDialogue({ ...base, text: '저는 커피 없으면 하루가 안 굴러가요', recentOwn: ['저는 커피 없으면 하루가 안 굴러가요!'] }, cfg)).toContain('repetition')
  })
  it('flags overly long lines', () => {
    expect(checkDialogue({ ...base, text: '가'.repeat(81) }, cfg)).toContain('too_long')
  })
})

describe('fitLength', () => {
  it('cuts at a sentence boundary when possible', () => {
    const text = '오늘 날씨 정말 좋네요. 다들 뭐 하면서 쉬세요? 저는 보통 산책하는데 오늘은 집에만 있었어요.'
    const out = fitLength(text, 30)
    expect(out).toBe('오늘 날씨 정말 좋네요. 다들 뭐 하면서 쉬세요?')
  })
  it('gives up when there is no reasonable boundary', () => {
    expect(fitLength('가'.repeat(100), 30)).toBeNull()
  })
})

describe('similarity', () => {
  it('is 1 for identical and low for unrelated lines', () => {
    expect(similarity('안녕하세요 반가워요', '안녕하세요 반가워요')).toBe(1)
    expect(similarity('안녕하세요 반가워요', '저는 러닝을 좋아해요')).toBeLessThan(0.2)
  })
})

describe('script and politeness checks (from real-model output)', () => {
  it('flags Chinese characters and kana leaking into Korean', () => {
    expect(hasForeignScript('쉬는 날 필라테스课上하고 와인 한 잔')).toBe(true)
    expect(hasForeignScript('こんにちは 반가워요')).toBe(true)
    expect(hasForeignScript('저는 Jay라고 해요 ㅋㅋ')).toBe(false)
    expect(checkDialogue({ ...base, text: '상대방을 逗引하는 스타일' }, cfg)).toContain('foreign_script')
  })
  it('tells polite endings from casual ones', () => {
    expect(isPolite('안녕하세요!')).toBe(true)
    expect(isPolite('저도 그 영화 봤어요ㅋㅋ')).toBe(true)
    expect(isPolite('반갑습니다.')).toBe(true)
    expect(isPolite('안녕! 처음 봐서 반갑다 ㅋㅋ')).toBe(false)
    expect(isPolite('쉬는 날 필라테스하고 사진 찍는 거야.')).toBe(false)
  })
})

describe('speech level (D13)', () => {
  it('rejects clearly casual endings only when everyone present is still polite', () => {
    expect(isCasual('안녕! 처음 봐서 반갑다 ㅋㅋ')).toBe(true)
    expect(isCasual('박수아라고 불러.')).toBe(true)
    expect(isCasual('오늘 하루 잘 보내자!')).toBe(true)
    expect(isCasual('ㅋㅋㅋ')).toBe(false)
    expect(isCasual('오 진짜')).toBe(false)
    expect(isCasual('반가워요! 잘 부탁드려요')).toBe(false)
    expect(isCasual('이름만 알면 돼. ㅋㅋ')).toBe(true)
    expect(isCasual('시은, 너랑 같이 할까? ㅋㅋ')).toBe(true)
    expect(isCasual('저도 좋아해요. ㅋㅋ')).toBe(false)
    expect(checkDialogue({ ...base, text: '처음 봐서 반갑다', mustBePolite: true }, cfg)).toContain('speech_level')
    expect(checkDialogue({ ...base, text: '처음 봐서 반갑다', mustBePolite: false }, cfg)).not.toContain('speech_level')
  })
})

describe('laughter and repetition (from real-model play)', () => {
  it('strips laughter for low-laughter personas and keeps at most one otherwise', () => {
    expect(limitLaughter('잠깐, 분위기가 정적이라서 ㅋㅋ. 커피 드셨어요? ㅋㅋㅋ', 0.2)).toBe('잠깐, 분위기가 정적이라서. 커피 드셨어요?')
    expect(limitLaughter('ㅋㅋㅋㅋ 저도요 ㅎㅎ 진짜요', 0.9)).toBe('ㅋㅋ 저도요 진짜요')
    expect(limitLaughter('ㅋㅋㅋ', 0.1)).toBe('')
  })
  it('treats a near-copy with an extra sentence as a repeat', () => {
    const a = '아, 커피 안 먹셨나요? 저는 오늘 아침에 커피 한 잔 마시면서 영상 편집을 하다가 잠깐 쉬었어요'
    const b = '아, 커피 안 마셨네요. 저는 오늘 아침에 커피 한 잔 마시면서 영상 편집을 하다가 잠깐 쉬었어요 혹시 뭐가 좋으신가요? 오늘 분위기 좀 바꿀 수 있는 거 있을까요?'
    expect(isRepeat(a, b, 0.7)).toBe(true)
    expect(isRepeat('네 좋아요', '네 좋네요', 0.7)).toBe(false)
  })
})

describe('natural Korean address and speech level (from real-model play)', () => {
  const names = ['황수아', '김우진', 'Jay']
  it('catches casual words and vocatives even when the ending is polite', () => {
    expect(hasCasualWord('안녕, 저는 황수아라고 해요.')).toBe(true)
    expect(hasCasualWord('오늘 내 손톱이 너무 길어서 미용실 가는 거 잊고 있었네요.')).toBe(true)
    expect(hasCasualWord('야, 손톱 길어졌다고 장난치니 귀여워요.')).toBe(true)
    expect(hasCasualWord('저 김우진이라고 해요, 수아야.', names)).toBe(true)
    expect(hasCasualWord('안녕하세요, 내일 봬요. 안녕히 주무세요.', names)).toBe(false)
    expect(hasCasualWord('수아 씨는 주말에 뭐 하세요?', names)).toBe(false)
  })
  it('catches casual endings the old check missed, without flagging short replies', () => {
    expect(isCasual('저랑 같이 캠핑도 하고 싶거든?')).toBe(true)
    expect(isCasual('장난치니 귀엽네.')).toBe(true)
    expect(isCasual('아 그렇구나.')).toBe(true)
    expect(isCasual('괜찮아! 저도 처음이에요.')).toBe(true)
    expect(isCasual('네!')).toBe(false)
    expect(isCasual('와 맛있겠다! 저도 먹어 보고 싶어요.')).toBe(false)
    expect(isCasual('아, 그렇군요. 신기하네요.')).toBe(false)
  })
  it('rejects lowercase English words but allows names and acronyms', () => {
    expect(hasEnglishWord('오늘도 광주에서 많은 people 만나는 바리스타예요')).toBe(true)
    expect(hasEnglishWord('Jay 씨는 MBTI가 뭐예요?')).toBe(false)
    expect(hasEnglishWord('jay 씨도 오셨네요', ['jay'])).toBe(false)
    expect(checkDialogue({ ...base, text: '많은 people 만나요' }, cfg)).toContain('foreign_script')
  })
  it('drops a leading bare-name vocative and adds 씨 to a bare name mid-sentence', () => {
    expect(fixAddress('수아, 주말엔 주로 필라테스 해요.', names, true)).toBe('주말엔 주로 필라테스 해요.')
    expect(fixAddress('우진 씨, 저도 그래요.', names, true)).toBe('저도 그래요.')
    expect(fixAddress('안녕하세요, 우진! 반가워요.', names, true)).toBe('안녕하세요, 우진 씨! 반가워요.')
    expect(fixAddress('반가워요, Jay.', names, true)).toBe('반가워요, Jay 씨.')
    expect(fixAddress('수아 씨는 주말에 뭐 하세요?', names, true)).toBe('수아 씨는 주말에 뭐 하세요?')
    expect(fixAddress('저는 김우진이에요.', names, true)).toBe('저는 김우진이에요.')
    expect(fixAddress('안녕하세요, 우진!', names, false)).toBe('안녕하세요, 우진!')
  })
})

describe('echo and grammar (from the 3-day real-model run)', () => {
  it('drops sentences copied from anyone in the room and keeps new ones', () => {
    expect(dropEchoedSentences('저도요! 제가 주말에 러닝도 해요. 😄', ['저도요! 같이 뛸 사람 찾고 계시나요? 제가 주말에 러닝도 해요. 😄'])).toBe('저도요!')
    expect(dropEchoedSentences('영화는 어떤 장르를 주로 보시나요? 지수 씨랑 함께 뛰는 게 정말 좋겠네요.', ['저도 주말엔 가끔 러닝을 하거든요. 지수 씨랑 함께 뛰는 게 정말 좋겠네요.'])).toBe('영화는 어떤 장르를 주로 보시나요?')
    expect(dropEchoedSentences('그건 처음 들어 보네요.', ['저는 주말에 한강에서 자주 뛰어요'])).toBe('그건 처음 들어 보네요.')
    expect(dropEchoedSentences('그럼 반말로 지내보는 건 어떨까요.', ['그럼 반말로 지내보는 건 어떨까요.'])).toBe('')
  })
  it('fixes common first-person particle mistakes', () => {
    expect(normalizeUtterance('저가 베이킹 하는 걸 좋아해요', '정하린')).toBe('제가 베이킹 하는 걸 좋아해요')
    expect(normalizeUtterance('그건 제가도 좋아하는 것 같아요', '정하린')).toBe('그건 저도 좋아하는 것 같아요')
  })
  it('treats a mid-message casual question as casual', () => {
    expect(isCasual('아, 그럼 주원 씨랑 뛸까? 음악 들으며 뛰는 게 좀 다르긴 하네요.')).toBe(true)
    expect(isCasual('같이 가 볼까요? 재밌을 것 같아요.')).toBe(false)
  })
})
