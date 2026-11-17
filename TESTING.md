# Testing GIFs+

## Automatic

Needs Node 22.18 or newer. From the repository root:

```bash
cd tests
npm ci
npm test
npm run test:patches
```

- `npm test` runs `tests/unit`: the shared files (queue, URL rewrites, saving, import/export with its validation, low-res pages, the patch diagnostics), the shared tile loader with React (order, seen-before tiles on the first render, still toggle, a tile losing its Image mid-lookup, error fallback, native cache), and the Vencord module-level check (no `@webpack/common` value read when the plugin loads).
- `npm run test:patches` downloads Discord's current datamined code (github.com/Wumpus-Central/discrapper-canary) and checks that every Vencord patch still finds its module, matches exactly once and leaves valid code. Set `DISCORD_REF` to test against an older datamine commit. When a find string moved to another chunk, search the datamine for it and update `CHUNKS` in `tests/patches/patches.test.ts`.
- Shared files: `node .github/scripts/sync-shared.mjs --check`.

CI (`.github/workflows/checks.yml`) runs all of that on every push, the patch check also every Monday, plus a Vencord type check against Vencord's latest source and the Valenced build, type check and pre-init check with the pinned toolchain.

## By hand, on each experimental build

Nothing automatic covers how the plugin behaves inside Discord. Go through this on desktop (Vencord, built from the experimental folder) and on a device (Valenced, the experimental repository), then add the results to CHANGELOG.md.

First, open the plugin's settings → **Patches**. Do what each "not seen yet" line says; every line should end up "Working". One that doesn't means Discord changed that code.

### Desktop

1. No Vencord patch warning for GIFs+ in the console (Ctrl+Shift+I).
2. Search for something: tiles fill in left to right, top to bottom, a few at a time, each with the breathing dot, then a spinner (videos: a progress line and %).
3. Network tab: our `/gifs/search?…media_format=tinywebm` (or `nanowebm` / `tinywebp`) request goes out together with Discord's, not after it. If it fails, the console shows `Couldn't fetch low resolution Klipy previews`.
4. Previews are small (Network tab sizes), and sending a GIF posts the full resolution one.
5. Favourites: sending a favourite posts its original URL; adding a favourite stores the full resolution `src` (export and look at it).
6. Scroll down and back up: GIFs you already saw show at once, with no spinner.
7. Restart Discord, open the favourites: GIFs seen before show the morphing shape (no dot first) and load first.
8. Settings → Still favourites on: favourites show still images; clicking one sends the animated GIF. Turn it off with the picker closed and open it again: everything loads.
9. Favourites only: the main page shows search and Favorites, no Trending.
10. Export the favourites, import the file with merge (toast shows the counts) and with replace (asks first). Import a file with a GIF from another site: it lists that site and asks before importing.
11. Change "GIFs at the same time" with the picker open: the next tiles follow the new number. Turn off "Load one by one": its three dependent settings disappear.
12. Settings read cleanly: headings for Previews, Loading, GIF picker, Favourites, Status and cache; the Patches and Cache summaries expand to details; with Auto selected, Preview size and GIFs at the same time say what Auto is using; Restore default settings asks first, then puts everything back.
13. Retries: in DevTools → Network, block a preview's domain (right click → Block request domain), open the picker, then unblock it within a few seconds: the tiles retry and load the preview, never the full size GIF. Left blocked, they end with a still, hollow ring.

### Mobile

1. Restart Discord: the plugin is still enabled, and the GIF tab works (pre-init).
2. Same as desktop 2, 4, 6 and 7 (tiles, small previews, scrolling back, restart).
3. Tenor favourites show tiny webp previews without HEAD requests to tenor.com.
4. Still favourites: Tenor favourites show PNG stills.
5. The spinner, progress line and cached shape animate smoothly, all tiles in step, same size.
6. The GIF tab opens without freezing (faster tab switch), and Favourites only works.
7. Export to the clipboard, import with merge and replace.
8. Settings: the groups read cleanly, tapping Preview size / GIFs at the same time / Skip slow GIFs after / Remembered GIFs lists the values under it, and turning off Load one by one hides the two loading rows.
9. Put the app in the background and back after loading a few new GIFs, then force close it: after a restart, those GIFs count as seen.
