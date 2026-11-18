#!/usr/bin/env bash
# Chat Islands device check, short output on purpose (everything printed stays in an AI session).
#
#   bash .github/scripts/islands-device.sh            newest diagnostics log, filtered (last 60 lines)
#   bash .github/scripts/islands-device.sh --all      the whole filtered log
#   bash .github/scripts/islands-device.sh --tree     island hosts in the live view tree (+ their first children)
#   bash .github/scripts/islands-device.sh --shot     screenshot to .device/shot.png (prints the path)
#   bash .github/scripts/islands-device.sh --clean    delete the diagnostics logs on the phone (before a test run)
#
# Options combine. Needs adb with the phone connected; Git Bash on Windows.
set -euo pipefail
export MSYS_NO_PATHCONV=1

PKG=${ISLANDS_PKG:-app.valenced}
DIR=/sdcard/Android/data/$PKG/files/chat-islands
OUT=$(cd "$(dirname "$0")/../.." && pwd)/.device
mkdir -p "$OUT"
# adb is a Windows program: give it a Windows path for local files (Git Bash paths aren't converted here)
LOCAL=$OUT
command -v cygpath >/dev/null 2>&1 && LOCAL=$(cygpath -w "$OUT")

lines=60 tree=0 shot=0 clean=0 log=1
for a in "$@"; do
    case "$a" in
        --all) lines=0 ;;
        --tree) tree=1; log=0 ;;
        --shot) shot=1; log=0 ;;
        --clean) clean=1; log=0 ;;
        --log) log=1 ;;
        *) echo "unknown option $a" >&2; exit 2 ;;
    esac
done

adb get-state >/dev/null 2>&1 || { echo "No phone over adb (adb devices is empty)"; exit 1; }

if [ "$clean" = 1 ]; then
    adb shell "rm -f $DIR/diag-*.log" && echo "Cleared diagnostics logs on the phone"
fi

if [ "$log" = 1 ]; then
    f=$(adb shell "ls -t $DIR/ 2>/dev/null" | tr -d '\r' | head -1)
    if [ -z "$f" ]; then
        echo "No diagnostics log on the phone yet ($DIR)"
    else
        adb pull "$DIR/$f" "$LOCAL/$f" >/dev/null
        echo "== $f ($(wc -l < "$OUT/$f") lines; full copy: .device/$f)"
        # Drop known noise, keep 2 lines of each stack trace, cap line length
        filtered=$(grep -v -E "without a request|first (build|setController)\(\)" "$OUT/$f" \
            | awk '/^[ \t]+at / { if (++st <= 2) print; next } { st = 0; print }' \
            | cut -c1-300)
        if [ "$lines" = 0 ]; then printf '%s\n' "$filtered"; else printf '%s\n' "$filtered" | tail -n "$lines"; fi
    fi
fi

if [ "$tree" = 1 ]; then
    echo "== island hosts in the view tree"
    adb shell dumpsys activity top | grep -A2 "IslandHost" | sed -E 's/^ +//; s/\{[0-9a-f]+ /{/' | cut -c1-160 || echo "(none)"
fi

if [ "$shot" = 1 ]; then
    adb exec-out screencap -p > "$OUT/shot.png"
    echo "Screenshot: $OUT/shot.png"
fi
