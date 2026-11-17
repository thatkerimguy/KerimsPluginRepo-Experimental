# GIFs+

A faster GIF picker for Discord, as a plugin for **Vencord** (desktop and web) and **Valenced** (mobile). GIFs load one by one as small previews, and what you send is always the full size GIF.

## Features

### Loading
- **One by one, in reading order.** GIFs load left to right and top to bottom, a few at a time, and the next starts when one finishes. GIFs on screen go first. How many load at once is up to you: on desktop **Auto** picks 2 on slow connections and up to 6 on fast ones; on mobile the default is 3.
- **Slow GIFs don't hold things up.** After a few seconds (10 by default) the next GIF starts, and the slow one keeps loading in the background.
- **Loading indicators.** A tile waiting its turn shows a breathing dot. When it starts loading, the dot grows into a spinner, which becomes a progress line with a percentage once the size is known. GIFs you've loaded before show a small morphing shape instead.
- **Remembers what loaded.** Scroll back and GIFs you've seen show at once from cache. GIFs loaded in the last two weeks go first after a restart, since they're usually still in Discord's cache. On mobile, GIFs still in the phone's image cache skip the wait entirely.

### Previews
- **Small previews, full size sends.** The picker shows an XS, S or SD version of each GIF (S by default). Clicking, tapping or favouriting a GIF still uses Discord's original, so chat and your favourites get the full size GIF.
- **Previews are retried, not swapped.** A preview that fails to load is tried again a few times. The plugin never falls back to downloading the full size GIF on its own.
- **Still favourites (optional).** Favourites show as still images instead of playing. Sent GIFs still animate.

| Source | How the preview is made |
|---|---|
| Klipy (Discord's GIF source) | A second request for the same results page in a smaller format, sent together with Discord's own. Klipy names every size differently, so the small URL can't be worked out from the full one. On mobile, S needs no extra request. |
| Klipy favourites | Looked up once by the name in the favourite's Klipy link, then saved. |
| Tenor | Tenor's own nano or tiny version. |
| Giphy | Giphy's `100w` / `200w` / `480w` versions. |
| Discord attachments and link embeds (vx/fx/twitter and others) | Discord's media proxy, resized. |
| Twitter images | Twitter's smaller sizes. |

Favourites saved from chat embeds sit behind Discord's media proxy. For Tenor, Giphy, Klipy and Twitter the plugin uses the source's own small versions instead.

| Source | Still image (still favourites) |
|---|---|
| Tenor | Tenor's poster frame |
| Giphy | Giphy's single frame version |
| Twitter GIFs | The tweet's thumbnail |
| Discord attachments and embeds | The first frame, from Discord's media proxy |
| Anything else, including Klipy | **Desktop:** the first frame, captured locally. **Mobile:** stays animated (React Native can't pause an animated image). |

### GIF picker
- **Favourites only (optional).** Hides Trending and the featured categories on the picker's main page. Search and Favorites stay.
- **Faster GIF tab switch (mobile).** The GIF tab opens at once, and the picker is built right after, instead of the app freezing for a moment.

### Favourites
- **Export and import.** Save your favourites to a file (desktop) or the clipboard (mobile), and import them on another account. Import can **merge** into your favourites or **replace** them. Imports over Discord's favourites limit are refused.
- **Safe imports.** Only `https` entries are imported. If a file has GIFs from sites other than the usual GIF hosts, the plugin lists them and asks first: a file from someone else could use your favourites to see when you open the picker, or to send a different link than the GIF shows.

### Status and cache
- **Patch status.** Settings show whether each of the plugin's hooks into Discord works. Discord changes its code often; when a hook stops matching, that part works like normal Discord, and this is where you'll see it.
- **Cache stats and reset.** See what the plugin remembers and about how much memory it uses, and reset it. Its caches are bounded: a few MB of URLs, plus up to 24 MB of still frames on desktop.
- **Theme colours.** Indicators and buttons use Discord's theme colours, so they fit light, dark and custom themes.

## Settings

| Section | Setting | Default |
|---|---|---|
| Previews | Preview size (XS, S, SD, Original; desktop also Auto) | S |
| | Small Klipy previews | On |
| | Still favourites | Off |
| Loading | Load one by one | On |
| | GIFs at the same time | Auto (desktop), 3 (mobile) |
| | On-screen GIFs first (desktop) | On |
| | Skip slow GIFs after | 10 seconds |
| | Loading indicators | On |
| GIF picker | Favourites only | Off |
| | Faster GIF tab switch (mobile) | On |
| Favourites | Export, import and merge, import and replace | |
| Status and cache | Patches, remembered GIFs (1000), cache stats, reset | |

## Install on Vencord

Vencord only loads user plugins in a build you make from source.

```bash
git clone https://github.com/Vendicated/Vencord && cd Vencord
pnpm install --frozen-lockfile
```

Copy the `vencord\gifPickerOptimizer` folder to `Vencord\src\userplugins\gifPickerOptimizer` (delete an older copy of that folder first), then:

```bash
pnpm build
```

```bash
pnpm inject
```

Enable **GIFs+** in Settings → Vencord → Plugins. Settings from the plugin's old name, GifPickerOptimizer, carry over.

## Install on Valenced

Add this URL as a plugin repository in Valenced, then install **GIFs+** from it:

```
https://thatkerimguy.github.io/KerimsPluginRepo/index.json
```

Updates come through the same repository.

### Test builds

[KerimsPluginRepo-Experimental](https://github.com/thatkerimguy/KerimsPluginRepo-Experimental) gets every change first, so its builds can be broken:

```
https://thatkerimguy.github.io/KerimsPluginRepo-Experimental/index.json
```

It installs as **GIFs+ Experimental**, next to GIFs+ and with its own saved data. Enable only one of the two.

### Build it yourself

Valenced plugins are built with the [Valenced plugin template](https://github.com/Valenced/valenced-plugin-template), which needs [Bun](https://bun.com/) and Node 22.18 or newer.

1. Set up the template:

   ```bash
   git clone https://github.com/Valenced/valenced-plugin-template
   ```

   ```bash
   cd valenced-plugin-template
   ```

   ```bash
   bun install
   ```

   This takes the newest plugin CLI and types. `.github/scripts/setup-valenced-template.sh` (bash) sets the template up with the versions this plugin is tested with instead.

2. Copy the `valenced\gif-picker-optimizer` folder into the template's `plugins` folder, so you have `plugins\gif-picker-optimizer\manifest.json`.

3. Build it. The output is `plugins\gif-picker-optimizer\build\js\index.js`:

   ```bash
   bun run build gif-picker-optimizer
   ```

   `gradlew packageGifPickerOptimizer` builds an installable ZIP. That needs the JDK and Android SDK listed in the template's README.

4. Load it in Valenced, either with `bun run serve` during development or by publishing the template repository as a plugin repository.

## Development

- The files both builds share are edited in `vencord/gifPickerOptimizer` and copied with `node .github/scripts/sync-shared.mjs` (CI fails when they differ).
- Tests and the checklist for trying a build in Discord: [TESTING.md](TESTING.md).
- Releases: the `Publish Valenced repository` workflow publishes to GitHub Pages. It builds each plugin whose `manifest.json` version isn't published yet, so bump `version` in `valenced/gif-picker-optimizer/manifest.json` to release.
- What changed and how it was checked: [CHANGELOG.md](CHANGELOG.md).

## About the code

These plugins were written with heavy AI assistance (vibecoded). If you're against full-on vibecoding, take that as you will. You're free to remake or edit the plugins yourself, with credit to this repository (https://github.com/thatkerimguy/KerimsPluginRepo), if you want to un-AI the code.

## License

[GPL-3.0-or-later](LICENSE), the same license as Vencord. You can use, change and share the code, as long as you keep the copyright and license notices and share your changes under the same license.
