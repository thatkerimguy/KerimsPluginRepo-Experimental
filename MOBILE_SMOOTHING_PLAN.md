# Plan: a Valenced plugin that makes Discord Mobile navigation smoother

Working name: **Smoother** (not decided). A separate plugin from GIFs+, in `valenced/<name>/`, with its own manifest id.

Source read for this plan: `github.com/Wumpus-Central/discord-mobile-datamining`, build **356.2 (356202)**, commit from 2026-11-18. Paths below are relative to its `discord_app/` folder. The code is decompiled Hermes bytecode: names are often garbled (`closure_0`, swapped variables), so every finding below needs checking on a device before it ships. Valenced APIs come from `valenced-types` at the pinned `TYPES_REF` in `.github/scripts/setup-valenced-template.sh`.

## 1. What a JS plugin can and cannot change

| Layer | What it is | Can the plugin change it? |
|---|---|---|
| Chat message list | Native view (`modules/chat/native/Chat.android.tsx`, `NativeChatUtils.tsx`); JS only sends row data | Scroll smoothness: no. What goes into rows: yes, but that's out of scope |
| Panel and drawer gestures | Reanimated worklets compiled into the bundle (`useMainTabsPanelsGesture.tsx` holds them as code strings) | Worklet code: no. The config objects they read when they're created: yes |
| Navigation, lists, preloading, stores | Plain JS React components and Flux stores | Yes: `instead` / `before` / `after` on module exports found with `getModuleWithImportedPath`, and Flux events via `onFluxEventDispatched` and `Dispatcher` (`@valenced/discord/common/flux`) |
| Discord's experiments (Apex) | `modules/experiments/apex/*`, `discord_common/js/packages/apex/BaseApexExperimentStore.tsx` | Yes: the store handles `APEX_EXPERIMENT_OVERRIDE_CREATE` and `APEX_EXPERIMENT_SESSION_OVERRIDE_CREATE` (`ApexExperimentStore.tsx:35-49`) |

The plugin itself runs on the JS thread too, so every patch must cost almost nothing. No per-render store reads, no timers per row.

## 2. What I found (bottlenecks and quirks)

### F1. Some channel rows don't start loading messages until you lift your finger
- Guild text channel rows call `ChannelActionCreators.preload` on **press-in** (`modules/channel_list_v2/native/items/TextChannel.tsx:140-143, 225`), and so do DM rows in the Messages tab (`modules/main_tabs_v2/native/tabs/messages/items/channel/MessagesItemChannelBase.tsx:193-210`). `preload` dispatches `CHANNEL_PRELOAD`, which `MessageManager` turns into a message fetch (`modules/messages/MessageManager.tsx:392-406`).
- **Thread rows** (`channel_list_v2/native/items/ThreadChannel.tsx:152`), **DM rows in the channel list** (`items/DMChannel.tsx:66, 96`) and **home drawer rows** (`modules/home_drawer/native/*`) only have `onPress`. The fetch starts at `CHANNEL_SELECT` (`MessageManager.tsx:338`), roughly 100–200 ms later than it could (the length of a tap), so the chat placeholder (`modules/chat/native/placeholder/ChatPlaceholder.tsx`) stays up longer.

### F2. The first switch between the DM list and a server's channel list renders from nothing
- `components_native/MainChannels.tsx:72-78` puts the Messages list and the channel list in `NativeFreezeScreens` with only `activeIndex`. `NativeFreezeScreens` defaults to `lazy: true`, `freezeOnBlur: true` and `preloadIndices: []` (`modules/freeze/native/NativeFreezeScreens.tsx:14-35`). A screen that hasn't been shown yet renders nothing (lines 70-80), so the first switch mounts the whole list at that moment.
- `preloadIndices` already exists for this. Passing `[0, 1]` once the app is idle renders the other list ahead of time, frozen.

### F3. Pop-up sheets over the main view
- `modules/upsell_tooltip/native/useMainViewTooltipActionSheetEligibilityMap.tsx` decides which bottom sheets may open over the main view (Nitro trials, discount offers, referral reminders, Google Play price changes, …). Discord has a kill switch for all of them: experiment `2026-01-mobile-action-sheet-killswitch`, variant 1 = `{ disabled: true }` (`modules/upsell_tooltip/experiments/MainViewTooltipActionSheetsDisabledExperiment.tsx`).
- Note: that switch also hides the Google Play **price change** notice, which is a billing notice, not an ad. The user decides whether it's included.

### F4. Discord's own fixes sit behind experiments that are off by default
All `kind: "user"`, default off unless noted:

| Experiment | What it does | Read where | Verdict |
|---|---|---|---|
| `2026-10-media-viewer-entrance-jank` | A fix for jank when the media viewer opens (`useIsMediaViewerEntranceJankFixEnabled`) | `media_viewer/native/components/MediaViewer.tsx:51`, `MediaViewerItemPresenter.tsx` | Good candidate |
| `2026-10-media-viewer-video-perf-android` | Video performance in the media viewer (Android) | `renderers/MediaModalVideo.tsx` | Good candidate |
| `2026-04-hide-covered-channels` | Hides channel screens that another screen covers | `main_tabs_v2/native/panels/MainTabsChannelScreenStack.tsx:137` | Candidate, test carefully |
| `2025-08-animated-keyboard-android` | Keyboard that animates with the chat input on Android | `keyboard/native/AnimatedKeyboardExperiment.tsx` (read **once when the module loads**), `chat/native/ChatViewWrapper.tsx` | Candidate. Takes effect on the next launch only (see §4) |
| `2026-10-channel-list-impl-v2` | Channel list: `fast` (default) or `legend` list, `drawDistance` `viewport`/`default`/`small` | `channel_list_v2/native/RedesignChannelList.tsx` | Experimental. Measure first |
| `2026-06-messages-list-impl` / `2026-10-android-messages-list-impl` | DM list: `fastest` (default), `flash` or `legend` (± `recycleItems`) | `main_tabs_v2/native/tabs/messages/Messages.tsx` | Experimental. Measure first |
| `2026-10-users-list-impl` | Member/user lists: `fast` or `legend` | `shared_components/user_list/*` | Experimental |
| `2026-10-guilds-render-experiment` | **Holds back the Servers tab** until the gateway connects or 4 s pass (`tabs/guilds/Guilds.tsx:60-95`) | `Guilds.tsx`, `RedesignChannelList.tsx` | **Avoid**: makes cold start feel slower |
| `2025-12-shadow-node-spike` | Unknown memory change, applied in `components_native/App.tsx` | | Avoid until understood |

The variant numbers in the decompiled code are partly garbled (`obj3[3] = …` overwrites). Variant ids and labels must come from the live experiment metadata (`ApexExperimentStore.getExperimentsMetadata()`, filled by `APEX_EXPERIMENTS_METADATA_FETCH_SUCCESS`), not from this table.

### F5. Panel slide timings are plain JS objects
- `modules/panels/native/PanelsConfig.tsx` exports `DEFAULT_PANELS_ANIMATION_CONFIG` (iOS: springs for swipes, 250 / 200 ms timing for taps) and `ANDROID_PANELS_ANIMATION_CONFIG` (250 / 200 ms timing for everything), plus `touchSlopForPanGesture: 8` and `minFlingVelocityX: 240`.
- The panel gesture worklet copies `panelsConfig` from its closure when it's created (`useMainTabsPanelsGesture.tsx:30, 51`). Changing these objects before the panels first render makes channel open/close slides faster without touching worklet code. Changes after that only apply once the hook makes new worklets.
- The animations already pass `'respect-motion-settings'`, so the system's Reduce motion setting turns them off entirely. The plugin should offer something in between.

### F6. Haptics everywhere, no off switch
- 92 files call `modules/haptics/HapticUtils.native.tsx`. I found no app setting that turns haptics off. One patch on that module's exports would cover all of them.

### F7. Things that look like delays but aren't worth touching
- `modules/routing/RouteManager.tsx:56-63`: a 200 ms debounce, but only for hardware-keyboard routing.
- `modules/app_startup/awaitExperiments.tsx`: a 1 s cap on waiting for experiments. Nothing in this build awaits its promise.
- `MainTabsChannelScreenStack.tsx:624-628`: a 10 ms timer that bumps a freeze counter. Too small to matter.

## 3. Features, in order

Every feature is its own setting, so a bad one can be turned off without losing the rest. All of them are off when the plugin is off.

### Phase 0: groundwork and measurement (first)
1. **Plugin skeleton**: `valenced/<name>/` following the GIFs+ layout (manifest, `js/index.tsx`, `patches.tsx`, `settingsStore.ts`, `settings.tsx`). Reuse `async.ts` (`Limiter`), `persist.ts` and `diagnostics.ts` (Patches row) from GIFs+. `sync-shared.mjs` handles one pair of folders today: extend it with a second target list, or copy the files once and sync them by hand.
2. **Measurements in settings** ("Performance"), so changes can be judged by numbers and not by feel:
   - Channel open time: from `CHANNEL_SELECT` (or the press-in) to `LOAD_MESSAGES_SUCCESS` for that channel, or 0 when the messages were already cached. Median and p90 over the session.
   - Android frame stats: `NativeJankStatsModule.requestReport()` gives total and janky frame counts (`modules/jank_stats/native/JankStatsManager.android.tsx:66-85`). **Check first** whether reading it resets Discord's counters. If it does, only read it from a button.
   - A "which features are on" line, so measurements can be compared.
3. **Patch diagnostics** like GIFs+: `expectPatch` per feature, shown under "Patches".

### Phase 1: low risk, clear win
4. **Load on touch** (F1): wrap `onPressIn` on thread rows, channel-list DM rows and home drawer rows so they call `ChannelActionCreators.preload(guildId, channelId)`. Patch the row components' `default` (`instead`, call the original, add `onPressIn` to the pressable's props in the returned tree, like GIFs+ swaps the `Image`). Check: one fetch per tap, none on scroll (press-in also fires when a scroll starts on a row, which Discord already accepts for text channels).
5. **Warm the other list** (F2): `instead` on `NativeFreezeScreens` in `modules/freeze/native/NativeFreezeScreens.tsx`. Only for the `MainChannels` call (two children, the container's `nativeID`): pass `preloadIndices: [0, 1]` once the first `CONNECTION_OPEN` has passed and the app has been idle for about 2 s. Check: memory after start, and that the first switch is instant.
6. **No pop-up sheets** (F3): session override of `2026-01-mobile-action-sheet-killswitch` to its "disabled" variant. Setting text says it also hides the Google Play price change notice (or that one is kept: ask the user).
7. **Media viewer fixes** (F4): overrides for `2026-10-media-viewer-entrance-jank` and, on Android, `2026-10-media-viewer-video-perf-android`.
8. **Haptics off** (F6, off by default): `instead` on the `HapticUtils.native.tsx` exports that trigger feedback, returning nothing.

### Phase 2: tuning (medium risk)
9. **Panel speed** (F5): Default / Fast / Instant. Fast = durations × 0.6 and spring stiffness × 1.5; Instant = 0 ms timing. Written into the `PanelsConfig` objects as early as possible. The module can't be required at pre-init (rule below), so use `getModuleWithImportedPath`'s callback, which runs when the module first loads. Check on iOS (springs) and Android (timing), and with Reduce motion on.
10. **Warm likely channels** (off by default): after `CONNECTION_OPEN`, preload the last few channels from the navigation history (`main_tabs_v2/native/NavigationHistoryStore.tsx`) and the unread DMs at the top of the list. At most 5, 2 at a time, 300 ms apart (the GIFs+ `Limiter`), and none while the app is in the background. **Check first** that a message fetch never marks a channel as read (acks are separate in `MessageManager`, but this needs confirming) and how many requests it adds.
11. **Android animated keyboard** (F4): a persistent override (it's read when the module loads, see §4). The setting says "applies after restarting Discord".
12. **Hide covered channels** (F4): override, measured with the Phase 0 numbers.

### Phase 3: Discord's list experiments (opt-in, experimental)
13. A "Discord experiments" section that lists the list-implementation experiments (F4) with their **live** variant labels from the metadata. Off unless the user picks one. Each choice is compared with the Phase 0 numbers, and the best ones become the plugin's presets. The avoided experiments are not offered.

### Out of scope
- Scrolling inside a chat (native list) and the gesture worklets themselves.
- Anything that changes messages, read states or what's sent (same rule as GIFs+: change what's shown, never the data).

## 4. How experiment overrides must work

From `discord_common/js/packages/apex/BaseApexExperimentStore.tsx`:
- **Client overrides** (`createOverride`, line 328) are stored with the rest of the store's state (`getState`, line 176) and survive restarts. If the plugin is uninstalled without `stop` running, they stay. **Session overrides** (`createSessionOverride`, line 351) live in memory only.
- Session overrides are **cleared** whenever new user assignments arrive (`setExperimentAssignments`, lines 190-204, on connect) and on logout (`handleLogout`, line 416).
- Some experiments are read once when their module loads (`AnimatedKeyboardExperiment.tsx`: `getConfig` at module level). A session override set after that does nothing until the next launch.

So:
- Use **session overrides** by default, applied after settings have loaded (`whenSettingsLoaded()`, as GIFs+ does) and again after each `CONNECTION_OPEN` and `APEX_EXPERIMENTS_FETCH_SUCCESS` (flux patch that returns the payload, then dispatches the override).
- Use **client overrides** only for experiments read at module load. Keep a list of the ones the plugin set in its own storage. Remove them in `stop`, and remove leftovers on start when their setting is off. Never remove an override the plugin didn't set (the user may have set it in Discord's dev tools).
- Read the variant id from the metadata by label/config, and skip the override (with a line under "Patches") when the experiment or variant is gone.
- **Check first**: that an override is honoured for a normal account, outside the experiment's rollout. Nothing in the code I read checks for staff, but the evaluation path (`getConfigEvaluationAndAssignment`) wasn't fully readable.

## 5. Rules carried over from GIFs+ (CLAUDE.md)

- Nothing from `@valenced/discord/*`, `react` or `react-native` at module level. Valenced runs the script at pre-init.
- No `Animated.View`-style names and no React imports as shorthand object keys (the build rewrites them).
- The flux patch must return the payload.
- Settings load in the background: anything that must not use the default first waits for `settingsLoaded()`.
- Turning the plugin on or off asks for a reload (`requireReload()`). Patching screens that are already mounted only half works.
- No hardcoded colours in the settings page (`Tokens`).
- CI: add the new plugin to the Valenced build, type check and pre-init check in `checks.yml`, and to `valenced-repo.yml` (experimental id handling as for GIFs+).

## 6. Testing

- Unit tests (Node, `tests/`): the override list and its cleanup, variant lookup from metadata, the `preloadIndices` patch only touching the `MainChannels` call, panel config scaling.
- Device smoke list (to add to TESTING.md), each with the plugin on and off: cold start to the first channel; open 10 channels from the channel list, threads, DMs and the home drawer (channel open times); first switch between DMs and a server; media viewer open/close; keyboard open in chat (Android); swipe between panels; reinstall and check that no override was left behind.

## 7. Questions for you

1. Which quirks bother you most day to day? I can only read the code, not feel the app, so this decides what goes first.
2. Which phone(s): Android, iOS or both? Several features are Android-only (frame stats, video perf, animated keyboard).
3. Should "No pop-up sheets" also hide the Google Play price change notice?
4. Is the extra data from "Warm likely channels" acceptable, and should it only run on Wi-Fi?
5. A name for the plugin.
