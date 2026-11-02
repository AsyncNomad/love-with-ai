#!/usr/bin/env bash
# stable-diffusion.cpp(sd-cli)를 CUDA로 빌드한다(design.md D22). 결과: bin/sd-cli
source "$(dirname "$0")/env.sh"
use_cuda

SRC="$VENDOR/stable-diffusion.cpp"
if [[ ! -d "$SRC/.git" ]]; then
  log "stable-diffusion.cpp $SD_CPP_REF 받기"
  git clone --quiet --depth 1 --branch "$SD_CPP_REF" --recurse-submodules --shallow-submodules https://github.com/leejet/stable-diffusion.cpp "$SRC"
fi

log "stable-diffusion.cpp 빌드 (CUDA archs: $CUDA_ARCHS, jobs: $JOBS)"
cmake -S "$SRC" -B "$SRC/build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DSD_CUDA=ON \
  -DCMAKE_CUDA_ARCHITECTURES="$CUDA_ARCHS" \
  -DBUILD_SHARED_LIBS=OFF >/dev/null
cmake --build "$SRC/build" -j "$JOBS"

CLI=$(find "$SRC/build/bin" -maxdepth 1 -type f \( -name 'sd-cli' -o -name 'sd' \) | head -1)
[[ -n "$CLI" ]] || { echo "sd-cli 실행 파일을 찾지 못했습니다" >&2; exit 1; }
ln -sf "$CLI" "$BIN/sd-cli"
log "완료: $BIN/sd-cli"
