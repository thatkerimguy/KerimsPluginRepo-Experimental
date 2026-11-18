# KerimsPluginRepo (experimental)

Kept short on purpose: this file is re-read on every step. Details live in the files below; read them only when the task needs them.

## Projects

- **GIFs+** (`vencord/gifPickerOptimizer/`, `valenced/gif-picker-optimizer/`): GIF picker plugin, Vencord + Valenced builds. Full notes: `GIFS_PLUS.md`. History: `CHANGELOG.md`. Testing: `TESTING.md`.
- **Chat Islands** (`valenced/chat-islands/`, JS + Kotlin) and **Social Embeds** (`valenced/social-embeds/`): plan, design, rules and progress in `SOCIAL_EMBEDS_PLAN.md` (section 12 = where things stand); device-testing handoff in `SOCIAL_EMBEDS_HANDOFF.md`.
- **Media Fixes** (`valenced/media-fixes/`, JS + Kotlin, unrelated to the others): fixes Discord's black-video-with-sound (decoder fallback, skips failing hardware decoders, retries) and videos playing by themselves in the background. Causes, hooks and device checklist: `valenced/media-fixes/README.md`. Log: `/sdcard/Android/data/<pkg>/files/media-fixes/`.

## Repo and releases

- This folder (`C:\Work\KerimsPluginRepo-Experimental`) is the git clone of GitHub `thatkerimguy/KerimsPluginRepo-Experimental`. Every push to `main` publishes `<manifest version>.<run>` to the experimental Valenced repo (also for docs-only pushes). Pushing here needs no confirmation; the stable repo does.
- GIFs+ shared files: edit in `vencord/gifPickerOptimizer/`, then `node .github/scripts/sync-shared.mjs` (CI checks). Bump `PLUGIN_VERSION` with the manifest version.
- Tests: `cd tests`, `npm ci`, `npm test`; Discord code checks `npm run test:patches`. Native (Kotlin) only builds in CI.
- The user is on Windows: give cmd / PowerShell commands. Plain wording; record results in the plan / CHANGELOG.

## Rules (each came from a bug; full list in GIFS_PLUS.md and SOCIAL_EMBEDS_PLAN.md section 10)

- Never change Discord's data, only what's displayed.
- No hardcoded colours: theme tokens / CSS variables only.
- Mobile JS: nothing from `react`, `react-native` or `@valenced/discord/*` at module level; classic JSX pragma on every `.tsx`; never `<RN export>.<RN name>`; never a React / RN import as a shorthand object key; flux patches return the payload.
- Desktop: never copy an `@webpack/common` value at module level.
- Native (Chat Islands): never call into JS before `listen`; JS methods called from native never throw; main-thread work goes through `Runtime.post` / `guarded`.

## Working efficiently (usage)

Everything a tool prints stays in the conversation and is re-read on every later step, so:

- **Device testing:** use `bash .github/scripts/islands-device.sh` (newest diagnostics log, filtered; `--tree` island views; `--shot` screenshot). Don't dump raw `adb logcat` or `dumpsys`. Look at a screenshot only when the log can't answer the question; one per round.
- **Pushing:** `bash .github/scripts/ci-wait.sh` after `git push` prints one line per CI job and the published version. Run it in the background; don't poll.
- **Reading code:** `grep -n` / `sed -n 'a,bp'` for the lines needed, never whole large files; cap output (`| head -50`, `cut -c1-200`). The decompiled Discord (`C:\Work\discord-352.6-jadx`, see the handoff) is huge: search it, don't list it.
- **Batch:** several fixes per build rather than one diagnostic round per question; diagnostics go to the device log file (`DiagLog` / `Runtime.diag`), not new builds just to log.
- **No subagents** (the user's call). No re-reading files already in context.
- **Long sessions get expensive:** after a milestone, record it in the plan and suggest a fresh session.
