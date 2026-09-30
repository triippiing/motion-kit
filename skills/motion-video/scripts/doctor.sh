#!/usr/bin/env bash
# doctor.sh -- check everything motion-video needs; print the exact fix for anything missing.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
SKILL="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
fail=0
ok()  { printf '  ok       %s\n' "$1"; }
bad() { printf '  MISSING  %s\n           fix: %s\n' "$1" "$2"; fail=1; }

if command -v brew >/dev/null; then ok "homebrew $(brew --version | head -1 | cut -d' ' -f2)"
else bad homebrew '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"   (run in Terminal: needs your password)'; fi

if command -v ffmpeg >/dev/null; then
  if ffmpeg -hide_banner -filters 2>/dev/null | grep -qw tmix; then ok "ffmpeg $(ffmpeg -version | head -1 | cut -d' ' -f3) (tmix)"
  else bad "ffmpeg tmix filter" "brew reinstall ffmpeg"; fi
  command -v ffprobe >/dev/null && ok ffprobe || bad ffprobe "brew install ffmpeg"
else bad ffmpeg "brew install ffmpeg"; fi

# 20.11 is the first Node with import.meta.dirname, which the scripts use.
if node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 20 || (a === 20 && b >= 11) ? 0 : 1)' 2>/dev/null
then ok "node $(node -v)"; else bad "node >= 20.11 (have $(node -v 2>/dev/null || echo none))" "nvm install --lts"; fi

if python3 -c 'import numpy' 2>/dev/null; then ok "numpy $(python3 -c 'import numpy; print(numpy.__version__)')"
else bad numpy "python3 -m pip install numpy"; fi

if [ -d "$SKILL/node_modules/playwright" ]; then
  ok "playwright $(node -p "require('$SKILL/node_modules/playwright/package.json').version")"
  if (cd "$SKILL" && node -e "const {chromium}=require('playwright');require('fs').accessSync(chromium.executablePath())") 2>/dev/null
  then ok "playwright chromium"; else bad "playwright chromium" "(cd '$SKILL' && npx playwright install chromium)"; fi
else bad "playwright package" "npm --prefix '$SKILL' install"; fi

# Optional companion skill: reported, never counted as a failure.
if [ -d "$HOME/.claude/skills/transitions-dev" ]; then ok "transitions.dev skills (optional companion)"
else printf '  optional transitions.dev skills not installed\n           add: npx skills add Jakubantalik/transitions.dev -g -a claude-code -s "*" -y\n'; fi

exit $fail
