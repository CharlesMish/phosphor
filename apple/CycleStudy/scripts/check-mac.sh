#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf '%s\n' 'This check needs a Mac with Xcode. Portable audio checks: sh scripts/test-dsp.sh' >&2
  exit 1
fi
if ! xcodebuild -version >/dev/null 2>&1; then
  printf '%s\n' 'Open Xcode once and finish its setup. Then select Xcode under Xcode > Settings > Locations > Command Line Tools.' >&2
  exit 1
fi

mkdir -p build
sh scripts/test-dsp.sh
xcodebuild -project PhosphorStudy.xcodeproj -scheme PhosphorStudy \
  -configuration Debug -destination 'generic/platform=macOS' \
  -derivedDataPath build/macOS CODE_SIGNING_ALLOWED=NO \
  build 2>&1 | tee build/macos-build.log
xcodebuild -project PhosphorStudy.xcodeproj -scheme CycleModelChecks \
  -destination 'platform=macOS' -derivedDataPath build/model-tests \
  CODE_SIGNING_ALLOWED=NO test 2>&1 | tee build/model-test.log
printf '\n%s\n' 'Checks passed. Launch the local Mac build with:' \
  'open build/macOS/Build/Products/Debug/PhosphorStudy.app'
