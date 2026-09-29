#!/usr/bin/env bash
# install.sh -- link motion-kit skills into ~/.claude/skills, install render deps, run doctor.
# --link-only skips npm install and doctor (used by tests).
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
  echo "linked $name -> $target"
done
[ "${1:-}" = "--link-only" ] && exit 0
npm --prefix "$ROOT/skills/motion-video" install --no-audit --no-fund
"$ROOT/skills/motion-video/scripts/doctor.sh"
