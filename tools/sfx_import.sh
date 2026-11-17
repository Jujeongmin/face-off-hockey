#!/usr/bin/env bash
# Turns downloaded sound effects into the game's short mono clips.
# Put each download in PROJECT/sfx_raw named after its clip (shot.mp3, horn.wav, ...), then run:
#   bash tools/sfx_import.sh
# Each clip: leading silence cut, mono 44.1 kHz, cut to its max length with a short fade, loudness-normalised,
# MP3 96 kbps into public/audio/sfx. Short + mono keeps the decoded PCM small (seconds x 44100 x 4 B).
set -euo pipefail
cd "$(dirname "$0")/.."
declare -A MAX=( [shot]=0.6 [pass]=0.35 [post]=1.2 [save]=0.6 [board]=0.6 [horn]=3.0 [whistle]=1.2 [skill]=0.8
  [whiff]=0.5 [bump]=0.4 [check]=0.6 [big]=0.9 [boards]=1.2 [punch]=0.5 [block]=0.4 [ko]=1.4 )
for name in "${!MAX[@]}"; do
  src=$(ls PROJECT/sfx_raw/"$name".* 2>/dev/null | head -1 || true)
  [ -z "$src" ] && { echo "missing  $name"; continue; }
  d=${MAX[$name]}; fade=$(awk "BEGIN{print ($d<1)?0.08:0.3}"); fst=$(awk "BEGIN{print $d-$fade}")
  ffmpeg -loglevel error -y -i "$src" -ac 1 -ar 44100 \
    -af "silenceremove=start_periods=1:start_threshold=-45dB,atrim=0:$d,afade=t=out:st=$fst:d=$fade,loudnorm=I=-16:TP=-1.5" \
    -c:a libmp3lame -b:a 96k "public/audio/sfx/$name.mp3"
  echo "ok       $name ($(stat -c %s "public/audio/sfx/$name.mp3") B)"
done
