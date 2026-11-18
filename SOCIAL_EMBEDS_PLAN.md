# Social Embeds + Chat Islands: project plan

Status: planning done 2026-11-18, development started. This file is the guide for the project; update it when a decision changes (the decisions log at the end says why things are the way they are).

## 1. Goal

Links to X (Twitter), Reddit, TikTok and Instagram in Discord chat become widgets that look and navigate like the apps: every photo of a post (X and Reddit allow 20 per post, TikTok photo posts 35), inline video, quoted posts, replies and comment trees, with smooth animations, and fast enough that chat scrolls as smoothly as without them.

### Scope

| In | Out |
|---|---|
| **Android (Valenced)**, platform #1 | iOS (no release-build native plugins in Valenced yet, and not wanted now) |
| **Desktop (Vencord)**, platform #2, Discord desktop + Vesktop | Vencord web (no `native.ts`, so no data fetching past CORS) |
| Reading posts: media, text, quotes, polls, replies, comments | Account connections (like, bookmark, reply, vote): dropped |
| A reusable library for React views inside mobile chat | A second "native card" fallback built from Discord's card components: dropped. If an island can't be shown, Discord's own embed stays |

## 2. The two products

1. **Chat Islands** (`valenced/chat-islands/`, id `thatkerimguy.chat-islands`): a Valenced **API plugin** (JS + native Android) that lets any plugin render a React Native component ("island") inside a Discord mobile chat message. Other plugin developers depend on it through their manifest. This is what makes app-like widgets possible on mobile at all: Discord's mobile chat is drawn by native code from row data (`DCDChatList`), not React.
2. **Social Embeds** (`valenced/social-embeds/` + `vencord/socialEmbeds/`, id `thatkerimguy.social-embeds`, Vencord name `SocialEmbeds`): the widgets. On mobile it registers islands with Chat Islands; on desktop it renders React DOM widgets in place of Discord's embeds.

Both are separate from GIFs+: no imports between them. Code taken from GIFs+ (`Limiter`, `LruCache`, `Persisted`, `lazy.ts`, `tree.ts`, `alerts.tsx`) is copied, not shared.

## 3. Facts this plan rests on (checked in source, 2026-11-18)

Discord mobile (github.com/Wumpus-Central/discord-mobile-datamining):
- React Native **0.86**, Fabric (`_runtime/00482_ReactNativeVersion.js`, `_runtime/02014_IS_FABRIC.js`).
- Chat is native: `DCDChatList` / `DCDChat` (`discord_common/js/packages/rtn-codegen/js/ChatListNativeComponent.tsx`, `ChatNativeComponent.tsx`). JS builds row data: `modules/messages/native/renderer/RowGenerator.tsx` → `MessageWithContent.generateMessageRowData` → `createMessageContent.tsx` (default export) fills `embeds` (`transformEmbeds.tsx`), `components` (`transformMessageComponents(options, components)`, default export), `codedLinks`.
- The native renderer draws card components: `CONTAINER`, `SECTION`, `TEXT_DISPLAY`, `THUMBNAIL`, `MEDIA_GALLERY` (image and video items, `transformUnfurledMediaItem` needs `width`, `height`, `contentType`, `proxyUrl`), `SEPARATOR`, `ACTION_ROW`, `BUTTON`.
- Taps come back to JS through `MessagesRenderer.tsx` (`onTapImage` with `type: "component"`, `onTapLink`, `onTapButtonActionComponent`, …); long press: `long_press/showLongPressMessageActionSheet.tsx`.
- Re-rendering one message: `updateRows({ updateMessageIds })` (`hooks/useRowManager.tsx`, `MessagesUtils.syncMessageDisplay`).
- Which messages are on screen: `VisibleMessagesWindowHandler.tsx`.
- Available in the app: Reanimated (`_runtime/01666_ReanimatedModule.js` and friends), the media viewer (`modules/media_viewer/native/components/openMediaModal.tsx`), a native video view (`rtn-codegen/MediaPlaybackViewNativeComponent.tsx`, `modules/media_playback/native/Video.tsx`), gorhom bottom sheets (`@valenced/externals/gorhom`), FlashList (`@valenced/externals/shopify`), WebView (`modules/embedded_apps/native`).

Valenced (github.com/Valenced/valenced, template github.com/Valenced/valenced-plugin-template at the pinned commit):
- A plugin can have JS (`dist.script`) and native Kotlin (`dist.android: { path: "plugin.jar", class }`), loaded with `DexClassLoader` before the JS bundle (`android/.../plugins/external/NativeBuilder.kt`). A plugin is native when it has `src/main`; `./gradlew packageAllPlugins` builds it (needs JDK 25, Android SDK platform 36, and `app.valenced:api` from GitHub Packages or `publishToMavenLocal`).
- Native API (`android/api`): `plugin { start { } stop { } }`, `PluginScope` (`log`, `pluginDir`, `storageDir`, `requireReload`, `errors`), `HostScope` (`classLoader`, `bridge`, `dexFinder` (DexKit, for obfuscated classes), `withAppContext`, `withAppActivity`), Xposed API compile-only (`XposedHelpers`, `XposedBridge.hookMethod`), `registerNativeMethod(name) { args -> }`.
- Bridge: `bridge.registerMethod` / `registerAsyncMethod` (JS → native), `bridge.callJSMethod` (native → JS); JS side `callNativeMethod` / `callNativeMethodSync` / `registerJSMethod` (`@valenced/modules/native`).
- Libraries: a dependency is started before its dependents; native dependents can use its classes; an `"api": true` plugin adds functions to its dependents' plugin API with `decorate(...)` in `init`.
- iOS native plugins only load in Valenced developer builds (`ios/Sources/Plugins/PluginLoader.mm`, `#ifdef DEBUG`). Out of scope anyway.

Vencord: `VencordNative.csp.requestAddOverride(url, directives, callerName)` (asks the user to allow a host), plugin `native.ts` (main-process code, e.g. `fixYoutubeEmbeds.desktop`), `renderEmbeds(` in the message accessories (find `"}renderStickersAccessories("`, as `fakeNitro` does), `addMessageAccessory`.

## 4. Chat Islands design

### 4.1 How an island gets into a native chat row

```
JS  MessageWithContent.generateMessageRowData({ message, … })   (our before-patch)
       │  for each ready island: the message is passed as a display view
       │  (Object.create(message) with its own `embeds`): the embed the island
       │  replaces becomes an image embed whose image URL is a marker
       │  https://chat-islands.invalid/i/<islandKey>?w=<dp>&h=<dp>
       ▼
NATIVE DCDChatList lays the row out; Fresco gets the marker as an image request
       │  (Xposed: AbstractDraweeControllerBuilder.build remembers marker controllers,
       │  DraweeView.setController tells which view shows which island)
       ▼
NATIVE IslandHost (FrameLayout) is added next to that image view, in the same parent,
       │  kept on its exact bounds, with a React surface from the pool
       │  (module "ChatIsland", props { islandKey, width, measuring })
       ▼
JS  <IslandRoot islandKey> (js/root.tsx) renders the registered component for that key
```

- The placeholder is row data only: message objects, embeds and stores are never changed. An image embed was chosen over a `MEDIA_GALLERY` component: it sits exactly where the link's embed was, has no card frame, and doesn't need the message to be a components message.
- Marker URLs use the reserved `.invalid` TLD so nothing is ever downloaded, even if the hook misses (then the user sees an empty media box: the failure detection below turns islands off in that case).
- `islandKey` = `<providerId>:<messageId>:<slotIndex>`. The JS side keeps `islandKey → { provider, message, slot, height }`.

### 4.2 Native side (Kotlin)

- **Finding the hook point** (`MarkerHook.kt`): Discord's chat (`MediaView`, a `FrameLayout`) loads its `SimpleDraweeView` with `getControllerBuilder()`, sets the request field, `build()`, `setController` (checked in the decompiled 352.6 APK). R8 renames the rest of Fresco (352.6: `DraweeView` = `pj.a`, builder = `ij.f` with `AbstractDraweeControllerBuilder` merged in, no `getImageRequest()` / `getSourceUri()`), so everything is found from `SimpleDraweeView` (name kept: layouts use it) by shape: the superclass with `setController`, `getControllerBuilder()`'s return type, the no-arg method returning the controller type, the builder fields holding a class with a `Uri` field.
- **IslandHost** (`Hosts.kt`): a `FrameLayout` added next to the placeholder in the same parent, following the placeholder's bounds (layout change listener), so it scrolls with the row in the same frame and the chat list's own touch handling keeps working. Needs a parent that stacks children (`FrameLayout`); any other parent is reported in the status ("send this to the developer") and decides the next strategy. The size comes from the placeholder, which Discord sizes from the marker's width and height; whether Discord clamps tall images is a phase 0 question.
- **SurfacePool** (`SurfacePool.kt`, `ReactSurfaces.kt`): React surfaces in Discord's bridgeless React Native, reached through reflection. R8 removed the public API (352.6: no `getReactHost()`, no `createSurface`, `ReactSurfaceImpl.attach / start / getView / updateInitProps` inlined into `ReactDelegate.loadApp`), so `ReactSurfaces` does what loadApp does, found from Discord's running root view: the surface class (holds a `SurfaceHandlerBinding`) and its `(Context, String, Bundle)` constructor, the root view class's `(Context, surface)` constructor, the surface's view / host `AtomicReference`s; then `FabricUIManager.startSurface(binding, context, view)`. JNI-facing names survive R8: `SurfaceHandlerBinding.setProps` (pointing a surface at the next island), `FabricUIManager.startSurface / stopSurface`, `ReactContext.getFabricUIManager`, `Arguments.fromBundle`. Looked up when JS calls `listen` (the root view doesn't exist when the activity is created). Up to 10 surfaces.
- **Snapshots**: when a surface leaves a host, its last frame is kept as a bitmap (LRU, ~24 MB budget). A host with no live surface yet shows the snapshot, so fast flings never show blank boxes.
- **Gestures**: each island root is a gesture-handler root; when a horizontal pan starts inside an island, the host calls `requestDisallowInterceptTouchEvent(true)` on the chat list so carousels swipe without scrolling chat. A long press with no island handler is forwarded to Discord's message long press.
- **Visibility**: the host reports attach / detach / on-screen fraction to JS (batched per frame) for `useIslandVisible` (video play / pause, prefetch).
- **Debug overlay** (setting, off by default): outlines islands, shows pool use, attach time and dropped frames.

### 4.3 JS side

- `register(provider)` → returns an unregister function. Provider:

```ts
interface IslandProvider<Slot> {
  id: string;                                  // unique per plugin, e.g. "social-embeds"
  match(message: Message): Slot[] | null;      // which islands this message gets (fast, sync, no I/O)
  replacesEmbed?(slot: Slot): number | null;   // index of the Discord embed this island replaces
  prepare?(slot: Slot): Promise<void>;         // load data before the island is shown (fetch, cache)
  component: ComponentType<IslandProps<Slot>>; // the React Native component
  estimateHeight?(slot: Slot, width: number): number | null; // optional fast path before measuring
}
interface IslandProps<Slot> { slot: Slot; message: Message; width: number; islandKey: string }
```

- **Sizing**: before a slot gets a placeholder, the library renders its component in an off-screen measuring surface at the chat width and reads its height (`onLayout`), caching it by `islandKey` + width + theme. Slots are prepared and measured ahead for messages near the screen (`VisibleMessagesWindowHandler` window ± a screen). Until a slot is ready its message keeps Discord's own embed; once ready, `updateRows({ updateMessageIds: [id] })` swaps it in once. `resize(islandKey)` re-measures after content changes (expanding comments) and updates that row.
- **Hooks for island components**: `useIslandVisible()`, `useIslandState(key, initial)` (state that survives surface reuse, kept per `islandKey`), `useIslandWidth()`, `useResize()`, `openMessageMenu(message)`.
- **Availability**: `isAvailable()` is false until native reports a working hook. If the native part is missing, a hook point isn't found, or a marker placeholder isn't claimed by native within 2 s of being shown, islands turn off for the session and every message keeps Discord's embed. Settings show why ("Patches"-style status, like GIFs+).
- **Library API** for dependents comes through `decorate`: `init({ chatIslands }) { chatIslands.register(...) }`. Versioned with the manifest version (semver; breaking changes bump the major).

### 4.4 Performance budgets (checked with Perfetto on a mid-range phone)

- Scrolling a channel with 10+ islands: no more dropped frames than the same channel with Discord's embeds.
- Attaching a pooled surface to a host: < 4 ms on the UI thread.
- Island component render: < 4 ms JS for a prop change; animations run as Reanimated worklets on the UI thread.
- Memory: pool + snapshots < 60 MB.

## 5. Social Embeds design

### 5.1 Shared core (`valenced/social-embeds/js/core/`, plain TypeScript, no React, no platform imports)

- `detect.ts`: link rules → `{ platform, id, url }` for:
  - X: `x.com`, `twitter.com`, `mobile.twitter.com`, `fxtwitter.com`, `fixupx.com`, `vxtwitter.com`, `fixvx.com`, `/status/<id>`
  - Reddit: `reddit.com`, `old.`/`new.`/`np.`, `redd.it/<id>`, `/r/<sub>/comments/<id>`, `/comments/<id>`, `/r/<sub>/s/<code>` (share link: resolved by following the redirect), `rxddit.com`, `vxreddit.com`
  - TikTok: `tiktok.com/@user/video/<id>`, `/photo/<id>`, `vm.tiktok.com/<code>` and `tiktok.com/t/<code>` (resolved), `vxtiktok.com`, `tnktok.com`
  - Instagram: `instagram.com/p/<code>`, `/reel/<code>`, `/reels/<code>`, `/tv/<code>`, `ddinstagram.com`, `kkinstagram.com`
  - Links inside `<…>` (suppressed embeds) are skipped; links in spoilers are marked spoiler.
- `model.ts`: the normalized `Post` (author, text with entities, media list with all variants and sizes, quote, poll, stats, createdAt, platform-specific extras) and `Comment` / `Reply` trees.
- `resolvers/x.ts`, `reddit.ts`, `tiktok.ts`, `instagram.ts`: fetch + parse into the model. Each takes a `Fetcher` (`(url, init) => Promise<{status, json(), text(), url}>`) so mobile passes React Native `fetch` and desktop passes the `native.ts` bridge.

| Platform | Primary source | Fallback |
|---|---|---|
| X | `api.fxtwitter.com/status/<id>` | `cdn.syndication.twimg.com/tweet-result?id=<id>&token=<computed>` |
| Reddit | `www.reddit.com/comments/<id>.json?raw_json=1` (post + comment tree, `media_metadata` galleries, `secure_media.reddit_video`) | `old.reddit.com` same path |
| TikTok | `www.tiktok.com/oembed?url=` (metadata) + `tnktok.com` / `vxtiktok.com` page metadata (mp4, photo list) | official player page |
| Instagram | `www.instagram.com/p/<code>/embed/captioned/` (HTML: caption, carousel, video) | `kkinstagram.com` / `ddinstagram.com` metadata |

- `fetcher.ts`: per-host `Limiter` (2 at a time per host), de-duplication of in-flight requests, retries with backoff on 429 / 5xx, `Retry-After` respected.
- `cache.ts` + `persist.ts`: LRU in memory (500 posts) and persisted (mobile `json-storage`, desktop `DataStore`), TTL 10 min for stats, 7 days for media lists; stale-while-revalidate (show cached, refresh in the background).
- `media.ts`: picks the smallest variant that covers the displayed size × pixel ratio (thumbnails), full size only in the viewer.
- `layout.ts`: media grid layouts (1, 2, 3, 4 items like the apps; 5+ as a carousel), aspect-ratio clamping, height estimates.
- `text.ts`: entities (mentions, hashtags, links, cashtags, Reddit markdown) → a small rich-text tree both UIs render.
- `kill.ts`: per-platform kill switch (setting + automatic: 5 consecutive parse failures turn a resolver off for the session and say so in settings).

### 5.2 Mobile UI (`valenced/social-embeds/js/mobile/`)

- `cards/XCard.tsx`, `RedditCard.tsx`, `TikTokCard.tsx`, `InstagramCard.tsx`: the islands. Header (avatar, name, handle, time, platform mark), rich text, media, quote, poll, stats, actions ("Replies" / "Comments", "Open in app").
- `ui/`: `Carousel.tsx` (Reanimated + gesture handler: momentum, rubber-banding, page dots, counter), `MediaGrid.tsx`, `VideoTile.tsx` (Discord's native video view; plays only when visible, one at a time, muted autoplay setting), `Avatar.tsx`, `RichText.tsx`, `Stats.tsx`, `Skeleton.tsx`, `PlatformMark.tsx` (drawn with text color, no logos images).
- `sheet/`: `PostSheet.tsx` (gorhom bottom sheet, 60% / full), `Stack.tsx` (tiny stack navigator with Reanimated slide transitions and edge swipe back), screens `PostScreen`, `RepliesScreen`, `CommentsScreen` (Reddit tree with collapse, FlashList), `QuoteScreen`.
- `viewer.ts`: opens Discord's `openMediaModal` with every photo / video of the post.
- `provider.ts`: the Chat Islands provider (`match` uses `detect`, `prepare` resolves the post, `component` picks the card).
- Theme: `Tokens` / `Design` only, read at render time. No colour constants anywhere.

### 5.3 Desktop UI (`vencord/socialEmbeds/`)

- `patches.ts`: `renderEmbeds(` patch: for a matched embed, render `$self.renderWidget(embed, message)` instead (ErrorBoundary falls back to Discord's embed). `addMessageAccessory` for links that got no embed.
- `native.ts`: `fetchJson` / `fetchText` / `resolveRedirect` (main process, no CORS).
- `csp.ts`: asks once per media host (`pbs.twimg.com`, `video.twimg.com`, `i.redd.it`, `preview.redd.it`, `v.redd.it`, `external-preview.redd.it`, TikTok and Instagram CDNs) with `requestAddOverride`, explains why in settings.
- `components/`: the same cards as mobile, React DOM, CSS with Discord variables only. Carousel with scroll-snap + buttons; replies / comments slide in inside the widget (stack with back arrow); lightbox with FLIP open animation.
- `core/`: copy of the shared core (see 6.2).

### 5.4 Settings (both builds, wording in `core/settingsText.ts`)

Per platform on/off, autoplay videos (on / Wi-Fi only / off; mobile), data saver (smaller media), show stats, show replies button, max inline height (mobile), reduce motion (follows the system setting by default), status ("Patches" + resolver health), cache size + clear.

## 6. Code structure

```
SOCIAL_EMBEDS_PLAN.md                 this file
valenced/
  chat-islands/
    manifest.json                     "api": true, dist.script + dist.android
    tsconfig.json
    build.gradle.kts                  only if the template needs per-plugin settings
    js/
      index.ts                        plugin({ init: decorate, start, stop })
      api.ts                          public types (IslandProvider, IslandProps, ChatIslandsApi)
      registry.ts                     providers, matched slots per message (memoized), islandKey
      store.ts                        per-island phase, size, session state, visibility
      pipeline.ts                     prepare → measure → ready → one row refresh per frame
      display.ts                      the message as the row generator sees it (placeholders)
      marker.ts                       marker URL encode / decode, placeholder embed
      measure.ts                      measuring through native, height reports from the root
      root.tsx                        AppRegistry "ChatIsland" root component, error boundary
      native.ts                       bridge (status, measure, events); namespace thatkerimguy.chatIslands
      discord.ts                      Discord modules: row data, row manager (updateRows), long press
      runtime.ts                      the running library, availability, hooks, per-dependent API
      status.ts                       which parts work (settings / bug reports)
      settings.tsx                    (phase 1) status, debug overlay toggle
      lazy.ts, jsx.d.ts               helpers (copied from GIFs+)
    src/main/kotlin/dev/thatkerimguy/chatislands/
      ChatIslands.kt                  entry: plugin { start { Runtime.start(this) } }
      Runtime.kt                      state, status, bridge methods, events to JS (batched per frame)
      Marker.kt                       marker URL format (same as js/marker.ts)
      MarkerHook.kt                   Fresco hooks: which view shows a marker
      ReactSurfaces.kt                start / props / stop for React surfaces, found by shape
      Hosts.kt                        IslandHost next to each placeholder, following its bounds
      SurfacePool.kt                  React surfaces (ReactHost, reflection), reuse, off-screen measuring
      Snapshots.kt                    (phase 1) bitmap LRU
    README.md                         library docs for other developers
  social-embeds/
    manifest.json                     depends on thatkerimguy.chat-islands
    tsconfig.json
    js/
      index.tsx                       plugin({ start: register provider })
      core/                           shared core (source of truth, section 5.1)
        detect.ts model.ts fetcher.ts cache.ts persist.ts media.ts layout.ts text.ts kill.ts settingsText.ts
        resolvers/ x.ts reddit.ts tiktok.ts instagram.ts
      mobile/                         section 5.2
        provider.ts viewer.ts settings.tsx
        cards/ ui/ sheet/
  gif-picker-optimizer/               (unchanged)
vencord/
  socialEmbeds/                       section 5.3 (copied into Vencord's src/userplugins as socialEmbeds)
    index.tsx patches.ts native.ts csp.ts settings.tsx
    core/                             synced copy of valenced/social-embeds/js/core
    components/
  gifPickerOptimizer/                 (unchanged)
tests/
  unit/social/                        core tests (detect, resolvers with recorded fixtures, cache, layout, text)
  unit/islands/                       registry, marker, rows patch on a fake row
  fixtures/social/                    recorded API responses (one per case: 1 / 4 / 20 photos, video, quote, poll, gallery, comment tree, TikTok video / photo, Instagram carousel / reel)
  patches/                            + mobile module paths and exports used by both plugins exist in discord-mobile-datamining
.github/
  scripts/sync-social-core.mjs        copies js/core → vencord/socialEmbeds/core (--check in CI)
  scripts/setup-valenced-template.sh  + Android: builds app.valenced:api from the pinned valenced commit into mavenLocal
  workflows/checks.yml                + social core sync, new tests, both new Valenced plugins build (JS + Gradle), Vencord type check of socialEmbeds
  workflows/valenced-repo.yml         + plugin.jar in the zip for native plugins, experimental id rewrite also for dependency keys
```

### 6.1 Naming

- Kotlin package `dev.thatkerimguy.chatislands`. React surface module name `ChatIsland`. Bridge method names `thatkerimguy.chatIslands.<method>` (deliberately not the plugin id: the experimental build renames the id in JS, and the Kotlin side would no longer match).
- JS storage paths use the plugin id constant (`PLUGIN_ID`) so the experimental build's id rewrite works (same as GIFs+).

### 6.2 Shared core sync

`valenced/social-embeds/js/core/` is the source of truth (mobile is platform #1). `node .github/scripts/sync-social-core.mjs` copies it to `vencord/socialEmbeds/core/`; CI runs it with `--check`. This is separate from GIFs+'s `sync-shared.mjs`.

## 7. Toolchain

- **JS**: TypeScript, the pinned Valenced template / CLI / types (`setup-valenced-template.sh`), Node 22.18+ and Bun for builds, Node's test runner for tests (as GIFs+).
- **Android native**: Kotlin 2.4, AGP 9.1, JDK 25, compile SDK 36, all from the pinned template (`./gradlew packageAllPlugins`, `:plugins:chat-islands:dexJar`). Compile-only: `app.valenced:api` (GitHub Packages; CI uses the run's token with `packages: read`), Xposed API 82, kotlinx-coroutines. React Native is reached through reflection, so no `react-android` dependency. Output: `plugin.jar` (DEXed), added to the ZIP at `dist.android.path` by `valenced-repo.yml`.
- **Desktop**: Vencord user plugin, type-checked against Vencord's latest source in CI (as GIFs+).
- **Profiling**: Perfetto (`adb shell perfetto`, frame timeline), Android Studio memory profiler; the in-app debug overlay.
- **Local network**: the cloud development environment can't reach the social APIs or `dl.google.com`. The resolver fixtures are hand-made in the documented shapes until `tests/fixtures/social/record.mjs` is run somewhere with normal access, and native builds run in CI (GitHub's Ubuntu runners include the Android SDK).

## 8. Tests and checks

- **Unit (Node)**: detect (every URL form above, plus non-matches), each resolver against recorded fixtures (exact model output), fetcher (limits, de-duplication, backoff), cache (TTL, stale-while-revalidate), layout (grids and heights), text (entities), marker encode / decode, registry, the rows patch against a recorded row object.
- **Patch tests**: every Discord mobile module path the plugins use exists in discord-mobile-datamining with the expected export (`messages/native/renderer/createMessageContent.tsx` default, `transformMessageComponents.tsx` default, `messages/native/MessagesRenderer.tsx`, `VisibleMessagesWindowHandler.tsx`, `media_viewer/native/components/openMediaModal.tsx`, `long_press/showLongPressMessageActionSheet.tsx`); the desktop `renderEmbeds` match against discrapper-canary.
- **Builds**: both Valenced plugins build, type-check and pass `preinit-check.cjs`; `chat-islands` Kotlin compiles to `plugin.jar`.
- **On device** (TESTING.md checklist per experimental build): islands appear at the right size, no blank boxes on fast flings, carousel swipe doesn't scroll chat, long press still opens Discord's menu, video pauses off screen, theme switch (dark / light / AMOLED) recolours everything, turning Chat Islands off leaves Discord's embeds, Perfetto trace within budget.

## 9. Phases

| Phase | What | Done when |
|---|---|---|
| **0 · Spike (Android)** | Chat Islands minimum: marker placeholder for one hard-coded message, find the hook point, host + one React surface, forced height | The island shows at the right size, scrolls in sync, survives recycling; trace recorded. Decides hook point (a) vs (b) and whether `MEDIA_GALLERY` placeholders size as needed |
| **1 · Chat Islands v0.1** | Provider API, measuring, pool, snapshots, gestures, long press, visibility, availability / fallback, debug overlay, settings | A test provider with a counter island passes the device checklist |
| **2 · Core + X (mobile)** | Shared core, X resolver, XCard (grid / carousel / video / quote / poll), viewer, sheet with replies | Real X links in chat look and behave like the canvas concept |
| **3 · Reddit + TikTok (mobile)** | Resolvers, cards, comment tree screen, TikTok video + photo posts | Same |
| **4 · Instagram (mobile)** | Resolver behind its kill switch, card | Same |
| **5 · Desktop** | Vencord plugin: patches, native.ts, CSP prompts, DOM cards | Same on desktop |
| **6 · Library 1.0** | Chat Islands README, example dependent plugin, API freeze | Another plugin can use it from the docs alone |

Development in the cloud environment can't run Discord, so each phase is built and unit-tested here, then checked on the user's Android phone with the experimental build.

## 10. Rules

Carried over from GIFs+ (each came from a real bug, see CLAUDE.md):
- Never touch the data, only what's displayed (row data is display; message objects, embeds and stores are never changed).
- No hardcoded colours: Discord theme tokens / CSS variables only.
- Mobile: nothing from `@valenced/discord/*`, `react` or `react-native` at module level; classic JSX pragma on every `.tsx`; never `<RN export>.<RN name>`; never a React / RN import as a shorthand object key; flux patches return the payload; settings load late (`whenSettingsLoaded`); turning the plugin on or off asks for a reload.
- Desktop: never copy an `@webpack/common` value at module level.
- Imported / fetched data is untrusted: URLs from APIs must be https and on the platform's known media hosts before they are shown or added to CSP; text is rendered as text, never as HTML.

New:
- Islands never block chat: anything that fails (hook, measurement, resolver) leaves Discord's embed in place.
- No network or heavy work in `match` (it runs during row generation); fetching happens in `prepare`, off the row path.
- Native code never keeps references to Discord views after they're detached (leaks); hosts are removed when their row view is recycled.
- Every hook point lookup is version-keyed and re-run when Discord updates.
- Native never calls into JS before the JS side said it listens (`listen`), and a JS method native calls never throws. Valenced throws inside its JS bridge for an unregistered method, and that kills the app (first device test, 2026-11-18: enabling Chat Islands while Discord ran closed it, because the JS side doesn't start then but native sent its status).
- Turning a plugin with a native part on or off takes effect after a restart on both sides (`startedLate` → `requireReload()` and start nothing; `stop` → `requireReload()`). Native work posted to the main thread runs guarded (`Runtime.post` / `guarded`): an exception there would crash the app.

## 11. Risks and open questions (answered by phase 0 unless noted)

- Does the image embed placeholder get the size its marker asks for, or does native clamp tall images (max height)? If it clamps: stack several placeholders, or force the size from the host.
- ~~Does Discord's chat draw embed images through Fresco's `DraweeView` (MarkerHook), and is their parent a `FrameLayout` (Hosts)?~~ Yes, from the decompiled 352.6 APK: `MediaView extends FrameLayout`, image `inline_media_image_preview` (`SimpleDraweeView`) is its direct child. Under R8 names, see section 4 (MarkerHook). Still to confirm on the device: that the hook fires for the marker.
- Do the embed images keep the message's long press and tap handling when an island covers them (islands call `openMessageMenu` themselves)?
- Does starting a second surface (`ReactSurfaces`, `FabricUIManager.startSurface`) work for a second app-registry module in Discord's bridgeless setup, and how fast is starting one (pool warm-up at chat open)? (`ReactHost.createSurface` doesn't exist in Discord's build.)
- Reanimated and gesture-handler access from a plugin (Valenced externals or module finders by props).
- Do the social sources return everything we need (X 20-photo posts via fxtwitter, Reddit unauthenticated rate limits on mobile networks, TikTok photo posts)? Answered in phase 2–4 with fixtures.
- Instagram embed page format changes often: kill switch + resolver health in settings.

## 12. Progress

- 2026-11-18: plan; shared core (detect, model, text, fetcher, cache, media, layout, health, X and Reddit resolvers) with tests on hand-made fixtures; Chat Islands JS (registry, store, pipeline, display, marker, measure, root, Discord patches, bridge) with tests and a Discord module check; Chat Islands native spike (Fresco marker hook, hosts, surface pool, measuring, events); CI builds every Valenced plugin and compiles native parts; the publish workflow packages `plugin.jar`.
- 2026-11-18, first device test: enabling Chat Islands with Discord running closed the app. Cause: the native part started late and sent an event to a JS method that was never registered (the JS side skips a late start). Fixed: native waits for `listen`, both sides require a restart on enable / disable, native main-thread work is guarded.
- 2026-11-18, second device test (0.1.0.14, Valenced 352.6 - Alpha, Xiaomi 23021RAAEG): enabling no longer closes Discord. After a restart both native parts failed: "Fresco's controller builder not found" and "Discord's ReactHost not found (not the new architecture?)"; `[island test]` messages showed as plain text. Cause: Discord's R8 renamed / inlined the APIs the native part looked up by name. Decompiled the APK from the phone (jadx; kept at `C:\Work\discord-352.6-jadx` on the user's PC, outside the repo) and rewrote the lookups by shape (MarkerHook, new `ReactSurfaces`, surfaces looked up at `listen`). Not yet built or tried on the device.
- 2026-11-18, third device test (0.1.0.15): `Hooked ij.f.build and pj.a.setController`, `React surfaces available`, `ChatIsland` surfaces start and take new props (`SurfaceHandlerBinding.setProps`), measuring finishes for the visible test messages. But Discord drew an empty embed card (a 44 px bar) instead of the image, so no host appeared. Cause (decompiled `ds.e.z` / `X` and `G`): an Image embed's inline media comes from `image` only, the placeholder set `thumbnail` (drawn in a separate small view). Fix: the placeholder sets `image` (no thumbnail); both marker parsers read `w` / `h` in any order (Discord's `getSrcWithWidthAndHeight` re-serialises the query and adds width / height / format). Valenced's documented API has nothing for chat rendering or React surfaces (checked the Discord, Native Bridge and Hidden API pages); `dexFinder` is a fallback if shape lookups break on a later Discord. Note: islands depend on Discord's "inline embed media" setting (`shouldInlineEmbedMedia` gates `image` in transformEmbeds).
- 2026-11-18, 0.1.0.16: the row with a placeholder showed Discord's "Something went wrong here": native `EmbedMedia` requires `url`, `width`, `height` and `srcIsAnimated` (352.6 `n7/s.java`). 0.1.0.17 adds `srcIsAnimated: false`: the placeholder is now drawn as a real image embed at the measured size (Discord's broken-image picture, inside `MediaView`), but no `IslandHost` appears and nothing is logged by the hook path. The load path is confirmed in the decompiled code (`EmbedMedia.i` = proxyURL → `MediaView` → `v50.l.o0` → `getControllerBuilder()` / `build()` / `setController`). 0.1.0.18 adds capped `diag:` logging (first build / setController call, marker controllers, non-marker `.invalid` URLs, host attach and surface) to find where it stops.
- 2026-11-18, 0.1.0.19–0.1.0.22: diagnostics. Logcat's line budget was used up by Discord's `res:/` icons, so 0.1.0.21 writes every diagnostic line to `Android/data/app.valenced/files/chat-islands/diag-<time>.log` (pull with adb; `MSYS_NO_PATHCONV=1` in Git Bash). Result: no `build()` ever carried the marker URL; the builds bound to the placeholder images have no request at all. jadx can't decompile `EmbedView`'s bind (`q9.q.b`, type inference fails even at 500× the limit); Vineflower 1.12.0 on a dex2jar 2.4.39 jar does (`C:\Work\discord-352.6-jadx\vf-out`, tools in `tools\`). The bind passes the media source to `MediaView.f(view, source, …)`, which loads `source.previewUrl` (= the embed image's proxyURL). 0.1.0.22 adds a diagnostic hook on `MediaView.f` (`DiagHooks.kt`) that logs the media source it gets for a marker and the view's state after.
- 2026-11-18, 0.1.0.22: `MediaView.f` receives the marker (`MediaSource(sourceUrl=null, previewUrl=https://chat-islands.invalid/i/…?w=320&h=212, type=IMAGE)`), its preview image is visible, but no `build()` with that URL is ever seen afterwards (why is open: possibly ART inlining around the hooked builder). 0.1.0.23 makes `MediaView.f` the main hook point (`MediaViewHook.kt`): a marker in the media source's String fields attaches the host to MediaView's preview image; a non-marker bind detaches it. The Fresco hook stays as a fallback and no longer detaches hosts.
- Next: phase 0 on a device (TESTING.md, "Chat Islands phase 0"), then a minimal Social Embeds plugin (X card) as the first real provider.

## 13. Decisions log

- 2026-11-18: account connections dropped (ToS and ban risk on X / Instagram, no APIs on TikTok / Instagram).
- 2026-11-18: Valenced (Android) is platform #1; desktop second; iOS out of scope.
- 2026-11-18: themes only, no hardcoded colours.
- 2026-11-18: separate plugins from GIFs+ (code may be copied, nothing imported).
- 2026-11-18: real React inside mobile chat through a native library (Chat Islands) usable by other plugins, instead of Discord's native card components. The native-card fallback is dropped: if islands are unavailable, Discord's own embed stays.
- 2026-11-18: placeholder is an image embed (not a `MEDIA_GALLERY` component); host is a sibling of the image view in a `FrameLayout` parent; React Native through reflection.
