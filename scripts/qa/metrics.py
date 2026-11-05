#!/usr/bin/env python3
"""대화 품질 지표(docs/qa-rules.md §3)를 대화록에서 계산한다.

사용: npx tsx apps/server/src/cli.ts transcript <runDir> > run.txt
      python3 scripts/qa/metrics.py run9.txt run10.txt

AI 참가자의 대사만 센다(사람·PD·투표·기억 같은 기록 줄은 뺀다). 여러 파일을 주면 표로 나란히 비교한다.
"""
import re
import statistics
import sys

# 관심사 풀(packages/config/src/pools.ts의 interests 첫 낱말)과 같게 둔다.
INTERESTS = ['영화', '러닝', '음악', '요리', '등산', '전시', '독서', '캠핑', '보드게임', '여행', '사진', '필라테스', '게임',
             '맛집', '드라이브', '베이킹', '자전거', '수영', '뮤지컬', '반려', '클라이밍', '커피', '테니스', '와인']
NON_DIALOGUE = ('투표', '거부', '인격', '캐스팅', '관계', '배정', '매칭', '초대', '활동 지망')
LINE = re.compile(r'^D(\d) (\d\d):\d\d\s+\[([^\]]+)\] ([가-힣A-Za-z]+): (.*)$')
DAY_OVER = re.compile(r'오늘 하루(는|도|가)?[^.?!]{0,12}(보내셨|보냈|지났|지나갔|어떠셨|어땠|괜찮으셨)')
EMOJI = re.compile('[\U0001F300-\U0001FAFF☀-➿]')


def analyze(path):
    lines = open(path, encoding='utf-8').read().splitlines()
    human = next((l.split()[4] for l in lines if '[캐스팅]' in l and '(사람)' in l), None)
    ai = []
    for l in lines:
        m = LINE.match(l)
        if not m:
            continue
        _, hour, tag, speaker, text = m.groups()
        if tag in NON_DIALOGUE or tag.startswith(('기억', '카드', '우체통')) or speaker in ('PD', human):
            continue
        ai.append((int(hour), text))
    texts = [t for _, t in ai]
    n = max(1, len(texts))
    topic_hits = {k: sum(1 for t in texts if k in t) for k in INTERESTS}
    top = max(topic_hits.values()) if topic_hits else 0
    return {
        'AI 대사': len(texts),
        '평균 길이(자)': round(statistics.mean(len(t) for t in texts)) if texts else 0,
        '60자 초과 %': round(100 * sum(len(t) > 60 for t in texts) / n),
        '질문으로 끝남 %': round(100 * sum(t.rstrip().endswith('?') for t in texts) / n),
        '관심사 언급 %': round(100 * sum(any(k in t for k in INTERESTS) for t in texts) / n),
        '최다 화제 %': round(100 * top / n),
        '"저도"로 시작': sum(t.lstrip().startswith('저도') for t in texts),
        '18시 전 하루 끝난 말': sum(1 for h, t in ai if h < 18 and DAY_OVER.search(t)),
        '이모티콘': sum(bool(EMOJI.search(t)) for t in texts),
        '최종 생성 실패': sum('[거부] dialogue' in l for l in lines),
    }


def main(paths):
    results = [(p.split('/')[-1], analyze(p)) for p in paths]
    keys = list(results[0][1].keys())
    width = max(len(k) for k in keys) + 2
    print(''.ljust(width) + ''.join(name.rjust(12) for name, _ in results))
    for k in keys:
        print(k.ljust(width) + ''.join(str(r[k]).rjust(12) for _, r in results))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
