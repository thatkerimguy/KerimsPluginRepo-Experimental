# KerimsPluginRepo — handoff notes

GIFs+ (called GifPickerOptimizer before 1.6.0): a Discord GIF picker plugin with two builds. The Vencord plugin name is `GIFs+` (Vencord has a built-in `BetterGifPicker`; `migratePluginSettings` moves the old `GifPickerOptimizer` settings). The Valenced id stays `thatkerimguy.gif-picker-optimizer`, its manifest name is `GIFs+`. Source folder names and DataStore keys keep the old names.

- `vencord/gifPickerOptimizer/`: Vencord user plugin for desktop and web. **This is the one being installed and tested now.**
- `valenced/gif-picker-optimizer/`: plugin for Valenced (github.com/Valenced/valenced), a React Native mobile client mod. Replaced the old Raincord build. Not tested on a device yet.

`lowres.ts`, `queue.ts`, `cache.ts` (also `ApiPreviewCache`), `klipy.ts`, `persist.ts`, `precache.ts`, `saved.ts`, `tileLoader.ts` and `transfer.ts` are identical in `vencord/gifPickerOptimizer/` and `valenced/gif-picker-optimizer/js/`. Change both together (CI checks it).

## Experimental repository (testing)

- `C:\Work\Gifs+\experimental` is a full copy of `C:\Work\Gifs+\repo`, meant for GitHub `thatkerimguy/KerimsPluginRepo-Experimental` (Pages: `https://thatkerimguy.github.io/KerimsPluginRepo-Experimental/index.json`). Try changes there first; copy them to `repo` once they work.
- The two folders hold the **same files**. `valenced-repo.yml` switches to experimental mode by itself when the repository name ends in `-Experimental`: each push publishes `<manifest version>.<run number>` (no manifest bump needed; the CLI accepts 4-part versions), as id `thatkerimguy.gif-picker-optimizer-experimental` / name "GIFs+ Experimental" (the workflow rewrites the manifest and `PLUGIN_ID` in a build copy, and fails if the old id is left), keeps the newest 5 builds, renames the repo config and points the landing page at the experimental repo. `BASE_URL` comes from the repository name in both modes. Checked by running the build, index and landing page steps locally (jq replaced by a stand-in).
- Desktop has no install URL: copy `experimental\vencord\gifPickerOptimizer` into Vencord's `src\userplugins` instead of the `repo` one (same plugin name and settings, so never both).
- Syncing: copy changed files across (both directions). Don't hand-edit names or ids per folder; the workflow handles that.

## File layout (since the readability refactor)

Vencord (`vencord/gifPickerOptimizer/`):
- `index.tsx`: `definePlugin`, patches, flux handler, start/stop.
- `settings.tsx`: settings definition and `quality()`. `CacheSettings.tsx`: the cache stats/reset component.
- `state.ts`: shared caches (`loaded`, and the saved `seen` / `failed` lists), the queue, `runtime` (holds the `KlipyResolver`, `Precacher` and `LowResPrefetcher` while running), `isCached` (only `loaded`) / `isPrecached` (precached or `seen`), `markLoaded` / `forgetLoaded`, `drop`/`isDropped`, the DataStore keys.
- `saved.ts` (shared): `SavedUrlSet`, a URL LRU with timestamps that expire, loaded from and saved to a `UrlListStore` (`attach` / `detach`). Used for `seen` and `failed`.
- `persist.ts` (shared): `Persisted<T>`, the one load / merge / debounced save / `reset` / `close` helper behind `SavedUrlSet`, `Precacher`, `KlipyResolver` and mobile `TenorPageResolver`. Never saves before the saved copy was read (a save replaces it); `reset()` and `close()` make a load still in flight stale. Saves are batched 15 s (a save rewrites the whole list); `flushSaved()` (state.ts, both builds) saves at once when Discord closes or is hidden (desktop `beforeunload` / `visibilitychange`) or the app leaves the foreground (mobile `AppState`).
- `tileLoader.ts` (shared): `useTileLoader(react, env, opts)`, the tile's whole load lifecycle (ticket, cache / precached shortcuts, lookup, still toggle, `enabled`, timeouts, error fallback, mobile's native cache probe and stall fallback). It takes React's hooks as an argument; each build passes its `tileEnv` (state.ts). `precached` is worked out before the first render, so precached tiles never flash the queued dot.
- `previews.ts`: `pickSrc`, `pickStill`, `lookupLowRes` + `lowResStarted` (the early search request), Klipy favourite lookups, `favoriteUrls` (memoized URL list for precache counts).
- `viewport.ts`: the "visible" `ViewportWatcher` and the `useViewport` hook (on-screen state for queue priority).
- `SequentialResult.tsx`: the tile (uses the shared `useTileLoader`). `components.tsx`: `Indicator`, `LoadOverlay`, `StillTile`. `stillFrames.ts`: frame capture and its LRU.
- `favoritesOnly.ts`: the favourites-only helpers called from patches. `types.ts`: shared types.
- `favorites.ts`: frecency favourites backend (read/update), `favoriteItems()`, precache downloads. `precacheUi.tsx`: precache button and stats (`renderPrecacheButton` is called from the Favorites header patch). `FavoritesSettings.tsx`: the Favourites settings section (precache, export to a file, import merge/replace). `hooks.ts`: `usePrecacheUpdates`.
- `transfer.ts` (shared): export/import format and logic (`buildExport`, `formatExport`, `parseExport`, `applyImport` (matches signed attachment URLs without their signature), `exportFavorites`, async `importFavorites`), `nextOrder`, `protoBytes` (exact size through `ProtoClass`), `favoritesBytes`, `estimateBytes` / `FAVORITES_MAX_BYTES`.
- `klipy.ts` (shared) also holds `LowResPrefetcher` (the search / trending low-res request started alongside Discord's) and `LowResPages`, which wraps it with the request and the `GIF_PICKER_QUERY_SUCCESS` handling (`arrived`); each build gives it adapters (`createLowResPages` in previews.ts). Queue settings are applied by `applyQueueSettings` (desktop settings.tsx: on start, setting change and connection change; mobile state.ts: on start and from `OptimizedResultsList`), not by tiles.

Valenced (`valenced/gif-picker-optimizer/js/`):
- `index.tsx`: `plugin({...})` and the start wiring (sets `runtime.*` and `pickerModules.*`).
- `settingsStore.ts` (was `shared.ts`): settings storage and hooks. `settings.tsx`: settings page. `cacheStats.ts`: stats/reset.
- `state.ts`: caches (`loaded`, saved `seen` / `failed`), queue, `runtime`, `isCached`/`isPrecached`, `markLoaded`/`forgetLoaded`, `drop`/`isDropped`. `nativeCache.ts`: `isNativeCached` (batched `Image.queryCache`). `tenor.ts`: `TenorPageResolver` (fallback only). `previews.ts`: `pickSrc`, `lookupFor`, `lookupLowRes`, Tenor media from the saved src, `favoriteUrls`.
- `viewport.tsx`: `ViewportStore`, `OptimizedResultsList`, `useVisibleIndex` (visibility for queue order only; no parking). `tile.tsx`: `OptimizedItem` (shared `useTileLoader`, `enabled` = Discord's tree has the Image, `treeHas`). `picker.tsx`: deferred picker and the categories page switch. `tree.ts`: `replaceInTree`.
- `modules.ts`: `pickerModules` (Discord's picker modules). `favorites.ts`: frecency backend, `precache.json`, `Image.prefetch` downloads, `favoriteItems()` (mirrors Discord's `transformFavoriteGifUrl`). `favoritesUi.tsx`: `usePrecacheUpdates`, precache button and stats, toast, confirm alert. `mainPage.tsx`: the favourites-only main page (precache bar + Favorites tile). `favoritesSettings.tsx`: the Favourites settings section (precache, export to clipboard/share, import from clipboard).

## What the user asked for

1. Load GIFs one at a time, left to right and top to bottom. Each one finishes before the next starts.
2. Show a loading or progress indicator on tiles that haven't loaded.
3. Show low-resolution previews in the picker: XS/S/SD on Klipy and Tenor, and smaller versions of vx/fx/twitter and Discord links. The full-resolution GIF must still be what gets sent to chat.
4. Port the mobile build from Raincord to Valenced.
5. Unload GIFs that are off screen and load the ones on screen, with caching, so big favourite libraries perform well on mobile and desktop.
6. Optional (off by default): still image previews in the favourites tab instead of playing GIFs.

## The user's setup

- Windows. Give commands for cmd or PowerShell, not `mkdir -p` or `cp`.
- Vencord is built from source. The plugin is copied into `Vencord\src\userplugins\gifPickerOptimizer`, then `pnpm build` and `pnpm inject` are run.
- Copy only `vencord\gifPickerOptimizer`, never the whole repo. Vencord treats every folder in `userplugins` as a plugin.
- To re-copy after changes: `xcopy /E /I /Y ..\bettergifs\vencord\gifPickerOptimizer src\userplugins\gifPickerOptimizer`, then rebuild and restart Discord. For quicker iteration, `pnpm dev` (watch mode) followed by Ctrl+R in Discord also works.

## How the Vencord plugin works (`vencord/gifPickerOptimizer/`)

### Rule: never touch the data, only what's displayed

Discord's "add favourite" action stores the item's `src`. Sending uses `item.url`. So the plugin never changes item objects or store data; it only changes which URL a tile *shows*. (Other plugins, such as BetterGifLoad, rewrite store data, which means favourites get saved at low resolution.)

### The webpack patch

- Find string: `"renderEmptyFavorite"`. That module holds the GIF picker results list (class `W`) and the tile component (class `H`, exported as `uG`). Inside `renderItem`, Discord does `(0,r.jsx)(H,{item:u,index:t,format:u.format,src:u.src,coords:s,onClick:…,renderExtras:…,imagePool,videoPool,…})`.
- The patch replaces `H` with `$self.SequentialResult` and passes `Result:H` and `resultType:this?.props?.resultType` (the list's `resultType`, used to detect the favourites tab).
- Match: `/(\(0,\i\.jsx\)\()(\i),\{(?=item:(\i),index:\i,format:\3\.format,src:\3\.src)/`. This was checked against the datamined code.
- Reference copy of Discord's code: github.com/Wumpus-Central/discrapper-canary, `chunks/884037.js` (the picker) and `chunks/821102.js` (GIFPickerViewStore). Chunk IDs change between Discord builds, so search by string instead of chunk ID.
- How tile `H` loads:
  - Images: preloaded on a detached pooled `<img>`, then an `<img>` is rendered once `onload` fires.
  - Videos: in `componentDidMount`, a pooled `<video>` (`preload=auto`, autoplay) is added to the tile.
  - In both cases `H` reads `src` from props.

### `SequentialResult` phases

1. **queued**: renders its own placeholder `div` (`.vc-gpo-tile`, `style={coords}`) instead of `H`, so nothing downloads yet. Clicking the placeholder calls `onClick(item)`, so it still sends.
2. **loading**: when the queue says go, it picks the preview URL with `pickSrc` and renders `H` with `src=preview` and `key=preview`. `renderExtras` is wrapped to add `LoadOverlay` inside H's root element.
   - `LoadOverlay` attaches capture-phase listeners (`progress`, `canplay`, `error`) to the parent element for videos. Progress is `buffered / duration`. A video counts as done on `canplay` (or `readyState >= 3`), like Discord's tile `H`, which shows its video in `handleCanPlay` (`oncanplay`). Until 1.6.0 it waited for `canplaythrough`, which comes later and held the queue slot longer. `StillTile` uses `loadeddata`, which is earlier still.
   - For images it loads the same URL in a probe `Image()`. The browser shares the request, so it doesn't download twice.
3. **done**: `H` is rendered as normal.

**No off-screen unloading (removed after 1.6.0 testing):**
- Checked in real Discord (2026-11-17, by the user): tiles leave the DOM when you scroll away, with the plugin's unloading off. Discord's results list (`W` in the `renderEmptyFavorite` module) is a virtualized masonry list (`y.f`, `chunkSize: 128`) with pooled `<img>`/`<video>` elements, so the plugin's own parking (`unloadOffscreen`, `offscreenMargin` 800 px, a second "near" watcher) added little and was removed. Old saved values are ignored.
- When Discord unmounts a tile, its ticket is dropped on unmount, so off-screen GIFs that haven't started don't download. When the tile comes back, a URL in `loaded` shows at once from the HTTP cache.
- One `ViewportWatcher` remains: "visible" (50 px, feeds queue priority), rooted on the picker's scroll container (`findScroller`), because rooted on the window `rootMargin` does nothing. The watched element is the placeholder, the still tile, or `.vc-gpo-sentinel`, an `inset:0` div rendered through `renderExtras` inside H.

**Still favourites (`stillFavorites`):**
- Favourites are detected by `resultType` matching /favou?rite/ or, as a fallback, items with a numeric `order` and no `id` (frecency favourites have that shape on desktop and mobile).
- `stillUrl()` in `lowres.ts` gives a still rendition when the source has one: Tenor PNG posters (`Ag`/`AN`/`Ae`/`AD`, checked against the Tenor API), Giphy `_s` renditions, `video.twimg.com/tweet_video` → `pbs.twimg.com/tweet_video_thumb`, and Discord's media proxy without `animated=true` (`format=jpeg` for videos).
- Otherwise (Klipy, etc.) `StillTile` loads the preview, captures the first frame with `createImageBitmap` (falling back to a canvas copy), draws it with object-fit cover, and releases the element. Frames are kept in an LRU (`frames`, 300).
- Still tiles are the plugin's own div (like the placeholder), not H. Clicks and the context menu still go to Discord's handlers with the original item.
- Fallback chain on error: still URL → low-res preview (frame captured) → original.

**Errors and timeouts:**
- If the preview fails, the tile switches to the original `src`.
- After `loadTimeout` seconds, the queue slot is freed while the GIF keeps loading.
- If the component throws, the ErrorBoundary fallback renders the original tile.

### Queue (`queue.ts`)

- Ordering:
  - Tiles on screen come first (an IntersectionObserver feeds this).
  - Then item **index**: the masonry layout places items in index order, so index is the true reading order. Pixel tops in a masonry grid are staggered and give the wrong order.
- Then `priority` tickets (precached GIFs) before the others with the same visibility, then index. Precached tiles used to skip the queue entirely (`isCached` trusted `precache.has` forever), so after Chromium or Fresco evicted them they all downloaded at once. Now only `loaded.hit` skips the queue; a precached URL gets `priority` and no spinner.
- `block()` holds the queue while the Klipy low-res lookup is in flight (3-second cap), so full-size files don't start downloading in the meantime. With the early request (below) it only blocks for whatever is still in flight when Discord's results arrive, and only for what's left of 3 s since the request started.
- Concurrency (desktop): a dropdown (Auto, 1–6; a slider's "Auto" marker label wrapped), 0 = **Auto** (default for new installs): `navigator.connection` → 2 on `slow-2g`/`2g`/`3g` or `saveData`, 6 on `4g` with `downlink >= 5`, 4 with `downlink >= 2`, else 3 (also when the API is missing). `loadConcurrency()` in `settings.tsx`. Vencord writes a default into settings the first time it's read, so existing installs keep their stored 3. Mobile has no such API: 3 by default.

### Low-res sources

**Klipy** (`lookupLowRes`, `LowResPrefetcher`):
- Klipy gives every size a random file name, so the URL can't be rewritten.
- Discord's search (`y` in the desktop actions chunk, find `"GIF_PICKER_QUERY_SUCCESS",query:`; mobile `doSearchRequest` in `actions/GIFPickerActionCreators.tsx`) is one request, debounced 250 ms, `{q, media_format: getSelectedFormat(), locale, limit}`; no paging. Trending is `Z4` / `fetchTrendingGIFs(limit)` on `/gifs/trending-gifs`.
- The plugin's request starts at the same time as Discord's: desktop patches `y` and `Z4` to call `$self.lowResStarted(query, limit)` right before `o.Bo.get({url:…GIFS_SEARCH…` / `…GIFS_TRENDING_GIFS…` (regexes tested against an esbuild-minified copy of `c497685.js` in the scratch `re/` folder). Mobile wraps the exported `search(query, type, immediate, limit)` (with its own 250 ms debounce unless `immediate`, mirroring Discord's; an empty query doesn't cancel it, like Discord) and `fetchTrendingGIFs(limit)` with `instead`. Requests are keyed by query + format; one that worked is reused for 5 minutes.
- On `GIF_PICKER_QUERY_SUCCESS` (a flux handler), `lookupLowRes` asks the prefetcher for that query. In flight → the queue is blocked until it settles (3 s cap from its start). Done → nothing. None started or it failed (patch didn't apply, settings changed) → the old way: `RestAPI.get` on `/gifs/search` (or `/gifs/trending-gifs` when there's no query) now, with the queue blocked.
- The request uses the same q, locale and limit, with `media_format` set to `tinywebm` (S) or `nanowebm` (XS). Linux desktop uses `tinywebp` by default, so XS there becomes `nanowebp`.
- Results are mapped back to tiles by `id` or `url`.
- SD for Klipy keeps Discord's default size.

**Everything else** is rewritten in `lowres.ts` `rewriteUrl`:

| Source | Rewrite |
|---|---|
| Tenor | Last two characters of the media id: image `A2`/`A1`/`Ax` (nano/tiny/full webp, all animated; `A5` is a static frame), video `P2`/`P1`/`P1` (nano/tiny mp4; `P3` is tinywebm). Checked against Tenor's API 2026-11. |
| Giphy | `100w` / `200w` / `480w` |
| cdn/media.discordapp.net and images-ext (vx/fx/twitter embeds) | Discord media proxy with `width`, `height`, `format=webp`, `animated=true` |
| pbs.twimg.com | `name=` parameter |

A preview is only used if it's the same media type as the original (video stays video, image stays image), because H renders based on `format`.

## Verified vs unverified

**Changed on 2026-11-17 (second review: shared tile loader and low-res pages; not tried in Discord or on a device):**
- `tileLoader.ts` replaces both copies of the tile state machine. Fixes: a tile that lost its Image during a lookup spun forever (now restarts); precached tiles flashed the queued dot (desktop) / never faded in (mobile), because `precached` was only set after the first paint; `pickSrc` ran three times per mount (the first pick is reused); still tiles parsed `stillUrl` every render (memoized).
- `LowResPages` (klipy.ts) replaces both copies of the search / trending low-res code. Removed dead code: `findKey`, `Persisted.isLoaded`, `LoadQueue.isBlocked`.
- **Rule (mobile): never use a React or React Native name as a shorthand object key** (`{ useState, useEffect }`): the build rewrites the name there too and the bundle fails to parse. tile.tsx passes the `React` namespace to `useTileLoader` instead.
- Checks: both type checks (desktop against a fresh Vencord checkout; `gifenc` couldn't be downloaded, so two unrelated plugins fail), mobile build + `preinit-check.cjs`, scratch tests: `useTileLoader` with react-test-renderer (order, precached first render, still toggle, disabled mid-lookup, error fallback, native cache), `LowResPages`, persistence with the 15 s delay.

**Changed on 2026-11-17 (code review fixes; not tried in Discord or on a device):**
- Toggling still favourites while a tile was queued left it waiting forever (the still effect dropped the ticket the queue effect had just made). Fixed in both builds: the still effect does nothing while `queued`.
- Mobile tiles without a matching `Image` in Discord's tree (`treeHas`) now pass `enabled: false` to `useTileLoader`: no ticket while it's missing, queued again when it appears. Before, the ticket was dropped for good on the first such render.
- Mobile still favourites use the Tenor media URL (`tenorMediaFor`), so Tenor favourites (shown as page URLs) get PNG stills.
- Mobile `Design` components are read inside components, never at module level. The old module-level destructuring didn't actually break pre-init (the build inlines it at each use site, checked), but it relied on that.
- Desktop "Reset cache" with the plugin off deletes the saved seen / failed / precached / Klipy DataStore keys.
- `applyImport` checks duplicates with a Set of unsigned keys: 3000 into 3000 went from 6.1 s to 9 ms (same results as `findKey` on 600 random cases).
- `persist.ts` replaces four copies of the save logic. `KlipyResolver.stop()` / `TenorPageResolver.stop()` close saving on plugin stop (`flush()` only saves). `lowres.ts`: `toMediaProxy` / `setProxySize` shared by `rewriteUrl` and `stillUrl` (2208 old vs new outputs identical).
- Checks: mobile `valenced-plugin build`, `tsc -b` (catches a planted error) and `preinit-check.cjs` with the template (its git dependencies cloned by hand: bun can't fetch them through the API proxy here), scratch persistence tests with fake timers for all four classes.

**Changed on 2026-11-17 (desktop loading indicator animations; experimental only, not tried in Discord):**
- `Indicator` (components.tsx) is CSS shapes now, no SVG ring. queued: a 10 px dot that breathes. loading: a spinner that grows out of the dot (`vc-gpo-dot-to-spinner`). Progress known: the ring flattens into a 44 px line that then fills (`vc-gpo-spinner-to-line`), % below. Precached / seen tiles (no indicator before): state `cached`, a breathing circle that morphs into a square and back (2.4 s), fading in after 150 ms so instant cache hits don't flash.
- React swaps the element between states (placeholder → Discord's tile), so each entry animation starts from the previous state's look. Looping ones get a negative `animationDelay` from `performance.now()` (`inStep`), so they continue across the swap and all tiles move in step. `enter={false}` skips the dot→spinner growth after the `resolving` spinner (`spinnerShown` ref in SequentialResult).
- Spin uses the `rotate` property and the entry `scale`, so both run at once. Reduced motion: no animation, static dot / rounded square / ring / line.
- **No hardcoded colours** (the user's rule: everything must follow the theme). Indicator: `--text-muted` (dot/shape), `--background-mod-strong` (track), `--control-primary-background-default` (accent), `--text-default` (%). Not `--brand-500` or `--control-overlay-*` (fixed colours, invisible on light themes).
- Discord's tile `H` shows a background until its GIF loads: `this.props.color`, or a random pick from a fixed palette (`PREMIUM_TIER_1_PURPLE`, `PREMIUM_TIER_1_BLUE`, `#929AFA`; `j` in chunk 884037). The tile now gets `color={PLACEHOLDER_COLOR}` (`var(--background-mod-subtle)`, the placeholder's colour), also in the ErrorBoundary fallback. While loading, `LoadOverlay` draws the placeholder's shimmer on top (`.vc-gpo-overlay-loading`), kept in step via `--vc-gpo-sync`.
- Mobile (`tile.tsx`): same states and shapes with RN `Animated`. `breathe` and `spin` are shared native-driver loops; `morph` (cached corner radius + 90° turn) is a shared JS-driver loop; all reference counted per tile with `useLoops`, so tiles move in step and one loop runs per kind. Per-tile `grow` (dot → ring) and `flat` (ring → line) are JS-driver transitions that animate width/height/borderRadius/borderWidth like desktop. Native and JS values are never on the same view.
  - Ring = two views: a full track (`TEXT_MUTED` at `TRACK_OPACITY` 0.3, becomes the progress line's track) and a brand arc (`borderColor` transparent, `borderTopColor` brand) that alone spins. First device test (2026-11-17): one view with `BORDER_SUBTLE` sides showed only the arc, and the spin was broken.
  - **Rule: never remove a native-driven animated style from a view that stays mounted** (e.g. `state === "queued" ? breathing : null`). React Native leaves the view at the last native value, so spinners kept the box's breathing scale (60–100%) and opacity from the moment loading started: different sizes per tile (device test, 2026-11-17). Now only the dot's own wrapper breathes, with the style always attached.
  - Shared loops reset their value to 0 when they restart: a native loop repeats from the value it started at, so a spin restarted at 0.6 went 0.6 → 1 and jumped back each turn. The tile keeps one `Indicator` at the same place in its frame from queued to loading (`{null}{indicator}` / `{image}{indicator}`), so it isn't remounted. Colours from `Tokens` as before (`TEXT_MUTED`, `BORDER_SUBTLE`, `BACKGROUND_BRAND`). `ActivityIndicator` is no longer used.
- **Fixed after the first device test** (every mobile tile threw "Cannot read property 'react' of undefined"): the Valenced build rewrites React Native names to `valenced.react.ReactNative.<name>` even after a dot, so `Animated.View` became `Animated.valenced.react.ReactNative.View`. Now `AnimatedView = lazy(() => Animated.createAnimatedComponent(View))`. **Rule: never write `<React Native export>.<React Native name>` in mobile code** (`Animated.View`, `Animated.Text`, ...). `preinit-check.cjs` now also fails a bundle containing `<identifier>.valenced.react.` (it fails the broken build, passes the fix). The smoke test builds from source with esbuild, so it can't see this.
- Checked: desktop typecheck against the local Vencord checkout and the keyframes frame by frame on a scratch demo page; mobile `tsc -b`, `valenced-plugin build`, `preinit-check.cjs` (OK) and smoke `vrun.mjs new` with an `Animated` stub (same order/fallback/tap results; every shared loop released afterwards). Not on a device or in Discord.

**Fixed on 2026-11-17 (mobile plugin turned itself off after every restart; first device test):**
- Symptom (user, on the experimental build 1.6.0.1): after restarting Discord the plugin was off, and turning it on did nothing until it was removed and reinstalled.
- Cause (Valenced source, `bundle/lib/plugins/src`): at boot, `preinit.ts` runs `preInitPlugin` for every enabled plugin, which evaluates the whole plugin script (`createOptionsFactory`, `new Function`) before Discord's index module is initialized. `valenced.discord.design` / `common.tokens` / `actions` throw "Cannot access … before the init phase" then, and `valenced.react.React` / `ReactNative` / `ReactJSXRuntime` are still undefined (set by `waitForModules` when Discord loads them). A throw there goes to `handlePluginError`, which disables the plugin; `resolvePluginOptions` already cleared `optionsFactory`, so re-enabling has no lifecycles until a reinstall. On a fresh install everything is loaded already, so it worked until the first restart.
- Our script read at evaluation: `Design.createStyles({…Tokens…})` (tile), `createContext` (viewport), three `StyleSheet.create` (tile, picker, mainPage). And the template build compiles JSX to the automatic runtime and passes `valenced.react.ReactJSXRuntime` as the IIFE argument, captured once at evaluation (undefined at pre-init).
- Fix (mobile only): `lazy.ts` (`lazy(make)` builds a value on first use) for those styles and the context; every `.tsx` starts with `/** @jsxRuntime classic */ /** @jsx valenced.react.React.createElement */ /** @jsxFrag valenced.react.React.Fragment */`, so JSX looks React up on each render (the bundle no longer takes an IIFE argument). `jsx.d.ts` maps the global `JSX` namespace to React's so `tsc` accepts the pragma (TypeScript looks for `valenced.JSX`, then a global `JSX`, which React 19's types dropped); a planted prop error is still caught.
- **Rule: nothing from `@valenced/discord/*`, `react` or `react-native` may run at module level** (only inside functions, or through `lazy`). `@valenced/json-storage` and `@valenced/patcher` are fine at pre-init.
- Checks: `.github/scripts/preinit-check.cjs` evaluates a built script with throwing Discord APIs and no React, like Valenced at boot; the publish workflow runs it after each build and fails on a throw. It fails on the published 1.6.0.1 ("Cannot read properties of undefined (reading 'StyleSheet')") and passes on the fix. Smoke `smoke/vrun.mjs new` sets `globalThis.valenced = { react: { React } }` for the pragma; all runs unchanged.
- Not yet copied to `repo` (try the experimental build on the device first). Not verified on a device yet.

**Changed on 2026-11-17 (saved lists across restarts; not tried in Discord or on a device):**
- Before, everything the plugin knew about GIFs was memory only, so after a restart every tile waited in the queue with a spinner again and broken previews were tried again (the GIF files themselves were still in Chromium's HTTP cache / Fresco's disk cache). Our own byte cache isn't possible: CSP `connect-src` doesn't allow fetching the GIF CDNs.
- `seen` (`SavedUrlSet`, 5000 URLs, 14 days): every finished load (`markLoaded`). Saved under DataStore `GifPickerOptimizer_seen` (desktop) / `seen.json` (mobile). `isPrecached` includes it: first in the queue, no spinner, still takes a turn (the cache may have evicted the file). Only `loaded` (this session) skips the queue.
- `failed` is a `SavedUrlSet` too (600 URLs, 7 days; was a `BoundedSet` that never expired, now removed): `GifPickerOptimizer_failed` / `failed.json`. A failed preview is also removed from `seen` (`forgetLoaded`).
- Saving: batched (15 s since the 2026-11-17 review, was 2 s), and a re-add only refreshes the saved time when it's 12 h old, so scrolling doesn't keep writing. Nothing is saved until the saved list was read (a save replaces it); saved entries go before this session's in LRU order. `detach` on stop flushes. Cache reset clears both, also on disk.
- Mobile only: tiles ask `Image.queryCache` (batched per 16 ms) for their URL as they queue. If it's in the native cache and the ticket hasn't started, the ticket is dropped and the tile shows at once. Unverified on a device: Discord's tile image may not go through RN Image's cache (then the answer is always "not cached" and nothing changes). Desktop has no equivalent (the HTTP cache can't be queried from a page).
- Tests (scratch): `tests/test6.ts` covers `SavedUrlSet` (load merge order, expiry, bad entries, save throttle, LRU limit, detach flush, clear during load, attach race, failing loads); `tests/f/test12.ts` uses it for the `version` checks. Smoke `smoke/vrun.mjs new` adds a "native cached" run (tiles 6-9 cached: they show right after the first batch, one `queryCache` call for 10 URLs).

**Changed on 2026-11-17 (1.6.0 follow-up: fixes from comparing each feature with Discord's datamined picker code; not tried in Discord or on a device):**
- Desktop video tiles finish on `canplay` (Discord's tile shows them then), not `canplaythrough`.
- `importFavorites` is async and runs `applyImport` + the size check inside `backend.update`, on the favourites as they are then (a favourite that synced between read and update is kept). Over the limit it returns false to cancel, like Discord's add favourite (`wg`: `uz.toBinary(e).length > 762880`). Size: `protoBytes` finds `FavoriteGIFs` through `FrecencyUserSettingsActionCreators.ProtoClass.fields` (`favorite_gifs` / `favoriteGifs`, `T()`), `toBinary(create({gifs})).length`; falls back to `estimateBytes`. `backend.update` resolves after the callback ran: desktop `updateAsync` is `async` (awaits `loadIfNecessary`, then calls the updater synchronously and dispatches), checked in the datamined `594061.js`; mobile assumed the same. Parse errors still throw before anything is touched.
- The Klipy low-res search/trending request starts with Discord's (patch on `y`/`Z4`, mobile `search`/`fetchTrendingGIFs`), see Low-res sources. Old behaviour stays as the fallback.
- Mobile Tenor favourites: preview from the saved src (`favoritesBackend.read()[item.url].src`, `tenorMediaFromSrc` unwraps images-ext) with `rewriteUrl(..., { imagesOnly: true })`; `TenorPageResolver` (HEAD) only when the saved src isn't a Tenor media URL. Assumes favourites tab items have `url` = the favourites key (Discord's `useSortedFavoriteGIFs`).
- Precache: precached URLs get queue `priority` and no spinner instead of skipping the queue. `Precacher` notifies at most every 250 ms during a run (plus right away on start/end/cancel); `favoriteUrls(items)` memoizes the URL list per items array + quality + still + `KlipyResolver.version` (+ `TenorPageResolver.version` on mobile) + `failed.version`, and `favoriteItems()` returns the same array until favourites change. Before: about 25M URL rewrites for a 5000-favourite precache.
- Desktop concurrency **Auto** (value 0, default; a dropdown since the slider's "Auto" label wrapped) and quality **Auto** (S, SD at `devicePixelRatio >= 2`; tiles target 200 px, `desiredItemWidth: 200`). Quality Auto is an option, not the default.
- Mobile default quality **S** (was XS): Discord mobile asks for `tinywebp`, so S sends no extra request; XS added a `nanowebp` request per search and showed about 90 px previews on tiles about 540 device px wide.
- Mobile parking removed with the `unloadOffscreen` / `offscreenBuffer` settings (saved values are ignored). `ViewportStore` stays for visible-first order.
- Tests (scratch): `tests/f/test11.ts` now uses an async backend that applies the updater to the favourites as they are at update time (race case: a favourite synced in between is kept, for merge and overwrite), the exact-size path and `protoBytes` with a fake proto; `tests/f/test12.ts` covers queue `priority`, the precache notify throttle, Tenor media from the saved src, `LowResPrefetcher` (debounce, reuse, fallback on failure) and the `version` counters. Smoke `smoke/vrun.mjs new` fails S previews (`AAAA1`, was XS `AAAA2`) and adds "precached first" and "tenor favourites" runs. `re/` has `c497685.min.js` (esbuild `minifyWhitespace` of the datamined chunk) for the new patch; `re.mjs` accepts single-quoted finds.
- To try in Discord: the `"GIF_PICKER_QUERY_SUCCESS",query:` patch applies (no Vencord patch warning) and the Network tab shows our `/gifs/search?…media_format=tinywebm` next to Discord's, not after it; video tiles finish sooner; import merge/replace still work and the toast shows the counts; precached favourites show without spinners and, after clearing the cache, load in order. On a device: `search`/`fetchTrendingGIFs` can be patched (no warning in the log), Tenor favourites show tiny webp without HEAD requests, and the default S looks fine.

**Changed on 2026-11-17 (1.6.0, not published yet; not tried in Discord or on a device):**
- Renamed to GIFs+ (`migratePluginSettings` from `GifPickerOptimizer` on Vencord), theme colours, Favorites precaching (`precache.ts`, desktop Favorites header button via the `case …FAVORITES:return(0,…jsxs)("div",{className:…,children:[` patch, mobile settings and favourites-only bar), favourites export/import (`transfer.ts`, format `"gifs-plus"` version 1, one GIF per line; merge or replace; refused over Discord's 762880-byte limit).
- **Folders and NSFW were removed** (the user's call, 2026-11-17). 1.6/1.7 builds with folders were never published, so there's no migration or fallback. Folder history, for reference: first `#gpo=` tags in each favourite's src (broken by clients appending "&"), then one "folder data" favourite with a `data:` GIF holding JSON. Both were unreliable or awkward; don't bring them back without a different sync approach. The user's own test account may still hold the folder data favourite (`https://github.com/thatkerimguy/KerimsPluginRepo#gifs-plus-folder-data`) and `#gpo=` fragments on some srcs: harmless, but the data favourite shows as a tile until it's unfavourited.
- `withoutSignature` (now in `transfer.ts`) skips empty query parts, so attachment URLs ending in "&" still match their favourite.
- Tests (scratch): `tests/f/test11.ts` (transfer: format, parse errors, merge/overwrite order, attachment keys, size limit), `test10.ts` (precache), older `tests/test*.ts` (lowres, cache, klipy, queue). Mobile smoke test `smoke/vrun.mjs new` (order, fallback, a tap sends at once).

**Fixed on 2026-11-16 (1.5.1, third review):**
- Mobile `TenorPageResolver`: a non-OK HEAD response (429, 5xx) counts as a failed lookup (retried after 5 minutes) instead of being saved as "no small version" for good.
- `KlipyResolver`: only HTTP 4xx rejections (not 408/429) count toward skipping a media_format (`isRejection`). Timeouts and network errors no longer disable a format for the session.
- Mobile stall fallback: a preview that still reports progress keeps loading; it only falls back after `loadTimeout` seconds without progress (and at least 2 × `loadTimeout` in total).
- Mobile `useSettings` always calls the same hook: it subscribes to the last storage (`hookStorage`), which is kept after the plugin stops.
- Desktop still tiles: a frame that was evicted (closed) before it was drawn is captured again instead of leaving a blank tile with a spinner.
- `LoadQueue` keeps waiting tickets in a binary heap (rebuilt on `kick()`, cancelled ones skipped): draining 5000 tickets went from 99 ms to 7 ms. Order changes must call `kick()`.
- Desktop settings: the Cache section is now last.
- CI: `.github/workflows/shared-files.yml` and a step in the publish workflow fail when the shared files differ between the builds.
- Tests now run with Node (`node --experimental-transform-types`), since Bun isn't on PATH; klipy.ts imports need `.ts` extensions added for that (see the scratch `t/n` copy).

**Changed on 2026-11-16 (1.5.0, second review + cache reset; repo renamed):**
- The GitHub repo is now `thatkerimguy/KerimsPluginRepo`; the Valenced repository URL is `https://thatkerimguy.github.io/KerimsPluginRepo/index.json` (the old BetterGIFS Pages URL stops working; users re-add the new one).
- Klipy favourite lookups (`klipyFormats`) only run for favourites (`isFavoriteItem`). Search/trending results get previews from `lookupLowRes` only; before, at S/SD on mobile every Klipy result did its own `/gifs/search`.
- `KlipyResolver` skips a media_format for the session after 2 failed searches in a row if it never worked (`usable()`), in both `resolve` and `peek`.
- Saves wait for the saved cache to load (`loadDone`): Klipy and mobile Tenor saves replace the whole file, so saving earlier could drop saved entries.
- A preview shown from the `loaded` cache that fails now falls back like a fresh load: mobile handles `onError` in phase `done`; desktop keeps `LoadOverlay` mounted (quietly) for previews in phase `done`.
- Desktop: changing `offscreenMargin` re-observes mounted tiles with the new margin (now done in `useViewport`, was an `onChange` calling `nearWatcher.refresh()`).
- Mobile favourites-only hint is a plain "Search for GIFs above." (no favourites hook).
- Cache settings: `LruCache.approxBytes()` (strings + 200 B per entry, from the Bun measurements), `KlipyResolver.stats()/clear()` (clear also saves `{}` and ignores a load still in flight via `generation`), mobile `TenorPageResolver.stats()/clear()`. Mobile settings read them through `cacheControl` in `settingsStore.ts` (was `shared.ts`); Vencord has an `OptionType.COMPONENT` setting (`CacheSettings`) refreshed every 2 s. Reset doesn't touch Discord's own image cache.

**Fixed on 2026-11-16 (1.4.1, code review findings):**
- Desktop `ViewportWatcher` leaked an IntersectionObserver pair per picker open (each holding the closed picker's DOM through its root). Observers are now reference counted and disconnected with their last element.
- Desktop Klipy lookups race `loadTimeout` like mobile, so a long serial lookup chain can't keep tiles spinning.
- `KlipyResolver.search` replaces a saved miss ("") when a later search returns that GIF.
- Desktop favourites only: `componentDidMount` is patched to `$self.mountCategories(trendingCategories, fetch)`, which keeps Discord's fetch action. If the option is turned off while the picker is open, `needsCategories` starts the fetch (outside render) instead of showing the skeleton forever.
- A ticket `start()` that throws now falls back to loading the original instead of leaving the tile queued forever (both builds).
- Mobile `TenorPageResolver` remembers failed lookups (network error, timeout) for 5 minutes in memory, so remounting tiles don't fire a HEAD request each time.
- `loaded` is resized when the setting changes (Vencord `onChange`; mobile: an effect in `OptimizedResultsList`), not in every tile render.
- Mobile favourites-only hint only suggests starring GIFs when there are no favourites (a picker with `hideFavorites` has none to show).

**Changed on 2026-11-16 (1.4.0, favourites only keeps the main page + smaller caches):**
- `favoritesOnly` no longer replaces the main page with the favourites list (the user wants the normal main page, with search and the Favorites category, minus the featured categories).
  - Desktop: three replacements in the `"hideFavoritesTile:"` module's categories component `k`: `componentDidMount` only fetches trending when `$self.needsCategories(...)`, `getData` uses `$self.featured(trendingCategories)` (a stable empty array when on), and `renderContent` shows the loading skeleton only when `needsCategories`. The old `frontPage` patch is gone. Regexes were tested against a hand-minified copy of the chunk.
  - Mobile: the `GIFPickerCategoriesPage` patch renders one row with Discord's `GIFPickerCategoryView` for `props.favoritesCategory` (same row height and gutter as Discord's page) and empty spacers, or a hint text when there's no favourites category. Discord's page would pad to 20 rows of grey skeletons with only one category, so it isn't reused.
- Memory, measured in Bun with full caches: `loaded` 0.26 MB (1000), `failed` 0.11 MB, `apiPreviews` 2.1 MB → 0.5 MB (now an LRU of 1200 instead of a Map cleared at 3000), Tenor pages 2.5 MB for 5000 favourites (only grows with favourites, unchanged), Klipy: unrelated search results go to an unsaved LRU of 500 and move to the saved cache only when a favourite uses one (40 lookups saved 2040 entries before, 40 now).
- Desktop still frames were the big one: up to 300 full-size bitmaps (about 40 to 200 MB). `LruCache` now takes an optional `weigh`; frames are captured with `createImageBitmap` resize to cover the tile in device pixels and limited to 24 MB. Evicted canvases are zero-sized to free them.
- `LoadedCache` values are timestamps (numbers) instead of objects. `LruCache.set` on an existing key now calls `onEvict` for the replaced value.

**Added on 2026-11-16 (1.3.0, favourites only + faster GIF tab switch):**
- Desktop `favoritesOnly`: the picker parent (find `"hideFavoritesTile:"`, discrapper `chunks/649529.js`) renders the categories grid `L` when `this.state.resultType` is null, else the results list with favourites data when it's `FAVORITES`. The patch swaps `this.state` in `renderContent` for `$self.frontPage(this.state, hideFavorites, FAVORITES)`. The header still reads the real state, so it keeps the search bar and no back arrow. Typing sets `SEARCH` as before. The regex was checked against a minified copy of the code, not in real Discord.
- Mobile `favoritesOnly`: patches `type` of the memo `GIFPickerCategoriesPage` default and renders `GIFPickerResultsList` with `useFavoriteGIFsMobile().favorites`, the picker's `onPressGIF` (taken from a context provided by the GIFPicker patch) and a `columnWidth` measured with `onLayout`. Falls back to Discord's page when the picker has `hideFavorites`.
- Mobile `fastTabSwitch`: patches `type` of the memo `GIFPicker` default. The first render is an empty frame with a spinner, and the picker mounts after `requestAnimationFrame` or `InteractionManager.runAfterInteractions` (capped at 300 ms). Picker and categories page render as their own components (`PickerInner`, `CategoriesPageInner`) so the hook order never changes.
- Why the switch is slow on mobile: on mount, GIFPicker dispatches `initializeSearch`/`resetSearch`, fetches trending search terms, and the categories page fetches trending categories and renders up to 20 rows of animated category GIFs. Not profiled on a device: the deferral helps if the picker mount is the slow part. If the emoji picker's unmount is the slow part, it won't.

**Fixed on 2026-11-16 (1.2.2, favourites stuck loading on mobile):**
- Discord mobile's `transformFavoriteGifUrl` (`modules/gif_picker/native/GIFPickerUtils.tsx`) rewrites favourites before the picker shows them: proxied (images-ext) ones get `animated=true` (the proxy turns mp4 into animated webp), and Tenor favourites become `<tenor page URL>.gif`, which 302-redirects to `media1.tenor.com/m/<id>AAAAC/<name>.gif`.
- 1.2.0 unwrapped proxied Tenor mp4s into direct Tenor **mp4** URLs. The mobile tile is an image component, can't show mp4, and apparently never fires onLoad/onError, so tiles spun forever.
- Mobile now calls `rewriteUrl(..., { imagesOnly: true })` (Tenor/Giphy give animated webp; proxied unknown videos get resized `format=webp&animated=true` through images-ext) and rejects any video preview URL.
- `TenorPageResolver` (mobile only, `tenor.ts`) follows the page URL redirect once with `fetch(HEAD)` and saves page → media in `tenor-pages.json`.
- Klipy lookups on mobile always ask for image formats.
- Safety nets: lookups (`resolving`) can't hold a tile longer than `loadTimeout`; `KlipyResolver` waits at most 2 s for its saved cache and 8 s per search; a mobile preview still loading after 2 × `loadTimeout` falls back to the next option (`error()`).
- Unverified on a device: that RN `fetch` HEAD exposes the redirected `res.url`, and that images-ext resizes proxied videos into animated webp.

**Fixed and verified on 2026-11-16 (1.2.0, low-res for favourites):**
- The queue effect's cleanup used to cancel a ticket as soon as it started loading (its deps include `phase`), so loading wasn't strictly sequential. Now only unstarted tickets are cancelled there; started ones are freed by finishing, parking (`drop`) or unmounting.
- Unit tests (Bun) for proxy unwrapping, the Tenor codes and `KlipyResolver` (format fallback, caching of other results, misses, persistence) pass. Tenor URLs generated for the user's reported GIFs were fetched live: all 200; the webps are animated.

**Verified on 2026-11-16 (Valenced port + unloading + still favourites):**
- Valenced build: `tsc -b` passes (and catches a planted error), `valenced-plugin build` produces `build/js/index.js`. Biome only reports style (tabs vs spaces, import type).
- Vencord build: `pnpm build` passes, `tsc --noEmit` on all of Vencord has 0 errors, oxlint only reports the license header rule that applies to built-in plugins.
- Unit tests (Bun) for `rewriteUrl`, `stillUrl` and the LRU caches pass. Generated Tenor still/preview URLs return 200 live.
- **Not run in real Discord or on a device.** Check: tiles unload and come back when scrolling a big favourites list; the sentinel sits inside H (if tiles never unload, H's root isn't positioned and the sentinel covers the whole list, which is the safe failure); still favourites show; clicking a still/parked tile sends the original.

**Verified in the earlier cloud session:**
- Both builds typecheck. The full Vencord build passed; the rain build and eslint passed.
- jsdom test with a replica of Discord's `H` tile:
  - strictly one download at a time, in index order;
  - previews shown, and the original item sent, including when clicking a queued tile;
  - Klipy tiles waited for the lookup;
  - a 404 preview fell back to the original.
- A react-test-renderer test of the mobile build passed the equivalent checks.

**Not yet verified in real Discord. Check these first:**
1. **Does the patch apply?** If not, the console shows a Vencord warning about the `renderEmptyFavorite` patch. Use Vencord's patch helper or the devtools search to find the current `renderItem` code and update the regex.
2. **Does Discord's API accept `media_format=tinywebm` / `nanowebm`?**
   - Check the DevTools Network tab for the second `/gifs/search` request.
   - If it fails, the console shows a warning starting with `[GifPickerOptimizer] Couldn't fetch low resolution Klipy previews`.
   - Discord's own code lists these names (they date from the Tenor era), but whether the server still accepts them is unconfirmed.
   - Fallback idea: try other format names, or use `preview`/`gif_src` from the response.
3. **Tenor size codes.** They come from the Endcord/BetterGifLoad plugin's reverse-engineering. A wrong code 404s and then falls back to the original.
4. **The tile's root must be positioned.** `.vc-gpo-overlay` uses `position:absolute; inset:0` inside H's root. If the indicator shows up in the wrong place, check whether `coords` includes `position:absolute`.
5. **Progress:**
   - Video tiles should show a %.
   - Image tiles (webp, or Linux desktop) only get a spinner, because images can't report progress.
   - Discord's CSP probably blocks the `fetch()` streaming approach that would give image progress, so it wasn't attempted.
6. **Favourites:** sending a favourite must post the original URL, and adding a favourite must store the full-resolution `src`.

## Known limitations

- **Klipy favourites** (fixed in 1.2.0): Discord's add-favourite code (desktop chunk with `"favoriteGifs"` + `GIF_FAVORITED`) stores `gifSrc` (the full .gif) instead of the mp4, and proxies it through images-ext when the src is a Discord media URL. `klipy.ts` `KlipyResolver` searches `/gifs/search` for the slug of the favourite's `url` (`klipy.com/gifs/<slug>`) with `media_format` `nanowebp`/`tinywebp` (images) or the selected video family, matches by page URL, caches every result (also misses) in an LRU of 5000, and persists it (desktop: `DataStore` key `GifPickerOptimizer_klipyPreviews`; mobile: `klipy-previews.json` in the plugin's storage). Lookups run one at a time, 300 ms apart. Tiles show a spinner in the `resolving` phase meanwhile. **Unverified:** whether Discord's API accepts `nanowebp`/`tinywebp` on desktop and whether search finds the exact GIF for every slug. A miss just shows the original.
- **Proxied favourites** (fixed in 1.2.0): `unwrapProxyUrl` turns `images-ext-N.discordapp.net/external/<sig>/https/<host>/<path>` back into the source URL for Tenor, Giphy, Klipy and twimg hosts.
- **Videos without a smaller version:** Twitter `video.twimg.com` GIFs and mp4 attachments have no smaller rendition, and the media proxy can't shrink a video and keep it animated. They only get sequential loading.
- **Desktop progress:** the percentage only appears for video tiles.

## Mobile (Valenced) notes

- Plugin layout follows github.com/Valenced/valenced-plugin-template: `manifest.json` (id `thatkerimguy.gif-picker-optimizer`), `tsconfig.json` extending `../../tsconfig.base.json`, JS entry `js/index.tsx`. JS-only, no native code.
- APIs used: `plugin({ jsonStorage, start({ cleanup, jsonStorage, logger }), SettingsComponent })`, `getModuleWithImportedPath` from `@valenced/discord/utils/modules/finders`, `instead` from `@valenced/patcher`, `onFluxEventDispatched` / `Stores` from `@valenced/discord/flux` (the flux patch **must return the payload** or the event is blocked), `getModules(withProps("HTTP","get","post","put","patch","del"))` for HTTP (same as the community tenor-gif-search plugin), `Design` components and `Page` for settings.
- It patches `default` on `modules/gif_picker/native/GIFPickerItemView.tsx` using `instead`.
- It always calls the original render, which uses hooks, with the original item. Then it swaps the `Image` element in the returned tree:
  - for a queued placeholder, or
  - for a clone with the preview `source` plus `onLoad`, `onError` and `onProgress`.
- Discord mobile already uses `tinywebp`, so the default quality is S (no extra request for Klipy). Before the 1.6.0 follow-up it was XS, which requests `nanowebp`.
- **No off-screen unloading on mobile (removed):** `GIFPickerResultsList.tsx` renders a `MasonryFlashList` with `drawDistance = GIF_PICKER_ITEM_ESIMTATED_HEIGHT` (about 180 px) that unmounts and recycles tiles as you scroll. Its `viewedItemIndexes` only decides placeholder vs real tile for *mounted* tiles. (An earlier note here said it "only grows, so every tile stays loaded": wrong.) The plugin used to park tiles more than `offscreenBuffer` items outside the visible range, but FlashList had unmounted those already, so parking never kicked in. Kept: the patch on that module's `default` (`OptimizedResultsList`) wraps `onViewableItemsChanged` with a stable callback that feeds a `ViewportStore` (first/last viewable index) through React context, and tiles use it for the queue's visible-first order (`useVisibleIndex`). A URL in `loaded` shows at once (native image cache).
- **Still favourites on mobile** only work for sources `stillUrl()` covers. React Native can't pause an animated image from JS, so Klipy favourites stay animated.
- `lowres.ts` parses URLs by hand: React Native's `URL` polyfill doesn't reliably implement `searchParams.set`.
- Mobile reference source: github.com/Wumpus-Central/discord-mobile-datamining, `discord_app/modules/gif_picker/`.
- Build: copy the folder into the template's `plugins/`, `bun install`, `bun run build gif-picker-optimizer` (npm can't build the template's git-hosted CLI; use Bun). ZIP: `gradlew packageGifPickerOptimizer` (needs JDK 25 + Android SDK).

## Settings (Vencord)

| Setting | Default |
|---|---|
| quality (`xs`/`s`/`sd`/`original`) | `s` |
| sequential | on |
| concurrency | Auto (0) for new installs; existing installs keep their stored value (was 3, 1 before 1.3.1) |
| prioritizeVisible | on |
| loadTimeout | 10 s |
| showProgress | on |
| klipyLookup | on |
| cacheSize | 1000 |
| stillFavorites | off |
| favoritesOnly | off |
| fastTabSwitch (mobile only) | on |

Desktop quality also has `auto` (S, or SD at `devicePixelRatio >= 2`), not the default. Mobile defaults are the same except concurrency 3 (no Auto), and no `prioritizeVisible` (always on). Mobile quality is `s` (was `xs` before the 1.6.0 follow-up).

## Suggested next steps

1. Install on Vencord and go through the verification list above.
2. If the Klipy lookup works, compare file sizes: the Network tab's transferred size for the full vs tiny vs nano versions.
3. Consider publishing the Vencord plugin as a standalone user plugin repo layout, with a README for other users.
