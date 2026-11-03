#!/usr/bin/env bash
# 실제 모델 E2E를 메모리 상한 cgroup 안에서 돌리고 최대 메모리를 잰다(16GB PC 검증용).
# 16GB Windows PC에서 WSL이 기본으로 받는 메모리(약 8GB)를 MemoryMax로 흉내 낸다.
# 사용: scripts/perf/e2e-memory.sh [상한MB=7900] [TIME_SCALE=0.15]
# 세션과 분리해 돌리려면: systemd-run --user --unit=heart-e2e --same-dir -E PATH -E LLAMA_CTX scripts/perf/e2e-memory.sh
# 결과: runs/e2e-mem/<시각>/ 에 server.log, drive.log, memory.csv, summary.txt
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LIMIT_MB="${1:-7900}"
SCALE="${2:-0.15}"
OUT="$ROOT/runs/e2e-mem/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
cd "$ROOT"
# shellcheck disable=SC1091
source "$HOME/.nvm/nvm.sh" >/dev/null
UNIT="heart-e2e-$$"

# 게임 서버는 llama-server와 sd-cli를 자식으로 띄우므로 셋 다 같은 cgroup에 들어간다.
LLM_MODE=llamacpp IMAGE_MODE=sdcpp TIME_SCALE="$SCALE" RUNS_DIR="$OUT/runs" LLAMA_CTX="${LLAMA_CTX:-102400}" \
  systemd-run --user --scope -q --unit="$UNIT" -p MemoryMax="${LIMIT_MB}M" -p OOMPolicy=continue -- \
  npx tsx apps/server/src/main.ts > "$OUT/server.log" 2>&1 &
SERVER=$!

CG=""
for _ in $(seq 1 60); do
  CG="/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/$UNIT.scope"
  [[ -f "$CG/memory.current" ]] && grep -q "Heart House server" "$OUT/server.log" 2>/dev/null && break
  sleep 1
done

echo "time_s,cgroup_mb,anon_mb,shmem_mb,file_mb,swap_mb,wsl_used_mb" > "$OUT/memory.csv"
( start=$(date +%s)
  while kill -0 "$SERVER" 2>/dev/null; do
    cur=$(( $(cat "$CG/memory.current" 2>/dev/null || echo 0) / 1048576 ))
    swp=$(( $(cat "$CG/memory.swap.current" 2>/dev/null || echo 0) / 1048576 ))
    # anon·shmem은 회수할 수 없는 메모리, file은 커널이 필요하면 비우는 페이지 캐시다.
    read -r anon shmem file < <(awk '/^anon /{a=$2} /^shmem /{s=$2} /^file /{f=$2} END{print int(a/1048576), int(s/1048576), int(f/1048576)}' "$CG/memory.stat" 2>/dev/null || echo "0 0 0")
    used=$(awk '/MemTotal/{t=$2} /MemAvailable/{a=$2} END{print int((t-a)/1024)}' /proc/meminfo)
    echo "$(( $(date +%s) - start )),$cur,$anon,$shmem,$file,$swp,$used" >> "$OUT/memory.csv"
    sleep 2
  done ) &
SAMPLER=$!

npx tsx apps/server/src/cli.ts drive --create > "$OUT/drive.log" 2>&1 || true
PEAK=$(( $(cat "$CG/memory.peak" 2>/dev/null || echo 0) / 1048576 ))
OOMS=$(awk '/oom_kill /{print $2}' "$CG/memory.events" 2>/dev/null || echo "?")
kill "$SERVER" 2>/dev/null || true
wait "$SERVER" 2>/dev/null || true
kill "$SAMPLER" 2>/dev/null || true

{
  echo "limit_mb=$LIMIT_MB time_scale=$SCALE llama_ctx=${LLAMA_CTX:-102400}"
  echo "cgroup_peak_mb=$PEAK oom_kills=$OOMS"
  echo "drive: $(tail -1 "$OUT/drive.log")"
  awk -F, 'NR>1 && $2>m {m=$2; t=$1} END {print "sampled_cgroup_max_mb=" m " at " t "s"}' "$OUT/memory.csv"
  awk -F, 'NR>1 && $3+$4>m {m=$3+$4; t=$1; a=$3; s=$4} END {print "non_reclaimable_max_mb=" m " (anon " a " + shmem " s ") at " t "s"}' "$OUT/memory.csv"
} | tee "$OUT/summary.txt"
