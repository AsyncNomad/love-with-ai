import type { CastingPools } from '@heart/shared'

/**
 * 캐스팅 풀(design.md D11). 이름 풀에서는 일상 단어와 겹치는 이름(하나, 다온 등)을 뺀다.
 * 지목 감지와 canary 검사에서 오탐이 생기기 때문이다.
 */
export const castingPools: CastingPools = {
  surnames: ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍'],
  givenNames: {
    female: ['서윤', '하린', '지안', '수아', '예린', '채원', '유나', '다인', '소윤', '시은', '나연', '윤서', '가은', '혜원', '은채', '민서', '세아', '지유', '아린', '서영'],
    male: ['도현', '태오', '준혁', '시우', '건우', '민재', '현우', '지훈', '승민', '재윤', '우진', '서준', '태윤', '정우', '동하', '한결', '이준', '주원', '은호', '선우'],
  },
  occupations: [
    { title: '대학생', category: 'student', minAge: 19, maxAge: 26 },
    { title: '대학원생', category: 'student', minAge: 23, maxAge: 32 },
    { title: '바리스타', category: 'service', minAge: 19 },
    { title: '간호사', category: 'medical', minAge: 23 },
    { title: '초등학교 교사', category: 'education', minAge: 24 },
    { title: 'UX 디자이너', category: 'design', minAge: 23 },
    { title: '백엔드 개발자', category: 'tech', minAge: 23 },
    { title: '마케터', category: 'business', minAge: 23 },
    { title: '회계사', category: 'business', minAge: 25 },
    { title: '사진작가', category: 'art', minAge: 21 },
    { title: '요리사', category: 'service', minAge: 20 },
    { title: '필라테스 강사', category: 'sports', minAge: 21 },
    { title: '승무원', category: 'service', minAge: 22 },
    { title: '영상 편집자', category: 'art', minAge: 21 },
    { title: '연구원', category: 'tech', minAge: 25 },
    { title: '은행원', category: 'business', minAge: 24 },
    { title: '약사', category: 'medical', minAge: 25 },
    { title: '건축 설계사', category: 'design', minAge: 25 },
    { title: '공무원', category: 'public', minAge: 22 },
    { title: '물리치료사', category: 'medical', minAge: 23 },
    { title: '작곡가', category: 'art', minAge: 21 },
    { title: '플로리스트', category: 'art', minAge: 21 },
    { title: '소방관', category: 'public', minAge: 22 },
    { title: '스타트업 대표', category: 'business', minAge: 25 },
  ],
  regions: ['서울 마포구', '서울 성동구', '서울 강남구', '서울 관악구', '서울 송파구', '경기 성남시', '경기 수원시', '경기 고양시', '인천 연수구', '부산 해운대구', '대구 수성구', '대전 유성구', '광주 동구'],
  interests: ['영화', '러닝', '음악 감상', '요리', '등산', '전시회', '독서', '캠핑', '보드게임', '여행', '사진', '필라테스', '게임', '맛집 탐방', '드라이브', '베이킹', '자전거', '수영', '뮤지컬', '반려동물', '클라이밍', '커피', '테니스', '와인'],
  humorStyles: ['담백하게 툭 던지는', '엉뚱한', '말장난을 좋아하는', '자기 비하 개그를 하는', '리액션이 큰', '은근히 놀리는'],
  /** 이미지 프롬프트에 그대로 들어가므로 영어로 둔다(design.md §8.3). */
  appearance: {
    hair: {
      female: [
        'long straight black hair',
        'shoulder-length wavy brown hair',
        'short bob haircut',
        'long hair in a low ponytail',
        'layered medium-length hair with see-through bangs',
        'curly hair tied half up',
      ],
      male: [
        'short textured black hair',
        'two-block haircut',
        'slightly long wavy hair',
        'neat side-parted hair',
        'short crew cut',
        'comma hair with soft bangs',
      ],
    },
    outfit: {
      female: ['cream knit cardigan', 'white blouse', 'denim jacket over a striped tee', 'black turtleneck', 'pastel oversized shirt', 'beige trench coat'],
      male: ['navy crew-neck sweater', 'white oxford shirt', 'black leather jacket', 'grey hoodie', 'olive overshirt', 'beige knit polo'],
    },
    expression: ['gentle smile', 'bright laughing smile', 'calm confident look', 'shy smile', 'playful grin'],
    background: ['cozy cafe interior', 'sunlit park', 'minimal studio backdrop', 'city street at golden hour', 'bookshelf-lined room', 'seaside boardwalk'],
    vibe: ['warm', 'chic', 'sporty', 'artsy', 'clean-cut'],
  },
}
