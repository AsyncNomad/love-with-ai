# SIGNAL HOUSE (love-with-ai)

사람 1명이 AI 참가자 7명과 함께 3일짜리 연애 리얼리티 프로그램에 출연하는 로컬 멀티에이전트 시뮬레이션이다. AI 참가자들은 각자 인격과 기억을 따로 갖고, 서로 관계를 맺고, 각자 선택한다.

- 모델: Qwen3.5-4B GGUF Q4_K_M, llama.cpp(WSL2 CUDA)
- 최소 사양: RTX 3060 Ti (VRAM 8GB)
- 스택: Node 22 + TypeScript 백엔드, React + TypeScript + Vite 프론트엔드, SQLite

## 문서

- [docs/design.md](docs/design.md): 설계 정본. 원칙, 결정 기록, 아키텍처, 정보 격리, LLM 하네스, 검증, 개발 단계
- [docs/game-rules.md](docs/game-rules.md): 3일 일정, 상태 머신, 투표, 방 배정, 공개 규칙, 예외 처리

## 상태

설계 단계. 다음 작업은 Phase 0(엔진 코어 + FakeLlm + 헤드리스 시뮬레이션)이다.
