# 구현 현황

마지막 갱신: 2026-11-03. 설계는 [design.md](design.md), 게임 규칙은 [game-rules.md](game-rules.md)를 본다. 이 문서는 무엇이 돌아가고, 무엇을 어떻게 검증했고, 무엇이 남았는지를 적는다.

## 요약

| 단계 | 상태 | 비고 |
|---|---|---|
| Phase 0 엔진 코어 | **완료** | FakeLlm 헤드리스 시뮬레이션 시드 1,000개 전부 통과, audit 위반 0건(약 60초) |
| Phase 1 로컬 추론 | **완료(개발 PC 기준)** | llama.cpp·stable-diffusion.cpp 빌드, 모델 4개, 계약 확인, bench. 실제 모델로 GPU 교대 → 사진 7장 → 1일차 완주. 최소 사양(RTX 3060 Ti) 실측은 남았다 |
| Phase 2 독립 에이전트 | 실제 모델로 동작, 품질 튜닝 중 | 실측으로 검증기 추가(한자 누출, 존댓말·반말, 예시 대사 번호표). 남은 품질 과제는 "알려진 한계" |
| Phase 3 1일차 + 웹 UI | **플레이 가능(FakeLlm·실제 모델)** | 온보딩 → 캐스팅(사진 포함) → 입주 → 자유 대화 → 첫인상 선택·초대 → 1:1·그룹 대화 → 자기소개 → 저녁 대화 → 심야 선택 → 심야 대화 → 마무리 |
| Phase 4~5 (2·3일차) | **구현 완료. 실제 모델로 3일 완주(2026-11-03, 개발 PC, TIME_SCALE 0.4, 약 68분)** | 아침 대화 → 브런치 미션(조별 방·상황 카드) → 메기 2명 입장 → 활동 선택·그룹 → 시그널 카드 → 2일차 심야 → 우체통 → 마지막 데이트 → 마지막 저녁 → 최종 선택 → 결과 발표 → 에필로그. 끝나면 `finished`로 종료. audit 위반 0건 |

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

플레이 서버는 항상 실제 모델(GPU)로 돈다(D32). `bin/`과 `models/`에 실행 파일과 모델이 없으면 빠진 파일과 설치 명령을 알려 주고 시작하지 않는다. 설치는 아래 "Phase 1 설치 절차"를 본다. 가짜 모델은 `npm run check`와 `npm run sim` 안에서만 쓴다.

| 환경 변수 | 기본값 | 뜻 |
|---|---|---|
| `TIME_SCALE` | `1` | 단계 시간 배율 |
| `LLAMA_BIN`, `LLAMA_MODEL`, `LLAMA_PORT`, `LLAMA_CTX` | `bin/llama-server`, `models/Qwen3.5-4B-Q4_K_M.gguf`, `8080`, 자동 | llama.cpp. 컨텍스트는 기본 102400이고, VRAM이 최소 사양보다 작으면 32768로 줄이며 시작 로그에 경고를 남긴다 |
| `SD_BIN`, `SD_DIFFUSION_MODEL`, `SD_VAE`, `SD_TEXT_ENCODER` | `bin/sd-cli`, `models/flux-2-klein-4b-Q4_0.gguf`, `models/flux2-small-decoder.safetensors`, `models/Qwen3-4B-Q4_K_M.gguf` | stable-diffusion.cpp. 기본값은 `setup:image`가 받는 파일과 같다 |
| `SD_EXTRA_ARGS` | 없음 | sd-cli에 덧붙일 인자 |
| `LLAMA_EXTRA_ARGS` | 없음 | llama-server에 덧붙일 인자 |
| `RUNS_DIR` | `runs` | 회차 기록 위치 |

## 시스템 요구 사항과 RAM 16GB 지원

| 항목 | 요구 |
|---|---|
| GPU | RTX 3060 Ti(VRAM 8GB) 이상 |
| 시스템 RAM | **16GB 이상**. 16GB Windows PC에서 WSL이 기본으로 받는 약 8GB로 충분하다 |
| OS | Windows + WSL2(Ubuntu 24.04에서 확인) |

**16GB 검증(2026-11-03).** `scripts/perf/e2e-memory.sh`로 측정했다. 프로그램 전체(게임 서버, llama-server, sd-cli)를 **메모리 상한 7.9GB cgroup**(16GB PC의 WSL과 같은 조건) 안에서 실제 모델로 돌렸다. 인격 생성 → GPU 교대 → 사진 7장 → 1일차 전체를 완주했고, **OOM은 0건**이었다.

| 구간 | 회수 불가 메모리(anon+shmem) | 비고 |
|---|---|---|
| 인격 생성(LLM) | 약 2.5GB | llama-server 적재 중 |
| 사진 생성(sd-cli) | **최대 4.8GB** (anon 0.5 + shmem 4.3) | CUDA 호스트 버퍼. 가장 큰 구간 |
| 게임 진행(LLM) | 2.2~3.2GB | |
| cgroup 전체(파일 캐시 포함) | 최대 7.2GB | 캐시는 모자라면 커널이 비운다 |

- **llama-server 프롬프트 캐시(2026-11-03 3일 완주에서 발견).** llama.cpp의 호스트 RAM 프롬프트 캐시(`--cache-ram`)는 기본 상한이 8192MiB다. 3일을 도는 동안 캐시가 계속 쌓여 회수 불가 메모리가 7.7GB까지 올랐고, 7.9GB 상한에 닿아 스왑을 썼다(OOM은 없었다). 1일차만 돌린 측정에서는 캐시가 덜 쌓여 드러나지 않았다. 게임 서버 힙은 3일 시뮬레이션을 네 번 연달아 돌려도 22MB로 일정하다(누수 없음). 조치: `--cache-ram 1024`를 항상 넘긴다(`LLAMA_CACHE_RAM`으로 바꿀 수 있다). 같은 조건으로 다시 3일을 완주한 결과, 게임 중 회수 불가 메모리는 최대 1.7GB였다(전체 최대는 사진 생성 구간의 4.8GB로 이전과 같다). OOM 0, audit 위반 0.
- 실행 성능은 타협하지 않았다. 대사 속도는 VRAM이 결정하고 시스템 RAM과는 무관하다.
- 메모리를 많이 쓰는 것은 컴파일 단계다(cicc 하나가 최대 5.8GB). `scripts/setup`은 메모리 상한 cgroup 안에서 병렬 수를 줄여 빌드하므로 16GB에서도 빌드된다. 대신 시간이 더 걸린다. 배포할 때는 미리 빌드한 바이너리를 주면 사용자 PC에서 컴파일할 필요가 없다.
- 실행 전에 `npm run doctor`가 메모리 총량(7.5GB 이상)과 가용 메모리(6GB 이상 권장)를 점검한다.
- 함께 띄운 개발 도구가 더 위험하다. VS Code Dart 확장이 홈 폴더 전체를 분석하면서 언어 서버가 11GB까지 커진 적이 있다. 게임 중에는 무거운 IDE와 언어 서버를 닫는다.
- 개발 PC에서 사진 한 장은 약 50초(768×768, 4스텝)였다. VRAM이 모자라 확산 모델 가중치를 RAM에 두고 돌렸기 때문이다. 캐스팅 전체는 약 7분이었다. 최소 사양에서 다시 잰다.

## 검증

| 명령 | 내용 | 마지막 결과 |
|---|---|---|
| `pnpm check` | 타입 검사(TS 6 strict), ESLint, dependency-cruiser(계층 규칙), vitest | 통과. 테스트 63개 |
| `pnpm sim --seeds 1000` | FakeLlm + 가상 시계로 3일 전체를 끝까지 진행하고 매 판 audit. 사용자 성별을 번갈아 바꾼다 | 1000/1000 통과(약 5분) |
| `pnpm audit:run runs/<run_id>` | 실제 플레이한 회차의 deliveries·출력을 가시성 규칙과 대조 | 실제 모델 1일차 1판: 위반 0건 |
| `scripts/perf/e2e-memory.sh [상한MB]` | 메모리 상한 cgroup 안에서 실제 모델 E2E를 돌리고 메모리를 2초 간격으로 기록(`runs/e2e-mem/`) | 7.9GB 상한에서 완주, OOM 0 |
| `npm run drive -- --create` / `npm run transcript -- <runDir>` | 실행 중인 서버에 사람으로 붙어 한 판 진행 / 회차 기록을 대화록으로 출력(`--as p_00`이면 그 참가자 시점) | — |
| `pnpm --filter @heart/server cli doctor` | Node 버전, 모드별 바이너리·모델 경로, llama-server 응답 확인 | — |

테스트 구성:
- `engine`: 캐스팅 불변식(fast-check 200회), 가시성, 투표 검증, 방 배정 성질(500회), 브런치 조(성별 섞기·심야 쌍 분리), 활동 그룹(모두 한 그룹, 2명 이상), 마지막 데이트(사람의 선택 보장·중복 없음), 발언자 선택, 관계 환산
- `agents`: 출력 검증기, 시점 격리. 무작위 입장·퇴장·발언 시나리오 300회에서 뷰가 근거로 쓴 이벤트가 모두 소유자에게 관찰 가능한지 확인한다
- `runtime`: GameClock(일시정지·hold), GpuQueue(우선순위·취소·승격)
- `server`: 3일 시뮬레이션 4판(남녀, 일정 전체 순서 확인), 같은 시드 결정성, 메기는 입장 전 어떤 프롬프트에도 없고 입장 전 대화를 관찰할 수 없음, 투표 본인 한정 가시성, 익명 카드 전달 이벤트에 보낸 사람 흔적 없음

웹 UI는 Windows Chrome을 헤드리스로 띄워 스크린샷으로 확인했다(온보딩, 거실, 1:1, 종료된 방, 타이머, 입력 중 표시, 사이드바 접기, 활동 선택, 시그널 카드, 우체통 답장, 에필로그).

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
- CUDA 아키텍처 기본값은 `75;86;89`다. 빌드 시간을 줄이려면 `CUDA_ARCHS=86`처럼 지정한다.
- 빌드는 전체 메모리의 60%를 상한으로 둔 cgroup 안에서 돈다(`MEM_LIMIT_MB`로 바꿀 수 있다). 병렬 수는 cicc 하나당 6GB 기준으로 정하고, `JOBS`로 덮어쓸 수 있다.
- stable-diffusion.cpp의 `sd-server` 웹 프론트엔드 빌드(pnpm, 네트워크 필요)는 끈다.
- 모델 파일은 SHA-256으로 검증한다(`scripts/setup/models.sh`).
  - VAE는 FLUX.2-small-decoder(Apache 2.0)를 쓴다. stable-diffusion.cpp 문서의 기본 VAE는 FLUX.2-dev 저장소에 있는데, 접근 승인이 필요하고 비상업 라이선스다.
  - FLUX.2 klein 4B GGUF는 Q4_K_M 판이 없어서 Q4_0을 쓴다.

### Phase 1 결과 (2026-11-02~03)

- 툴체인(CUDA 12.9 리포 내 설치), llama.cpp `v0.8.0`와 stable-diffusion.cpp `master-1039-290148d` CUDA 빌드, 모델 4개 다운로드·해시 검증.
- 계약: `response_format`(json_schema) 준수 35/35, thinking 출력 0건(`chat_template_kwargs.enable_thinking=false`), `--reasoning on|off` 플래그 존재.
- 개발 PC 실측(최소 사양보다 느린 GPU, `-c 32768`): 전체 p50 2.33s / p95 4.83s, 대사 p50 2.42s / p95 4.11s, 생성 약 66 tok/s, 프롬프트 처리 약 210~230 tok/s, 한국어 글자당 0.48토큰.
- 실제 모델 E2E: 게임 서버가 llama-server를 내리고 사진 7장을 만든 뒤 다시 올려 1일차를 완주했다. GPU 교대가 동작한다. LLM 호출 거부율은 대사 11%, 인격 말투 50%다(존댓말 검증. 실패분은 재생성 후 1명만 템플릿으로 대체).
- 실측으로 고친 것: 관계 평가 최대 토큰을 대상 수에 비례하게, 예시 대사 번호표 제거, 투표 유보 쏠림 완화, 한자·가나 누출 거부, 처음 만난 사이의 반말 거부(웃음만 붙은 조각 처리 포함).

### Phase 1에서 남은 일
1. 최소 사양(RTX 3060 Ti, `-c 102400`)에서 `bench`와 `scripts/perf/e2e-memory.sh`를 실측하고 design.md §13을 바꾼다.
2. 캐스팅 시간 단축: 사진마다 sd-cli를 새로 띄우면서 모델을 7번 다시 읽는다. `sd-server` 상주 모드 구현체(`ImagePort`)를 추가한다.

### 설계에는 있지만 아직 구현하지 않은 것
- 1:1에서 사람이 60초 동안 입력하지 않을 때의 자동 일시정지(design.md §12). 일시정지 사유 `afk`와 재개 UI는 만들어 두었다.
- 서버 재시작 후 이어하기. 이벤트 로그와 fold는 준비됐지만, 단계 중간부터 재개하는 기능은 없다. 지금은 재시작하면 새 게임이다.
- `ReplayLlm`(저장된 출력으로 재생), 관전(god) 뷰(`--dev-observer`). 지금은 `transcript` CLI가 god 로그 역할을 한다
- 회차 기록 보관·삭제 UI(`COMPLETED` 단계의 선택). 지금은 에필로그를 닫으면 끝나고 기록은 `runs/`에 남는다.
- 시그널 카드를 받은 사람의 "보낸 사람 추측"을 인상(impression)으로 저장하는 단계(game-rules.md §5.5). 지금은 받은 카드가 투표·관계 평가의 근거로만 들어간다.
- 에필로그의 "사람이 실제로 관찰한 주요 대화" 요약. 지금은 채팅방 목록에 지난 방이 모두 남아 있어 그것으로 대신한다.

### 알려진 한계
- FakeLlm의 대사는 정해진 문장 풀에서 뽑는다. 그래서 반복 검사 거부가 20% 안팎으로 나온다.
- 실제 모델(4B)의 품질 과제(Phase 2 튜닝):
  - (완화) "ㅋㅋ"를 과하게 쓰고 장난스럽게 말하던 문제. 웃음 표현 후처리(design.md §7.5), 캐스팅의 웃음 빈도 분포 하향, 공통 규칙에 "친해지기 전에는 예의 바르고 담백하게" 추가로 대응했다. 실제 모델로 다시 확인해야 한다.
  - (완화) 같은 사람이 앞말을 되풀이하며 연달아 말하던 문제. 반복 검사에 겹침 계수를 추가했다. 또 대화가 끊겼을 때 화제를 여는 사람에서 직전 화자를 뺐다. 방에 AI가 한 명뿐이면 그 사람이 자기 말에 다시 이어 붙이던 원인이었다.
  - 첫인상 투표에서 유보가 절반이다(심야 투표는 대부분 선택한다).
  - 입장 인사를 두 번 하는 경우가 있다.
  - 어색한 한국어 문장이 섞인다. (완화) 번역투 호칭("수아, ~") 후처리, 반말 낱말·호칭 거부, 소문자 영단어 거부, 말투 예시에서 인사·취미 답변 제거(모델이 그대로 베꼈다), "직전 말에 먼저 반응" 규칙을 넣었다. 실제 모델로 다시 확인해야 한다.
- 자유 대화 속 사실("저 부산 살아요")은 사실로 저장하지 않는다(D7). 원문과 요약으로만 남는다.
- 3일 완주 대화록 분석(2026-11-03, 자동 플레이어 사용)에서 고친 것: 다른 참가자의 문장을 그대로 옮기거나 같은 문장을 메시지마다 덧붙이던 문제(방의 최근 문장과 겹치는 문장을 지운다, design.md §7.5), 문장 중간의 반말 의문문("~할까?"), "저가/제가도" 조사 오류, 인물 설정의 반말·사투리 설정과 대사처럼 쓴 말투 설명, 카드가 받는 사람이 아니라 카드 자체를 말하던 문제("그분에게 이 카드가 닿을까요?"), 질문이 아닌 우체통 질문, 보낸 카드와 받은 카드를 헷갈린 투표 이유, 같은 사람의 연속 발언(최대 1회로).
- 두 번째 3일 완주에서 고친 것: 우체통 질문 검사가 물음표만 빠진 의문문까지 거부해 질문이 3건만 오갔다(의문형 어미면 물음표를 붙여 받는다). 인격 생성이 7명 중 3명 템플릿으로 대체됐다(인격 작업은 4번까지 시도한다). "나랑" 같은 반말 낱말 추가.
- 세 번째 3일 완주(2026-11-03 15:09, 약 70분): 인격 7명 모두 생성(템플릿 대체 0), 대사 거부율 약 6%(1회차 10%), 게임 중 회수 불가 메모리 최대 1.9GB, cgroup 최대 6.7GB로 상한(7.9GB)에 한 번도 닿지 않았고 스왑 2MB, audit 위반 0. 다른 참가자 문장 베끼기는 표본에서 사라졌다. 우체통 질문은 여전히 3건뿐이라 출력 필드를 `question`으로 바꾸고 예시와 재시도(3회)를 넣었다(실제 모델 재확인 전). "제가랑" 조사와 문장 중간의 "~니?" 반말도 추가로 잡는다.
- 남은 품질 과제: 겪지 않은 일을 지어낸다("첫날 아침 제 요리를 먹어 주셨던 기억"). 대화가 취미(러닝·와인) 이야기로 맴돈다. 데이트 중간에 다시 "안녕하세요"로 인사한다.
- 1:1·데이트에서 AI가 사람의 대답을 기다리지 않고 여러 번 이어 말하는 경우가 있다(사람이 자주 말하지 않을 때 화제 꺼내기가 반복된다).
- 투표·카드·우체통처럼 선택을 받는 동안에도 거실 방은 열려 있다. 그 사이 사람이 거실에 말을 걸면 아무도 대답하지 않는다(장면이 멈춰 있다).

## 코드 지도

| 위치 | 내용 |
|---|---|
| `packages/shared/src/events.ts` | 이벤트 종류와 payload 스키마. 새 이벤트는 여기에 추가한다 |
| `packages/shared/src/protocol.ts` | 사람 시점 화면 상태(`HumanView`), `ViewPatch`, 명령, `applyPatch` |
| `packages/engine/src/state.ts`, `visibility.ts` | fold와 가시성 판정. 격리의 핵심이다 |
| `packages/agents/src/observation.ts` | AI가 게임 상태를 읽는 유일한 통로. 근거 seq를 기록한다 |
| `packages/agents/src/tasks/*.ts` | LLM 작업(TaskSpec)과 프롬프트 |
| `packages/runtime/src/stages/*.ts` | 단계 핸들러. 날짜별 `day1.ts`·`day2.ts`·`day3.ts`, 반복 단계 팩토리(거실 대화·심야 선택·심야 대화·마무리)는 `routines.ts`, 투표·대화 슬롯 절차는 `common.ts` |
| `packages/config/src/events.ts` | 활동 후보, 브런치·활동 상황 카드, 데이트 장소(템플릿) |
| `packages/runtime/src/chat-scene.ts` | 한 방의 발언 진행(누가 언제 말할지) |
| `apps/server/src/compose.ts`, `env.ts` | 모드별 추론 조립 |
| `apps/server/src/sim.ts` | 헤드리스 시뮬레이터 |
| `apps/web/src` | React UI |
