# KerimsPluginRepo — handoff notes

GIFs+ (called GifPickerOptimizer before 1.6.0): a Discord GIF picker plugin with two builds. The Vencord plugin name is `GIFs+` (Vencord has a built-in `BetterGifPicker`; `migratePluginSettings` moves the old `GifPickerOptimizer` settings). The Valenced id stays `thatkerimguy.gif-picker-optimizer`, its manifest name is `GIFs+`. Source folder names and DataStore keys keep the old names.

- `vencord/gifPickerOptimizer/`: Vencord user plugin for desktop and web. **This is the one being installed and tested now.**
- `valenced/gif-picker-optimizer/`: plugin for Valenced (github.com/Valenced/valenced), a React Native mobile client mod. Replaced the old Raincord build. Not tested on a device yet.

The files listed in `.github/scripts/sync-shared.mjs` (async, cache, diagnostics, favoritesBackend, items, klipyLookups, lowResPages, lowres, persist, queue, saved, settingsText, tileLoader, tracking, transfer, tuning) are identical in `vencord/gifPickerOptimizer/` and `valenced/gif-picker-optimizer/js/`. Edit them in the Vencord folder and run `node .github/scripts/sync-shared.mjs` (CI checks it). History: CHANGELOG.md. Testing: TESTING.md.

## Experimental repository (testing)

- `C:\Work\Gifs+\experimental` is a full copy of `C:\Work\Gifs+\repo`, meant for GitHub `thatkerimguy/KerimsPluginRepo-Experimental` (Pages: `https://thatkerimguy.github.io/KerimsPluginRepo-Experimental/index.json`). Try changes there first; copy them to `repo` once they work.
- The two folders hold the **same files**. `valenced-repo.yml` switches to experimental mode by itself when the repository name ends in `-Experimental`: each push publishes `<manifest version>.<run number>` (no manifest bump needed; the CLI accepts 4-part versions), as id `thatkerimguy.gif-picker-optimizer-experimental` / name "GIFs+ Experimental" (the workflow rewrites the manifest and `PLUGIN_ID` in a build copy, and fails if the old id is left), keeps the newest 5 builds, renames the repo config and points the landing page at the experimental repo. `BASE_URL` comes from the repository name in both modes. Checked by running the build, index and landing page steps locally (jq replaced by a stand-in).
- Desktop has no install URL: copy `experimental\vencord\gifPickerOptimizer` into Vencord's `src\userplugins` instead of the `repo` one (same plugin name and settings, so never both).
- Syncing: copy changed files across (both directions). Don't hand-edit names or ids per folder; the workflow handles that.

## File layout

Shared (both builds, kept in sync by the script):
- `tuning.ts`: every timing and size the loading and caching code is tuned with (retry delays, fast lane thresholds, overtime, low-res wait and reuse, lookup limits, save delay, saved list sizes and ages). Change numbers there.
- `queue.ts`: `LoadQueue` (a `TicketHeap`: visible first, then `seenBefore`, then index). `finish(t, loadMs)` / `release(t)` (load timeout: the slot goes to the next GIF, the download continues as overtime, capped at another `concurrency`), the cache fast lane (`fastLaneOpen`: while seen-before loads take ≤ 150 ms, up to 8 more of them may start; one ≥ 400 ms or a timeout closes it), `hold()` for tickets marked `waitsForLowRes` (Klipy search results) only.
- `tileLoader.ts`: `useTileLoader(react, env, opts)`, a tile's whole load lifecycle: phases `queued` → `lookingUp` (Klipy favourite lookup, no queue slot) → `loading` → `done`, cache / seen-before shortcuts, still toggle, `enabled`, timeouts, retries (`retryDelay`), mobile's native cache probe and stall fallback (`useStallFallback`). It takes React's hooks as an argument (read at render time); `seenBefore` is known before the first render, so those tiles never flash the queued dot.
- `tracking.ts`: `createTracking(...)`: the queue, `loadedThisSession`, saved `seen` / `failed`, `apiPreviews`, `isLoadedThisSession` / `isSeenBefore` / `markLoaded` / `forgetLoaded` / `drop` / `isDropped`, the `tileEnv` for the loader and `flushSaved`. Each `state.ts` calls it and re-exports the result.
- `persist.ts`: `Persisted<T>`, the load / merge / batched save / `reset` / `close` helper behind `SavedUrlSet`, `KlipyResolver` and mobile `TenorPageResolver`. Never saves before the saved copy was read (a save replaces it). Saves are batched 15 s; `flushSaved()` saves at once when Discord closes or is hidden (desktop `beforeunload` / `visibilitychange`) or the app leaves the foreground (mobile `AppState`).
- `saved.ts`: `SavedUrlSet`, a URL LRU with expiring timestamps (`seen`, `failed`). `cache.ts`: `LruCache`, `LoadedCache`. `async.ts`: `Limiter` (n at a time, with spacing), `wait`.
- `items.ts`: `GifItem` (Discord's picker item), `isFavoriteItem`, `isFavoritesTile`.
- `lowres.ts`: URL rewrites (`rewriteUrl`, `stillUrl`, media proxy helpers), Klipy/Tenor URL helpers.
- `klipyLookups.ts`: `KlipyResolver` (favourite lookups), `klipyFavoriteFormats`. `lowResPages.ts`: `ApiPreviewCache`, `LowResPrefetcher` and `LowResPages` (search / trending low-res request alongside Discord's, `arrived` on `GIF_PICKER_QUERY_SUCCESS`; each build passes adapters in `createLowResPages`).
- `favoritesBackend.ts`: `createFavoritesBackend` (Discord's frecency favourites), sizes (`protoBytes`, `estimateBytes`, `FAVORITES_MAX_BYTES`). `transfer.ts`: export/import (`parseExport` validates and lists other sites, `otherSitesWarning`, `applyImport`, `importFavorites`, `importSummary`).
- `diagnostics.ts`: which patches are seen working (`expectPatch` / `patchWorks` / `patchFailed`, `summarizePatches`, `PATCHES_NOTE`), shown in settings as "Patches".
- `settingsText.ts`: every word in both settings screens (`SECTIONS`, `TEXT`, `QUALITY_CHOICES` with rough pixel widths, `RESTORE_DEFAULTS_CONFIRM`) and the cache figures (`CacheNumbers` → `cacheStatRows` / `cacheSummary`), so desktop and mobile read the same. Change wording there, not in the builds.

Vencord (`vencord/gifPickerOptimizer/`):
- `index.tsx`: `definePlugin`, flux handler, start/stop (queue settings, connection listener, flush on close / hidden, expected patches). `patches.ts`: the webpack patches as plain data (tested against Discord's code).
- `settings.tsx`: settings in sections (Previews, Loading, GIF picker, Favourites, Status and cache; the headings are value-less component settings from `SettingsHeader.tsx`), each with a `displayName` and wording from `settingsText.ts`; Preview size and GIFs at the same time have description getters that say what Auto is using right now; GIFs at the same time, On-screen GIFs first and Skip slow GIFs after are `hidden` while Load one by one is off. Also `quality()`, `applyQueueSettings` (on start, setting change, connection change), `loadConcurrency`. `CacheSettings.tsx`: `PatchesSettings` and `CacheSettings` (one-line summary, details in an `ExpandableSection`; the cache one also has the reset button). `RestoreDefaults` (in settings.tsx, to avoid an import cycle) puts every option back to its `default` after a confirmation.
- `state.ts`: `createTracking(...)` exports, `runtime` (`KlipyResolver`, `LowResPages` while running), DataStore keys. `preconnect.ts`: `<link rel=preconnect>` to a GIF host when a tile queues (the loader's `warmUp`), at most every 10 s per host.
- `previews.ts`: `pickSrc`, `pickStill`, `createLowResPages`, `lowResStarted`, Klipy favourite lookups.
- `GifTile.tsx`: the tile (shared loader). `components.tsx`: `Indicator`, `LoadOverlay` (probe image only while loading; a tile shown from cache listens for its own `<img>` error), `StillTile`. `stillFrames.ts`: frame capture and its LRU. `viewport.ts`: `ViewportWatcher` / `useViewport` (on-screen state for queue priority).
- `favoritesOnly.ts`: helpers called from patches. `favorites.ts`: `favoritesBackend`, `favoriteItems()`. `FavoritesSettings.tsx` (export to a file, import with one confirmation for replace and other sites), `types.ts` (tile props).

Valenced (`valenced/gif-picker-optimizer/js/`):
- `index.tsx`: `plugin({...})` and the start wiring (`runtime.*`, saved lists, expected patches, `AppState` flush). `patches.tsx`: every patch and module lookup (`applyPatches(cleanup)`).
- `settingsStore.ts`: settings storage, hooks, `cacheControl` (cache figures and reset while running). `settings.tsx`: settings page in groups (Previews, Loading, GIF picker, Favourites, Status and cache, then Restore default settings with a confirmation), wording from `settingsText.ts`; multi-value settings are one row with the current value that lists the values under it when tapped (`choiceRows`, one open at a time, plain rows so the group draws them); Patches and Cache show a summary row that expands. `cacheStats.ts`: `cacheNumbers`, `resetCaches`.
- `state.ts`: `createTracking(...)` exports, `runtime`, `applyQueueSettings`. `nativeCache.ts`: `isNativeCached` (batched `Image.queryCache`). `tenor.ts`: `TenorPageResolver` (fallback only). `previews.ts`: `pickSrc`, `lookupFor`, `createLowResPages`, Tenor media from the saved src.
- `viewport.tsx`: `ViewportStore`, `OptimizedResultsList` (also applies queue settings), `useVisibleIndex`. `tile.tsx`: `GifTile` (shared loader; `enabled` = Discord's tree has the Image, found once with `findInTree`, swapped with `replaceAt`). `indicator.tsx`: the animated `Indicator` (shared loops, `useTransition`). `tree.ts`: typed tree helpers. `picker.tsx`: deferred picker and the categories page switch.
- `modules.ts`: `pickerModules`. `favorites.ts`: `favoritesBackend`. `alerts.tsx` (toast, confirm alert), `mainPage.tsx`, `favoritesSettings.tsx` (export to clipboard/share, import from clipboard).

Repo: `tests/` (Node tests, TESTING.md), `.github/scripts/` (`sync-shared.mjs`, `setup-valenced-template.sh`, `preinit-check.cjs`), `.github/workflows/` (`checks.yml`, `valenced-repo.yml`).

## What the user asked for

1. Load GIFs one at a time, left to right and top to bottom. Each one finishes before the next starts.
2. Show a loading or progress indicator on tiles that haven't loaded.
3. Show low-resolution previews in the picker: XS/S/SD on Klipy and Tenor, and smaller versions of vx/fx/twitter and Discord links. The full-resolution GIF must still be what gets sent to chat.
4. Port the mobile build from Raincord to Valenced.
5. Big favourite libraries should perform well on mobile and desktop: on-screen GIFs first, with caching. (Off-screen unloading was built, then removed: Discord's lists already unmount tiles that scroll away.)
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
- The patch replaces `H` with `$self.GifTile` and passes `Result:H` and `resultType:this?.props?.resultType` (the list's `resultType`, used to detect the favourites tab).
- Match: `/(\(0,\i\.jsx\)\()(\i),\{(?=item:(\i),index:\i,format:\3\.format,src:\3\.src)/`. This was checked against the datamined code.
- Reference copy of Discord's code: github.com/Wumpus-Central/discrapper-canary, `chunks/884037.js` (the picker) and `chunks/821102.js` (GIFPickerViewStore). Chunk IDs change between Discord builds, so search by string instead of chunk ID.
- How tile `H` loads:
  - Images: preloaded on a detached pooled `<img>`, then an `<img>` is rendered once `onload` fires.
  - Videos: in `componentDidMount`, a pooled `<video>` (`preload=auto`, autoplay) is added to the tile.
  - In both cases `H` reads `src` from props.

### `GifTile` phases

1. **queued**: renders its own placeholder `div` (`.vc-gpo-tile`, `style={coords}`) instead of `H`, so nothing downloads yet. Clicking the placeholder calls `onClick(item)`, so it still sends.
2. **loading**: when the queue says go, it picks the preview URL with `pickSrc` and renders `H` with `src=preview` and `key=preview`. `renderExtras` is wrapped to add `LoadOverlay` inside H's root element.
   - `LoadOverlay` attaches capture-phase listeners (`progress`, `canplay`, `error`) to the parent element for videos. Progress is `buffered / duration`. A video counts as done on `canplay` (or `readyState >= 3`), like Discord's tile `H`, which shows its video in `handleCanPlay` (`oncanplay`). Until 1.6.0 it waited for `canplaythrough`, which comes later and held the queue slot longer. `StillTile` uses `loadeddata`, which is earlier still.
   - For images it loads the same URL in a probe `Image()`. The browser shares the request, so it doesn't download twice.
3. **done**: `H` is rendered as normal.

**No off-screen unloading (removed after 1.6.0 testing):**
- Checked in real Discord (2026-11-17, by the user): tiles leave the DOM when you scroll away, with the plugin's unloading off. Discord's results list (`W` in the `renderEmptyFavorite` module) is a virtualized masonry list (`y.f`, `chunkSize: 128`) with pooled `<img>`/`<video>` elements, so the plugin's own parking (`unloadOffscreen`, `offscreenMargin` 800 px, a second "near" watcher) added little and was removed. Old saved values are ignored.
- When Discord unmounts a tile, its ticket is dropped on unmount, so off-screen GIFs that haven't started don't download. When the tile comes back, a URL in `loadedThisSession` shows at once from the HTTP cache.
- One `ViewportWatcher` remains: "visible" (50 px, feeds queue priority), rooted on the picker's scroll container (`findScroller`), because rooted on the window `rootMargin` does nothing. The watched element is the placeholder, the still tile, or `.vc-gpo-sentinel`, an `inset:0` div rendered through `renderExtras` inside H.

**Still favourites (`stillFavorites`):**
- Favourites are detected by `resultType` matching /favou?rite/ or, as a fallback, items with a numeric `order` and no `id` (frecency favourites have that shape on desktop and mobile).
- `stillUrl()` in `lowres.ts` gives a still rendition when the source has one: Tenor PNG posters (`Ag`/`AN`/`Ae`/`AD`, checked against the Tenor API), Giphy `_s` renditions, `video.twimg.com/tweet_video` → `pbs.twimg.com/tweet_video_thumb`, and Discord's media proxy without `animated=true` (`format=jpeg` for videos).
- Otherwise (Klipy, etc.) `StillTile` loads the preview, captures the first frame with `createImageBitmap` (falling back to a canvas copy), draws it with object-fit cover, and releases the element. Frames are kept in an LRU (`frames`, 300).
- Still tiles are the plugin's own div (like the placeholder), not H. Clicks and the context menu still go to Discord's handlers with the original item.
- Fallback chain on error: still URL (retried) → low-res preview (frame captured, retried). Never the original.

**Errors and timeouts:**
- A preview that fails is retried after 1, 3 and 9 s (one quick retry when it failed for good before: `failedBefore`, from the saved `failed` list; a load that works removes it from that list) (`RETRY_DELAYS_MS` in tuning.ts; the queue slot is freed meanwhile, and `attempt` goes into the element key so the same URL loads again). Then a still image falls back to the animated preview; anything else gives up (`gaveUp`: a still, hollow ring) and tries again when the tile comes back. The full size original is never loaded instead (the user's call, 2026-11-17). The saved `failed` list only steers stills to the preview now; `pickSrc` ignores it.
- After `loadTimeout` seconds, the queue slot is freed while the GIF keeps loading.
- If the component throws, the ErrorBoundary fallback renders the original tile.

### Queue (`queue.ts`)

- Ordering:
  - Tiles on screen come first (an IntersectionObserver feeds this).
  - Then item **index**: the masonry layout places items in index order, so index is the true reading order. Pixel tops in a masonry grid are staggered and give the wrong order.
- Then `seenBefore` tickets (GIFs in `seen`, loaded in an earlier session) before the others with the same visibility, then index. Only `isLoadedThisSession` skips the queue: a seen URL may have been evicted by Chromium or Fresco since, and trusting it made them all download at once (that happened with precaching, removed on 2026-11-17).
- `hold()` keeps Klipy search tiles (`waitsForLowRes`) waiting while the small versions of their results page are in flight (3-second cap), so they don't start the full-size files meanwhile. Other tiles (Tenor, Discord links, favourites) carry on. With the early request (below) it only holds for whatever is still in flight when Discord's results arrive, and only for what's left of 3 s since the request started.
- Load timeout: the slot goes to the next GIF (`release`) and the slow one keeps downloading as overtime. Overtime plus active downloads are capped at 2 × `concurrency` (overtime entries stop counting after 60 s).
- Cache fast lane: `finish(ticket, loadMs)` reports load times. While seen-before (`seenBefore`) GIFs load in ≤ 150 ms (they come from the cache), up to 8 of them may run past the limit. One taking ≥ 400 ms, or timing out, closes the lane: the cache had dropped it, so it really downloaded (the problem precaching had).
- Concurrency (desktop): a dropdown (Auto, 1–6; a slider's "Auto" marker label wrapped), 0 = **Auto** (default for new installs): `navigator.connection` → 2 on `slow-2g`/`2g`/`3g` or `saveData`, 6 on `4g` with `downlink >= 5`, 4 with `downlink >= 2`, else 3 (also when the API is missing). `loadConcurrency()` in `settings.tsx`. Vencord writes a default into settings the first time it's read, so existing installs keep their stored 3. Mobile has no such API: 3 by default.

### Low-res sources

**Klipy** (`LowResPages`, `LowResPrefetcher` in lowResPages.ts):
- Klipy gives every size a random file name, so the URL can't be rewritten.
- Discord's search (`y` in the desktop actions chunk, find `"GIF_PICKER_QUERY_SUCCESS",query:`; mobile `doSearchRequest` in `actions/GIFPickerActionCreators.tsx`) is one request, debounced 250 ms, `{q, media_format: getSelectedFormat(), locale, limit}`; no paging. Trending is `Z4` / `fetchTrendingGIFs(limit)` on `/gifs/trending-gifs`.
- The plugin's request starts at the same time as Discord's: desktop patches `y` and `Z4` to call `$self.lowResStarted(query, limit)` right before `o.Bo.get({url:…GIFS_SEARCH…` / `…GIFS_TRENDING_GIFS…` (regexes tested against an esbuild-minified copy of `c497685.js` in the scratch `re/` folder). Mobile wraps the exported `search(query, type, immediate, limit)` (with its own 250 ms debounce unless `immediate`, mirroring Discord's; an empty query doesn't cancel it, like Discord) and `fetchTrendingGIFs(limit)` with `instead`. Requests are keyed by query + format; one that worked is reused for 5 minutes.
- On `GIF_PICKER_QUERY_SUCCESS` (a flux handler), `LowResPages.arrived` asks the prefetcher for that query. In flight → the queue is blocked until it settles (3 s cap from its start). Done → nothing. None started or it failed (patch didn't apply, settings changed) → the old way: a GET on `/gifs/search` (or `/gifs/trending-gifs` when there's no query) now, with the queue blocked.
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

## Rules (each one came from a bug; details in CHANGELOG.md)

- **Never touch the data, only what's displayed.** Item objects and favourites are never changed; only the URL a tile shows (see below).
- **Shared files:** edit them in `vencord/gifPickerOptimizer/`, then run `node .github/scripts/sync-shared.mjs` (it holds the list; CI runs it with `--check`).
- **No hardcoded colours:** everything follows the theme (desktop CSS variables such as `--text-muted`, `--background-mod-subtle`, `--control-primary-background-default`; mobile `Tokens`). Not `--brand-500` or `--control-overlay-*` (fixed colours, invisible on light themes).
- **Desktop: never copy an `@webpack/common` value at module level** (`const hooks = { useState, ... }`). They're `export let` bindings filled in by `waitFor` once Discord's modules load, after plugins are evaluated, so the copy holds `undefined` and every tile falls back to Discord's own. Read them at render / call time. `tests/unit/vencord-module-level.test.ts` checks it.
- **Mobile: nothing from `@valenced/discord/*`, `react` or `react-native` may run at module level** (only inside functions, or through `lazy`). Valenced evaluates the script at pre-init, before those exist, and turns the plugin off after a throw until it's reinstalled. `@valenced/json-storage` and `@valenced/patcher` are fine. Every `.tsx` starts with the classic JSX pragma (`lazy.ts` explains). `preinit-check.cjs` checks a build.
- **Mobile: never write `<React Native export>.<React Native name>`** (`Animated.View`): the build rewrites React Native names even after a dot. Use `Animated.createAnimatedComponent(View)`. `preinit-check.cjs` fails such a bundle.
- **Mobile: never use a React or React Native import as a shorthand object key** (`{ useState, useEffect }`): the build rewrites it there too and the bundle doesn't parse. Pass the `React` namespace instead (tile.tsx).
- **Mobile: never remove a native-driven animated style from a view that stays mounted** (React Native leaves the view at the last native value). Shared native loops reset their value to 0 when they restart.
- **Mobile: the flux patch must return the payload**, or the event is blocked.
- **Imports are untrusted:** `parseExport` only takes https entries, and any site outside the known GIF hosts is shown to the user before importing (`otherSitesWarning`).

## Tests and verification

- `tests/` (Node 22.18+): `npm ci`, then `npm test` (unit tests for the shared files, the tile loader with React, the desktop module-level check) and `npm run test:patches` (the Vencord patches against Discord's current datamined code). See TESTING.md.
- CI (`.github/workflows/checks.yml`): shared files in sync, unit tests, Discord patches (also weekly), Vencord type check against Vencord's latest source, Valenced build + type check + pre-init check with the pinned toolchain (`.github/scripts/setup-valenced-template.sh`).
- Not covered by anything automatic: how it behaves in real Discord and on a device. TESTING.md has the smoke checklist to run on each experimental build; record results in CHANGELOG.md.

## Known limitations

- **Klipy favourites**: Discord's add-favourite code (desktop chunk with `"favoriteGifs"` + `GIF_FAVORITED`) stores `gifSrc` (the full .gif) instead of the mp4, and proxies it through images-ext when the src is a Discord media URL. `klipyLookups.ts` `KlipyResolver` searches `/gifs/search` for the slug of the favourite's `url` (`klipy.com/gifs/<slug>`) with `media_format` `nanowebp`/`tinywebp` (images) or the selected video family, matches by page URL, caches every result (also misses) in an LRU of 5000, and persists it (desktop: `DataStore` key `GifPickerOptimizer_klipyPreviews`; mobile: `klipy-previews.json` in the plugin's storage). Two lookups run at a time (`Limiter`), each freeing its place 300 ms after it ended. A tile waiting for its lookup (`lookingUp`, spinner) holds no queue slot and queues again once the lookup settled; a slow lookup no longer times out into loading the full size original. **Unverified:** whether Discord's API accepts `nanowebp`/`tinywebp` on desktop and whether search finds the exact GIF for every slug. A miss just shows the original.
- **Proxied favourites**: `unwrapProxyUrl` turns `images-ext-N.discordapp.net/external/<sig>/https/<host>/<path>` back into the source URL for Tenor, Giphy, Klipy and twimg hosts.
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
- **No off-screen unloading on mobile (removed):** `GIFPickerResultsList.tsx` renders a `MasonryFlashList` with `drawDistance = GIF_PICKER_ITEM_ESIMTATED_HEIGHT` (about 180 px) that unmounts and recycles tiles as you scroll. Its `viewedItemIndexes` only decides placeholder vs real tile for *mounted* tiles. (An earlier note here said it "only grows, so every tile stays loaded": wrong.) The plugin used to park tiles more than `offscreenBuffer` items outside the visible range, but FlashList had unmounted those already, so parking never kicked in. Kept: the patch on that module's `default` (`OptimizedResultsList`) wraps `onViewableItemsChanged` with a stable callback that feeds a `ViewportStore` (first/last viewable index) through React context, and tiles use it for the queue's visible-first order (`useVisibleIndex`). A URL in `loadedThisSession` shows at once (native image cache).
- **Still favourites on mobile** only work for sources `stillUrl()` covers. React Native can't pause an animated image from JS, so Klipy favourites stay animated.
- `lowres.ts` parses URLs by hand: React Native's `URL` polyfill doesn't reliably implement `searchParams.set`.
- Mobile reference source: github.com/Wumpus-Central/discord-mobile-datamining, `discord_app/modules/gif_picker/`.
- Build: `bash .github/scripts/setup-valenced-template.sh template` (pinned template, CLI and types; Git Bash or WSL on Windows), copy the plugin folder into `template/plugins/`, then `bun run build gif-picker-optimizer` in `template` (Node 22.18+ on PATH). ZIP: `gradlew packageGifPickerOptimizer` (needs JDK 25 + Android SDK).

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

1. Run the TESTING.md smoke checklist on the next experimental build (desktop and mobile) and record the results in CHANGELOG.md.
2. If the Klipy lookup works, compare file sizes: the Network tab's transferred size for the full vs tiny vs nano versions.
3. Consider publishing the Vencord plugin as a standalone user plugin repo layout, with a README for other users.
