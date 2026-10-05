#!/usr/bin/env bash
# install.sh -- set motion-kit up on this Mac, from a fresh clone:
#   1. link the skills into ~/.claude/skills (or $CLAUDE_SKILLS_DIR)
#   2. install what is missing and can be installed without a password:
#      ffmpeg (Homebrew), numpy (pip), Playwright + its Chromium and WebKit (npm)
#   3. install the companion transitions.dev skills (free; by Jakub Antalik) unless
#      --no-transitions is given or skills go to a custom $CLAUDE_SKILLS_DIR
#   4. run the doctor, which prints the exact fix for anything still missing
# --link-only does step 1 only (used by tests). Safe to re-run.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
mkdir -p "$DEST"
for skill in "$ROOT"/skills/*/; do
  name="$(basename "$skill")"; target="$DEST/$name"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "error: $target exists and is not a symlink; move it aside first" >&2; exit 1
  fi
  ln -sfn "${skill%/}" "$target"
  echo "linked $name -> ${skill%/}"
done
[ "${1:-}" = "--link-only" ] && exit 0

# Homebrew needs your password, so it is never installed from here; the doctor
# prints the one-line installer if it is missing.
if command -v brew >/dev/null && ! command -v ffmpeg >/dev/null; then
  echo "installing ffmpeg (Homebrew)..."
  brew install ffmpeg
fi
if command -v python3 >/dev/null && ! python3 -c 'import numpy' 2>/dev/null; then
  echo "installing numpy (pip, user site)..."
  python3 -m pip install --user numpy || echo "warning: could not install numpy; see the doctor's fix below" >&2
fi
if command -v npm >/dev/null; then
  npm --prefix "$ROOT/skills/motion-video" install --no-audit --no-fund
  (cd "$ROOT/skills/motion-video" && npx playwright install chromium webkit)
fi
# Companion catalog of ready-made UI transitions. Installed with its own CLI into
# ~/.claude/skills (never copied into this repo: its terms forbid republishing it).
if [[ " $* " != *" --no-transitions "* ]] && [ -z "${CLAUDE_SKILLS_DIR:-}" ] && command -v npx >/dev/null; then
  if [ -d "$HOME/.claude/skills/transitions-dev" ]; then
    echo "transitions.dev skills already installed (update: npx skills update transitions-dev transitions-polish)"
  else
    echo "installing transitions.dev skills..."
    npx -y skills add Jakubantalik/transitions.dev -g -a claude-code -s '*' -y </dev/null \
      || echo "warning: could not install transitions.dev skills; retry: npx skills add Jakubantalik/transitions.dev -g -a claude-code -s '*' -y" >&2
  fi
fi
"$ROOT/skills/motion-video/scripts/doctor.sh"
