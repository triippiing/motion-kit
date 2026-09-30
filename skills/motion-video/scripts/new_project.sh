#!/usr/bin/env bash
# new_project.sh DIR SONG [analyze_song args...] -- scaffold a motion-video project:
# template index.html, springs.js, synthesised click and key SFX, song.json and clip.wav.
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
SKILL="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
if [ $# -lt 2 ]; then echo "usage: new_project.sh DIR SONG [--size square|vertical|landscape|WxH] [--theme CSS] [--map role=--var] [--bars N] [--states N] [--start-bar N]" >&2; exit 2; fi
DIR="$1"; SONG="$2"; shift 2
SIZE=square; THEME=""; MAPS=(); ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --size|--theme|--map)
      if [ $# -lt 2 ]; then echo "error: $1 needs a value" >&2; exit 2; fi
      case "$1" in --size) SIZE="$2" ;; --theme) THEME="$2" ;; --map) MAPS+=(--map "$2") ;; esac
      shift 2 ;;
    *)       ARGS+=("$1"); shift ;;
  esac
done
case "$SIZE" in
  square) W=1440; H=1440 ;;
  vertical) W=1080; H=1920 ;;
  landscape) W=1920; H=1080 ;;
  *x*) W="${SIZE%x*}"; H="${SIZE#*x}" ;;
  *) W=0; H=0 ;;
esac
if ! [[ "$W" =~ ^[0-9]+$ && "$H" =~ ^[0-9]+$ ]] || [ "$W" -lt 64 ] || [ "$H" -lt 64 ] || [ $((W % 2)) -ne 0 ] || [ $((H % 2)) -ne 0 ]; then
  echo "error: --size must be square, vertical, landscape or WxH with even numbers >= 64" >&2; exit 2
fi
if [ -e "$DIR/index.html" ]; then echo "error: $DIR/index.html exists; not overwriting" >&2; exit 1; fi
mkdir -p "$DIR/sfx"
python3 "$SKILL/scripts/analyze_song.py" "$SONG" --out "$DIR" ${ARGS[@]+"${ARGS[@]}"}
python3 "$SKILL/scripts/extract_theme.py" ${THEME:+"$THEME"} --out "$DIR" ${MAPS[@]+"${MAPS[@]}"}
printf '{"stage": {"width": %d, "height": %d}}\n' "$W" "$H" > "$DIR/project.json"
cp "$SKILL/template/index.html" "$DIR/index.html"
cp -L "$SKILL/assets/springs.js" "$DIR/springs.js"
# A short filtered-noise tick: ours, so no licensing question.
ffmpeg -v error -y -f lavfi -i "anoisesrc=d=0.03:c=pink:a=0.8:seed=7" \
  -af "highpass=f=1800,lowpass=f=9000,afade=t=out:st=0.002:d=0.028" -ar 48000 "$DIR/sfx/click.wav"
# A shorter, higher, quieter tick for typing.
ffmpeg -v error -y -f lavfi -i "anoisesrc=d=0.018:c=pink:a=0.5:seed=11" \
  -af "highpass=f=3500,lowpass=f=10000,afade=t=out:st=0.002:d=0.016" -ar 48000 "$DIR/sfx/key.wav"
echo "project ready: $DIR"
echo "  watch live:  node '$SKILL/scripts/render.mjs' '$DIR' --serve"
