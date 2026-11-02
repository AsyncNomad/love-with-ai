#!/usr/bin/env bash
# llama.cpp(llama-server)를 CUDA로 빌드한다(design.md D3). 결과: bin/llama-server
source "$(dirname "$0")/env.sh"
use_cuda

SRC="$VENDOR/llama.cpp"
if [[ ! -d "$SRC/.git" ]]; then
  log "llama.cpp $LLAMA_CPP_REF 받기"
  git clone --quiet --depth 1 --branch "$LLAMA_CPP_REF" https://github.com/ggml-org/llama.cpp "$SRC"
fi

log "llama.cpp 빌드 (CUDA archs: $CUDA_ARCHS, jobs: $JOBS)"
cmake -S "$SRC" -B "$SRC/build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DGGML_CUDA=ON \
  -DCMAKE_CUDA_ARCHITECTURES="$CUDA_ARCHS" \
  -DLLAMA_CURL=OFF \
  -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_EXAMPLES=OFF \
  -DBUILD_SHARED_LIBS=OFF >/dev/null
cmake --build "$SRC/build" --target llama-server -j "$JOBS"

ln -sf "$SRC/build/bin/llama-server" "$BIN/llama-server"
log "완료: $BIN/llama-server"
