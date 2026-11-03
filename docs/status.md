# 구현 현황

마지막 갱신: 2026-11-02. 설계는 [design.md](design.md), 게임 규칙은 [game-rules.md](game-rules.md)를 본다. 이 문서는 무엇이 돌아가고, 무엇을 어떻게 검증했고, 무엇이 남았는지를 적는다.

## 요약

| 단계 | 상태 | 비고 |
|---|---|---|
| Phase 0 엔진 코어 | **완료** | FakeLlm 헤드리스 시뮬레이션 시드 1,000개 전부 통과, audit 위반 0건(약 60초) |
| Phase 1 로컬 추론 | 어댑터만 작성 | `LlamaCppLlm`, `SdCppImage`, `LlamaServerProcess`, `ProcessGpuLease`, `doctor`. **실제 모델로는 아직 검증하지 않았다**(빌드·모델 다운로드 전) |
| Phase 2 독립 에이전트 | 구조 완료, 품질 미검증 | 인격 생성, 시점 제한 컨텍스트, 검증 파이프라인, 관계 평가, 기억 요약이 FakeLlm으로 돈다. 실제 모델의 말투 구별은 Phase 1 이후 평가 |
| Phase 3 1일차 + 웹 UI | **FakeLlm으로 플레이 가능** | 온보딩 → 캐스팅(사진 포함) → 입주 → 자유 대화 → 첫인상 선택·초대 → 1:1·그룹 대화 → 자기소개 → 저녁 대화 → 심야 선택 → 심야 대화 → 마무리 |
| Phase 4~5 (2·3일차) | 미착수 | 1일차가 끝나면 "다음 날 일정은 준비 중" 안내 후 종료(`schedule_end`) |

## 실행

```bash
nvm use            # Node 24 (.nvmrc). 22 이상이면 된다
corepack enable pnpm
pnpm install       # 설치는 pnpm (workspace:* 의존성 때문)
npm run dev        # 개발: 서버 127.0.0.1:8787 + Vite 웹 http://127.0.0.1:5173 (코드 고치면 바로 반영)
npm run start      # 실행: 웹을 프로덕션 빌드한 뒤 서버가 함께 서빙 → http://127.0.0.1:8787
TIME_SCALE=0.1 npm run dev   # 단계 시간을 10분의 1로 줄여서 빠르게 확인
```

`npm run`과 `pnpm`은 스크립트 실행기로서는 같다. 스크립트가 내부에서 pnpm을 부르므로 pnpm(corepack)은 있어야 한다.

기본은 GPU 없이 도는 fake 모드다(`LLM_MODE=fake`, `IMAGE_MODE=fake`). 실제 모델 모드는 아래 "Phase 1에서 할 일"을 본다.

| 환경 변수 | 기본값 | 뜻 |
|---|---|---|
| `LLM_MODE` | `fake` | `fake` / `llamacpp`(서버가 llama-server를 띄우고 GPU를 교대) / `external`(이미 떠 있는 llama-server에 붙음, 사진 생성 생략) |
| `IMAGE_MODE` | fake 모드면 `fake`, 아니면 `off` | `fake` / `sdcpp` / `off` |
| `TIME_SCALE` | `1` | 단계 시간 배율 |
| `LLAMA_BIN`, `LLAMA_MODEL`, `LLAMA_PORT`, `LLAMA_CTX` | `bin/llama-server`, `models/Qwen3.5-4B-Q4_K_M.gguf`, `8080`, `102400` | llama.cpp |
| `SD_BIN`, `SD_DIFFUSION_MODEL`, `SD_VAE`, `SD_TEXT_ENCODER` | `bin/sd-cli`, `models/flux-2-klein-4b-Q4_0.gguf`, `models/flux2-small-decoder.safetensors`, `models/Qwen3-4B-Q4_K_M.gguf` | stable-diffusion.cpp. 기본값은 `setup:image`가 받는 파일과 같다 |
| `SD_EXTRA_ARGS` | 없음 | sd-cli에 덧붙일 인자(예: VRAM이 부족할 때 `--offload-to-cpu`) |
| `LLAMA_EXTRA_ARGS` | 없음 | llama-server에 덧붙일 인자 |
| `RUNS_DIR` | `runs` | 회차 기록 위치 |

## 검증

| 명령 | 내용 | 마지막 결과 |
|---|---|---|
| `pnpm check` | 타입 검사(TS 6 strict), ESLint, dependency-cruiser(계층 규칙), vitest | 통과. 테스트 48개 |
| `pnpm sim --seeds 1000` | FakeLlm + 가상 시계로 1일차 전체를 끝까지 진행하고 매 판 audit. 사용자 성별을 번갈아 바꾼다 | 1000/1000 통과 |
| `pnpm audit:run runs/<run_id>` | 실제 플레이한 회차의 deliveries·출력을 가시성 규칙과 대조 | — |
| `pnpm --filter @heart/server cli doctor` | Node 버전, 모드별 바이너리·모델 경로, llama-server 응답 확인 | — |

테스트 구성:
- `engine`: 캐스팅 불변식(fast-check 200회), 가시성, 투표 검증, 방 배정 성질(500회), 발언자 선택, 관계 환산
- `agents`: 출력 검증기, 시점 격리. 무작위 입장·퇴장·발언 시나리오 300회에서 뷰가 근거로 쓴 이벤트가 모두 소유자에게 관찰 가능한지 확인한다
- `runtime`: GameClock(일시정지·hold), GpuQueue(우선순위·취소·승격)
- `server`: 1일차 시뮬레이션 4판(남녀), 같은 시드 결정성, 메기 완전 격리, 투표 본인 한정 가시성

웹 UI는 Windows Chrome을 헤드리스로 띄워 스크린샷으로 확인했다(온보딩, 거실, 1:1, 종료된 방, 타이머, 입력 중 표시).

## 구현 중 감사가 잡아낸 결함

시뮬레이션 audit이 실제 누출과 모호성을 잡았고, 설계에 반영했다.
- **D30**: 늦게 들어온 참가자의 투표 기억에 그 참가자가 모르는 이름이 실명으로 들어갔다.
- **D31**: "정우진"이 "최정우"의 이름을 품는 식으로 이름이 겹쳤다(시드 1,000개 중 6개).
- 출력 정규화가 이름표 뒤의 따옴표를 남겼다(단위 테스트).
- 서버가 선언하지 않은 `ws` 패키지를 import했다(의존성 검사).
- React StrictMode의 이중 마운트 때문에 Chrome에서 WebSocket 연결이 지연됐다.

## WSL이 꺼지는 문제 (2026-11-03 분석)

증상: 무거운 빌드 중에 VS Code 연결, 터미널, 에이전트가 한꺼번에 끊기고 WSL이 꺼진 것처럼 보였다. 두 번째에는 VM까지 내려갔다.

원인(journalctl로 확인):
1. **메모리 고갈.** WSL에 주어진 메모리는 15.5GB(호스트의 절반)와 스왑 4GB다. 그런데 다음이 동시에 돌았다.
   - stable-diffusion.cpp CUDA 빌드: 병렬 4개. cicc 하나가 flash-attention·mmq 템플릿을 컴파일할 때 최대 5.8GB를 쓴다.
   - llama-server: 3.2GB
   - VS Code의 Dart 언어 서버(다른 Flutter 프로젝트): 2.5~2.8GB
   - VS Code 서버와 확장: 약 2GB
2. **systemd의 연쇄 종료.** `systemd=true`인 WSL에서는 Windows에서 띄운 모든 프로세스(VS Code 서버, 터미널, 에이전트, 여기서 `setsid nohup`으로 띄운 작업까지)가 `init.scope` 하나에 들어간다. `init.scope`는 `OOMPolicy=stop`이다. 커널이 그 안의 프로세스(cicc) 하나를 OOM으로 죽이면, systemd가 init.scope 전체를 멈추고 약 3분 뒤 남은 프로세스를 모두 SIGKILL한다(09:15 OOM → 09:18·09:20 일괄 종료).
3. 남은 프로세스가 메모리를 계속 쓰면서 OOM이 반복됐다. 마지막 세션이 끝나자 사용자 관리자가 내려갔고, 그 뒤 WSL VM이 유휴 상태로 꺼졌다(09:26).

조치:
- 리포에서 한 것: 빌드를 메모리 상한이 있는 별도 cgroup(`systemd-run --user --scope -p MemoryMax=… -p OOMPolicy=continue`)에서 돌린다(`scripts/setup/env.sh`의 `capped`). 상한을 넘으면 빌드만 죽고 세션은 산다. 병렬 수는 cicc당 6GB 기준으로 계산하므로, 이 PC에서는 1이 된다.
- 오래 도는 작업(llama-server, E2E 게임)도 `systemd-run --user --scope -p MemoryMax=…`로 띄운다. `setsid`는 cgroup을 벗어나지 못하므로 쓰지 않는다.
- 사용자 쪽 권장(아직 적용하지 않음):
  - `%UserProfile%\.wslconfig`에 `[wsl2]` / `memory=20GB` / `swap=16GB`를 쓰고 `wsl --shutdown`한다. 호스트 여유 메모리를 보고 값을 정한다.
  - sudo로 `/etc/systemd/system.conf.d/oom.conf`에 `[Manager]` / `DefaultOOMPolicy=continue`를 쓴다. 이렇게 하면 OOM 하나가 세션 전체를 죽이지 않는다.
  - 무거운 빌드 중에는 Flutter 프로젝트 창(Dart 언어 서버)을 닫는다.

## 남은 일

### Phase 1 설치 절차 (스크립트화됨)

sudo 없이 리포 안에 모두 설치한다(`.tools/`, `vendor/`, `bin/`, `models/`는 git에서 무시한다).

```bash
npm run setup:llm     # cmake·ninja(uv) + CUDA 12.9 툴킷(micromamba, 시스템에 nvcc가 없을 때) + llama.cpp 빌드 + Qwen3.5-4B 다운로드
npm run setup:image   # stable-diffusion.cpp 빌드 + FLUX.2 klein 4B·Qwen3-4B 인코더·VAE 다운로드
npm run doctor        # 경로·응답 확인
npm run bench -- --url http://127.0.0.1:8080 --label <이름>   # 측정 리포트(runs/bench/)
```

- 버전 고정: llama.cpp `v0.8.0`, stable-diffusion.cpp `master-1039-290148d`, CUDA 12.9(`scripts/setup/env.sh`).
- CUDA 아키텍처 기본값은 `75;86;89`다. 빌드 시간을 줄이려면 `CUDA_ARCHS=86`처럼 지정한다. 병렬 작업 수는 사용 가능 메모리 2GB당 1개로 자동 제한되고, `JOBS`로 덮어쓸 수 있다.
- 모델 파일은 SHA-256으로 검증한다(`scripts/setup/models.sh`).
  - VAE는 FLUX.2-small-decoder(Apache 2.0)를 쓴다. stable-diffusion.cpp 문서의 기본 VAE는 FLUX.2-dev 저장소에 있는데, 접근 승인이 필요하고 비상업 라이선스다.
  - FLUX.2 klein 4B GGUF는 Q4_K_M 판이 없어서 Q4_0을 쓴다.

### Phase 1 진행 기록 (2026-11-02, 18:00 중단)

- 완료: 툴체인(CUDA 12.9 리포 내 설치), llama.cpp `v0.8.0` CUDA 빌드, 모델 4개 다운로드·해시 검증, `bench` CLI.
- 계약 확인: `response_format`(json_schema) 준수 35/35, thinking 출력 0건(`chat_template_kwargs.enable_thinking=false`), `--reasoning on|off` 플래그 존재 확인.
- 개발 PC 실측(최소 사양보다 느린 GPU, `-c 32768`): 전체 p50 2.33s / p95 4.83s, 대사 p50 2.42s / p95 4.11s, 생성 약 66 tok/s, 프롬프트 처리 약 210~230 tok/s, 한국어 글자당 0.48토큰. 최소 사양 실측은 아직 없다.
- 실측으로 고친 것: 관계 평가 출력이 대상 수에 비례해 길어져 잘림 → 최대 토큰을 대상 수에 비례하게 바꿈. 예시 대사의 번호표 "(1)" 제거. 투표 프롬프트의 "선택하지 않음" 쏠림 완화(가짜 맥락에서는 여전히 4건 중 3건이 유보라 실제 대화로 재평가 필요).
- 중단된 작업:
  - stable-diffusion.cpp 빌드(465단계 중 약 130단계). `scripts/setup/sd-cpp.sh`를 다시 실행하면 이어서 빌드한다.
  - 실제 모델로 1일차 한 판 돌리기. 처음부터 다시 한다(`LLM_MODE=external`, llama-server는 `bin/llama-server -m models/Qwen3.5-4B-Q4_K_M.gguf -ngl 99 -c 32768 -np 1 --jinja --host 127.0.0.1 --port 8080`).

### Phase 1에서 할 일 (실제 모델)
1. llama.cpp를 WSL에서 CUDA로 빌드해 `bin/llama-server`에 둔다. Qwen3.5-4B Q4_K_M GGUF를 `models/`에 둔다. 다운로드가 필요하므로 진행 전에 확인을 받는다.
2. `LLM_MODE=external`로 먼저 붙여 본다. 확인할 것은 계약 사항이다. `response_format`(json_schema) 준수율, `chat_template_kwargs.enable_thinking=false` 동작, 요청 취소 동작.
3. `bench` CLI를 추가하고 design.md §13을 실측값으로 바꾼다. 측정 항목은 지연 p50/p95, tok/s, 한국어 토큰 비율, VRAM(`-c 102400`)이다.
4. stable-diffusion.cpp를 빌드하고 FLUX.2 [klein] 4B 파일을 받는다. CLI 플래그(`--diffusion-model`, `--vae`, `--llm`, `--cfg-scale 1.0`, `--steps 4`)를 실제로 확인하고 장당 시간을 잰다. 상주 서버 모드가 있으면 구현체를 하나 더 만든다.
5. `LLM_MODE=llamacpp IMAGE_MODE=sdcpp`로 GPU 교대(llama-server 종료 → 사진 7장 → 재시작)가 되는지 확인한다.

### 설계에는 있지만 아직 구현하지 않은 것
- 1:1에서 사람이 60초 동안 입력하지 않을 때의 자동 일시정지(design.md §12). 일시정지 사유 `afk`와 재개 UI는 만들어 두었다.
- 서버 재시작 후 이어하기. 이벤트 로그와 fold는 준비됐지만, 단계 중간부터 재개하는 기능은 없다. 지금은 재시작하면 새 게임이다.
- `ReplayLlm`(저장된 출력으로 재생), `bench`, 관전(god) 뷰(`--dev-observer`)
- 회차 기록 보관·삭제 UI
- 2·3일차 단계 핸들러(메기, 브런치, 활동, 시그널 카드, 우체통, 마지막 데이트, 최종 선택, 결과 발표, 에필로그). `StageRegistry`에 등록하고 `config.schedule`에 단계를 추가하면 된다.

### 알려진 한계
- FakeLlm의 대사는 정해진 문장 풀에서 뽑는다. 그래서 반복 검사 거부가 20% 안팎으로 나온다. 실제 모델의 거부율은 Phase 1에서 잰다.
- 자유 대화 속 사실("저 부산 살아요")은 사실로 저장하지 않는다(D7). 원문과 요약으로만 남는다.

## 코드 지도

| 위치 | 내용 |
|---|---|
| `packages/shared/src/events.ts` | 이벤트 종류와 payload 스키마. 새 이벤트는 여기에 추가한다 |
| `packages/shared/src/protocol.ts` | 사람 시점 화면 상태(`HumanView`), `ViewPatch`, 명령, `applyPatch` |
| `packages/engine/src/state.ts`, `visibility.ts` | fold와 가시성 판정. 격리의 핵심이다 |
| `packages/agents/src/observation.ts` | AI가 게임 상태를 읽는 유일한 통로. 근거 seq를 기록한다 |
| `packages/agents/src/tasks/*.ts` | LLM 작업(TaskSpec)과 프롬프트 |
| `packages/runtime/src/stages/*.ts` | 단계 핸들러. 1일차는 `day1.ts`, 공통 절차는 `common.ts` |
| `packages/runtime/src/chat-scene.ts` | 한 방의 발언 진행(누가 언제 말할지) |
| `apps/server/src/compose.ts`, `env.ts` | 모드별 추론 조립 |
| `apps/server/src/sim.ts` | 헤드리스 시뮬레이터 |
| `apps/web/src` | React UI |
