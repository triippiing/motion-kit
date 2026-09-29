#!/usr/bin/env bash
# new_project.sh DIR SONG [analyze_song args...] -- scaffold a motion-video project:
# template index.html, springs.js, a synthesised click SFX, song.json and clip.wav.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
SKILL="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
if [ $# -lt 2 ]; then echo "usage: new_project.sh DIR SONG [--bars N] [--states N] [--start-bar N]" >&2; exit 2; fi
DIR="$1"; SONG="$2"; shift 2
if [ -e "$DIR/index.html" ]; then echo "error: $DIR/index.html exists; not overwriting" >&2; exit 1; fi
mkdir -p "$DIR/sfx"
python3 "$SKILL/scripts/analyze_song.py" "$SONG" --out "$DIR" "$@"
cp "$SKILL/template/index.html" "$DIR/index.html"
cp -L "$SKILL/assets/springs.js" "$DIR/springs.js"
# A short filtered-noise tick: ours, so no licensing question.
ffmpeg -v error -y -f lavfi -i "anoisesrc=d=0.03:c=pink:a=0.8:seed=7" \
  -af "highpass=f=1800,lowpass=f=9000,afade=t=out:st=0.002:d=0.028" -ar 48000 "$DIR/sfx/click.wav"
echo "project ready: $DIR"
echo "  watch live:  node '$SKILL/scripts/render.mjs' '$DIR' --serve"
