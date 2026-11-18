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
9. Export the favourites, import the file with merge (toast shows the counts) and with replace (asks first). Import a file with a GIF from another site: it lists that site and asks before importing.
10. Change "GIFs at the same time" with the picker open: the next tiles follow the new number. Turn off "Load one by one": its three dependent settings disappear.
11. Settings read cleanly: headings for Previews, Loading, Favourites, Status and cache; the Patches and Cache summaries expand to details; with Auto selected, Preview size and GIFs at the same time say what Auto is using; Restore default settings asks first, then puts everything back.
12. Retries: in DevTools → Network, block a preview's domain (right click → Block request domain), open the picker, then unblock it within a few seconds: the tiles retry and load the preview, never the full size GIF. Left blocked, they end with a still, hollow ring.

### Mobile

1. Restart Discord: the plugin is still enabled, and the GIF tab works (pre-init).
2. Same as desktop 2, 4, 6 and 7 (tiles, small previews, scrolling back, restart).
3. Tenor favourites show tiny webp previews without HEAD requests to tenor.com.
4. Still favourites: Tenor favourites show PNG stills.
5. The spinner, progress line and cached shape animate smoothly, all tiles in step, same size.
6. The GIF tab opens without freezing (faster tab switch).
7. Export to the clipboard, import with merge and replace.
8. Settings: the groups read cleanly, tapping Preview size / GIFs at the same time / Skip slow GIFs after / Remembered GIFs lists the values under it, and turning off Load one by one hides the two loading rows.
9. Put the app in the background and back after loading a few new GIFs, then force close it: after a restart, those GIFs count as seen.

# Testing Chat Islands and Social Embeds

Plan and design: SOCIAL_EMBEDS_PLAN.md.

## Automatic

- `npm test` (in `tests/`) also runs `unit/social-*.test.ts` (link detection, text, HTTP client, cache, layouts, the X and Reddit resolvers against `tests/fixtures/social`) and `unit/islands.test.ts` (marker format, registry, display view, island store, pipeline).
- `npm run test:patches` also runs `patches/mobile-modules.test.ts`: the Discord mobile modules Chat Islands patches still exist with the expected exports (github.com/Wumpus-Central/discord-mobile-datamining; `DISCORD_MOBILE_REF` picks another commit).
- The resolver fixtures are hand-made until recorded: `node tests/fixtures/social/record.mjs` (see its README).
- CI builds, type-checks and pre-init-checks every plugin under `valenced/`, and compiles the native (Kotlin) parts with the template's Gradle build (`valenced-native` job).
- The Kotlin can also be compile-checked without the Android SDK: a JVM Gradle project with the Valenced API sources, DexKit, Robolectric's `android-all` jar and Xposed stubs (how it was checked on 2026-11-18; not in the repository).

## Chat Islands phase 0 (Android, by hand)

Install **Chat Islands Experimental** from the experimental repository (Valenced for Android; it has a native part, so it needs Valenced with native plugin support). Restart Discord. Logs: `adb logcat | grep -i chat-islands`.

1. Discord starts and chat works as before (pre-init, nothing broken without islands).
2. Logcat says `Hooked …AbstractDraweeControllerBuilder.build and …DraweeView.setController`. If it says a class wasn't found instead, send the line: the hook point needs to change.
3. Send a message containing `[island test]` in any channel. Below it, a card appears: "Chat Islands works", its width in dp, "on screen", a row of numbered tiles and a "Tap me" button.
   - Nothing appears: send the logcat lines mentioning chat-islands. "Unsupported row layout for islands: <class>" means the image's parent isn't a FrameLayout; send the class name.
   - An empty or broken image box appears instead: the placeholder was drawn but no island was put on it (the hook didn't fire).
4. Size: the card is fully visible, not cut off at the bottom (Discord didn't clamp the placeholder's height). If it's cut off, note the height where it stops.
5. Scroll the chat up and down quickly: the card moves exactly with the message, with no lag, flicker or blank frames.
6. Swipe the tile row sideways: it scrolls and the chat doesn't. Drag vertically starting on the card: the chat scrolls.
7. Tap "Tap me" a few times, scroll far away and back: the count is kept.
8. Long press the message outside the card, then on the card: Discord's message menu opens at least outside it (note whether it does on the card).
9. Switch light / dark / AMOLED theme: the card's colours follow.
10. Rotate the phone (or use split screen): the card is measured again at the new width.
11. Turn Chat Islands off: Discord asks to reload, and after it the message shows no card.

Write the results into SOCIAL_EMBEDS_PLAN.md (section 12, Progress), with the answers to the open questions in section 11.
