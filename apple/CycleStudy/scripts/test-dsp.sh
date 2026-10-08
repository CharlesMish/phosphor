#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
build_dir=$(mktemp -d)
trap 'rm -rf "$build_dir"' EXIT
${CC:-cc} -std=c11 -O1 -g -Wall -Wextra -Werror \
  -fsanitize=address,undefined -fno-omit-frame-pointer \
  -I PhosphorStudy/DSP PhosphorStudy/DSP/CycleSynth.c Tests/CycleSynthTests.c \
  -lm -pthread -o "$build_dir/cycle-tests"
"$build_dir/cycle-tests"
