# 하트 하우스 (love-with-ai)

사람 1명이 AI 참가자 7명과 함께 3일짜리 연애 리얼리티 프로그램에 출연하는 로컬 멀티에이전트 시뮬레이션이다. AI 참가자들은 각자 인격과 기억을 따로 갖고, 서로 관계를 맺고, 각자 선택한다.

- 모델: Qwen3.5-4B GGUF Q4_K_M, llama.cpp(WSL2 CUDA)
- 프로필 사진: FLUX.2 [klein] 4B, stable-diffusion.cpp
- 최소 사양: RTX 3060 Ti (VRAM 8GB), 시스템 RAM 16GB (8GB 상한에서 실측 검증)
- 스택: Node 22 이상 + TypeScript 6 백엔드, React + TypeScript + Vite 프론트엔드, SQLite

## 실행

```bash
nvm use && corepack enable pnpm && pnpm install   # 설치는 pnpm (workspace:* 의존성 때문)
npm run dev                 # 개발: 서버 + Vite(HMR) → http://127.0.0.1:5173 (GPU 없이 도는 fake 모드)
npm run start               # 실행: 웹을 빌드한 뒤 서버 하나로 → http://127.0.0.1:8787
TIME_SCALE=0.1 npm run dev  # 단계 시간을 10분의 1로
npm run check               # 타입·린트·계층 규칙·테스트
npm run sim -- --seeds 1000 # 헤드리스 시뮬레이션 + 정보 격리 감사
```

스크립트는 `npm run`과 `pnpm` 어느 쪽으로 실행해도 같다. 내부에서 pnpm을 부르므로 pnpm이 설치되어 있어야 한다.

실제 모델 모드와 환경 변수는 [docs/status.md](docs/status.md)를 본다.

## 문서

- [docs/design.md](docs/design.md): 설계 정본. 원칙, 결정 기록, 아키텍처, 정보 격리, LLM 하네스, 검증, 개발 단계
- [docs/game-rules.md](docs/game-rules.md): 3일 일정, 상태 머신, 투표, 방 배정, 공개 규칙, 예외 처리
- [docs/status.md](docs/status.md): 구현 현황, 검증 결과, 남은 일, 코드 지도
