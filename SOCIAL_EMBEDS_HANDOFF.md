# Handoff: Chat Islands phase 0 on a device (for a local Claude session)

Written 2026-11-18 by the cloud session that built this, for a Claude Code session running on the user's Windows PC with their Android phone connected through adb. The cloud session couldn't reach the phone, which is why this continues locally.

Read first: `SOCIAL_EMBEDS_PLAN.md` (the plan, design, rules, progress and decisions), then this file. `CLAUDE.md` is mostly about GIFs+, a separate plugin; its general rules (Windows commands, mobile pre-init rules, no hardcoded colours) apply here too.

## The project in one paragraph

The user wants X, Reddit, TikTok and Instagram links in Discord chat to become widgets that look and navigate like the apps, Android (Valenced) first, desktop (Vencord) second, no iOS, no account connections, theme colours only. Discord's mobile chat is native (rows drawn from JSON by `DCDChatList`), so a plugin can't put React in a message. So there are two products: **Chat Islands** (`valenced/chat-islands/`), a library plugin with a native Kotlin part that shows React Native surfaces ("islands") where a placeholder is drawn in chat; and **Social Embeds** (`valenced/social-embeds/`, later `vencord/socialEmbeds/`), the widgets, the first user of the library. Only Social Embeds' shared core exists so far, without a plugin around it.

## Where things are

- Branch `claude/blissful-mayer-ldmxk6`, also fast-forwarded to `main` of GitHub `thatkerimguy/KerimsPluginRepo-Experimental` (latest: `77e3585`).
- Published on the experimental Valenced repo (`https://thatkerimguy.github.io/KerimsPluginRepo-Experimental/index.json`): **Chat Islands Experimental 0.1.0.14** (ZIP: `manifest.json`, `index.js`, `plugin.jar`). Every push to `main` publishes a new `0.1.0.<run>`.
- The user's local copy is `C:\Work\Gifs+\experimental` (see CLAUDE.md, "Experimental repository"). Pull before working: it may not have these commits yet.

## What's done and checked (in the cloud, not on a device)

- Shared core (`valenced/social-embeds/js/core/`): link detection, post model, rich text, HTTP client, cache, media picking, layouts, kill switch, X (FxEmbed) and Reddit (JSON) resolvers. Tests: `tests/unit/social-*.test.ts` against **hand-made** fixtures (`tests/fixtures/social/`, see its README: record real ones with `record.mjs`).
- Chat Islands JS (`valenced/chat-islands/js/`): registry, store, prepare / measure pipeline, placeholder (an image embed whose URL is a `https://chat-islands.invalid/i/<key>?w=&h=` marker), the row patch on `MessageWithContent.generateMessageRowData`, `useRowManager`'s `updateRows` capture, the `ChatIsland` surface root, a built-in test island (`demo.tsx`) for messages containing `[island test]`. Tests: `tests/unit/islands.test.ts`; Discord module check: `tests/patches/mobile-modules.test.ts`.
- Chat Islands native (`valenced/chat-islands/src/main/kotlin/dev/thatkerimguy/chatislands/`): `MarkerHook` (Fresco: `AbstractDraweeControllerBuilder.build` + `DraweeView.setController`), `Hosts` (an `IslandHost` FrameLayout added next to the placeholder image in its parent, following its bounds), `SurfacePool` (React surfaces from `ReactHost.createSurface` via reflection, off-screen measuring), `Runtime` (bridge methods, events to JS).
- CI (`checks.yml`) passed: unit tests, Discord module checks, every Valenced plugin built + type-checked + pre-init-checked, Kotlin compiled with the template's Gradle build (`valenced-native` job).

## What happened on the device so far

1. Build 0.1.0.13: **enabling Chat Islands while Discord ran closed the app.** Cause (from reading Valenced's source, `bundle/lib/modules/src/native/index.ts`): a native → JS call to a JS method that isn't registered throws inside Valenced's JS bridge, and that crashes the app. The JS side skips a late start; the native side didn't, and sent its status event at once.
2. Build 0.1.0.14 fixes that (commit `77e3585`): native sends nothing until JS calls `thatkerimguy.chatIslands.listen`; both sides only `requireReload()` when turned on / off while Discord runs; native main-thread work and hook callbacks are guarded. **Tried on the device (local session): no more closing.**
3. With 0.1.0.14 both native parts failed on Discord 352.6: `Fresco's controller builder not found` and `React surfaces aren't available (Discord's ReactHost not found …)`. Discord's R8 renamed or inlined everything looked up by name. The APK from the phone was decompiled with jadx into `C:\Work\discord-352.6-jadx` (`src\sources` Java, `res-out` resources, `discord-352.6.apk`; outside the repo). Lookups rewritten by shape: `MarkerHook.kt` (from `SimpleDraweeView`), new `ReactSurfaces.kt` (from Discord's running root view; `FabricUIManager.startSurface`), surfaces looked up at `listen`. Details in plan section 4. **Works on the device since 0.1.0.15** (hooks installed, surfaces start and measure).
4. 0.1.0.15–0.1.0.22: placeholder fixes (marker in `image`, `srcIsAnimated`) and diagnostics; the placeholder is now drawn as an image embed, but no card appears yet. Each step is in the plan, section 12. For methods jadx can't decompile, the Vineflower output is in `C:\Work\discord-352.6-jadx\vf-out`. Diagnostics: `adb pull /sdcard/Android/data/app.valenced/files/chat-islands/` (newest `diag-*.log`).

Useful paths in the decompiled code (352.6 names): chat image views `com/discord/chat/presentation/message/view/MediaView.java`, Discord's image loading helper `v50/l.java` `o0(...)`, `ReactSurfaceImpl` = `um/a0.java`, `ReactSurfaceView` = `um/b0.java` (Discord's subclass `dg/b.java`), `ReactDelegate.loadApp` = `sf/b.java` `a(...)`, start lambda `um/r.java`. Phone APK: `adb shell pm path app.valenced` (an LSPatch build: Discord's original is `assets/lspatch/origin.apk` inside it).

## What to do now

1. `git pull` in the experimental folder. Check the phone has the experimental repo added in Valenced and **Chat Islands Experimental 0.1.0.14** installed (update it if 0.1.0.13 is still there).
2. With logcat running, enable it: Discord should ask for a restart and not close. Restart Discord.
3. Work through `TESTING.md` → "Chat Islands phase 0 (Android, by hand)", 11 steps. The key ones: logcat says `Hooked …build and …setController`; a message containing `[island test]` shows the test card; it scrolls in step with chat; the tile row swipes sideways; the counter survives scrolling away; light / dark theme recolours it.
4. Record the results and the answers to section 11's open questions in `SOCIAL_EMBEDS_PLAN.md` (section 12, Progress), commit, push to `main` of the experimental repo (that publishes the next build).

### adb (cmd or PowerShell)

```bash
adb devices
```

```bash
adb logcat -c
```

```bash
adb logcat -v time ValencedAndroid:V ReactNativeJS:V AndroidRuntime:E *:S
```

- Native logs use the tag `ValencedAndroid`, prefixed with the plugin id (`thatkerimguy.chat-islands-experimental - …`). JS logs (`logger` in the plugin) show under `ReactNativeJS`. Crashes: `AndroidRuntime` (`FATAL EXCEPTION`).
- Discord's package name: check with `adb shell pm list packages | findstr discord`.
- Screenshots for checking the card: `adb exec-out screencap -p > shot.png`.

## If phase 0 fails: where to look

| Symptom | Likely place | Notes |
|---|---|---|
| App closes on start or enable | `Runtime.kt`, `native.ts` | Any native → JS call before `listen`, or a JS method that throws, kills the app. |
| Status reason "chat's image views weren't found" | `MarkerHook.kt` | Discord's chat may not use Fresco's `DraweeView`, or R8 renamed it. Find the real image view: dump the view tree of a chat row with an image embed (`adb shell uiautomator dump`, or a temporary hook that logs view classes) and change the hook point. |
| "Unsupported row layout for islands: <class>" | `Hosts.kt` | The image's parent isn't a `FrameLayout`. Options in plan 4.2: wrap the placeholder, or host in the row root. |
| Broken image box, no card | `MarkerHook.kt` → `Hosts.onBound` | The placeholder is drawn but the hook didn't fire for it. Log `markerUrlOf` results. |
| Card cut off at the bottom | Discord clamps tall image embeds | Plan section 11: force the size from the host, or stack placeholders. |
| No card, no broken box | `discord.ts`, `runtime.ts` | Row patch not running (`status.ts` parts), `isAvailable()` false (native status reason), or the island never got ready (pipeline: measuring needs a working surface). |
| Blank card | `SurfacePool.kt`, `root.tsx` | Surface started but `ChatIsland` didn't render: check `AppRegistry` registration and the props (`islandKey`, `width`, `measuring`). |

## Building and checking locally

- JS: `bash .github/scripts/setup-valenced-template.sh template` (Git Bash / WSL), copy `valenced\chat-islands` into `template\plugins\`, then in `template`: `bun run build chat-islands`, `bunx tsc -b plugins/chat-islands/tsconfig.json`, `node ..\.github\scripts\preinit-check.cjs plugins\chat-islands\build\js\index.js`.
- Native: JDK 25 + Android SDK platform 36, then `gradlew packageChatIslands` in `template` (needs the Valenced API from GitHub Packages: `GitHubPackagesUsername` / `GitHubPackagesPassword` with `read:packages` in `%USERPROFILE%\.gradle\gradle.properties`, see the template README). Or let CI build it: push and read the `valenced-native` job.
- Sideloading a local build instead of publishing: the ZIP from `template\build\dist\` can be installed in Valenced from a file, if its UI allows; otherwise push to `main` and update from the repo.
- Tests: `cd tests`, `npm ci`, `npm test`, `npm run test:patches`.

## Rules that matter here (full list: plan section 10)

- Never change Discord's data; the placeholder lives only in the row data passed to the row generator (`display.ts`).
- Mobile JS: nothing from `react`, `react-native` or `@valenced/discord/*` at module level; classic JSX pragma on every `.tsx`; no `Animated.View`-style dotted React Native names; no React / RN imports as shorthand object keys.
- Native → JS only after `listen`; JS methods called from native never throw; native main-thread work goes through `Runtime.post` / `guarded`.
- Theme colours only (`Tokens`, `Design.createStyles`). The magenta debug border in `Hosts.kt` is a developer-only overlay.
- Bridge names use `thatkerimguy.chatIslands.*`, not the plugin id (the experimental build renames the id in JS only).
- The user wants: commands for Windows, plain wording, results recorded in the plan.

## After phase 0

Phase 1 (plan section 9): the library's v0.1 polish (snapshots on fast flings, gesture handling, settings page with status), then phase 2: the Social Embeds plugin itself (manifest depending on `thatkerimguy.chat-islands`, a provider using the shared core, the X card, viewer and sheet), designed after the canvas concept the user saw (`https://claude.ai/artifact/QgPtw7XJGeGogk23bT1NR2`).
