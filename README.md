# GIFs+

A plugin for **Vencord** (desktop/web) and **Valenced** (mobile) that changes Discord's GIF picker. It was called GifPickerOptimizer before 1.6.0; your settings carry over.

- **Sequential loading.** GIFs load in reading order, left to right and top to bottom, a few at a time. The next one starts only when one of them has finished loading (for videos, as soon as they can play, like Discord's own tiles). On desktop the limit is **Auto** by default: 2 on slow connections, up to 6 on fast ones, from the browser's connection speed estimate. You can set it from 1 (strictly one at a time) to 6 instead. On mobile it's 3 by default (1 to 6).
- **Loading indicator.** Empty tiles show a breathing dot while they wait their turn. When a tile starts loading, the dot grows into a spinner, which turns into a progress line with a percentage once the download size is known. GIFs that load from cache (precached or seen before) show a small shape morphing between a circle and a square instead.
- **Low-resolution previews.** The picker shows an XS, S or SD version of each GIF. Clicking, tapping or favouriting a GIF still uses Discord's original item, so chat and your favourites always get the full-resolution GIF.
- **Small memory footprint.** The plugin's caches are bounded: a few MB of URLs at most, plus up to 24 MB of still frames on desktop (only with still favourites on), captured at tile size.
- **Cache stats and reset.** The plugin's settings show what's cached (remembered GIFs, saved Klipy and Tenor lookups, still frames) and about how much memory it uses, with a button to reset it.
- **Patch status.** Settings → **Patches** shows which of the plugin's hooks into Discord are working. Discord changes its code often; when a hook stops matching, that part falls back to Discord's own behaviour, and this is where you'll see it.
- **Scrolling back is instant.** Discord's GIF list already unloads GIFs you scroll far away from. The plugin remembers which ones finished loading, so when you scroll back they show straight from cache instead of waiting in the load queue, and GIFs that scrolled away before their turn never download.
- **Remembers across restarts.** GIFs that loaded before (in the last two weeks) go first in the queue without a spinner after you restart Discord, since they're usually still in Discord's cache. Previews that failed aren't tried again for a week. On mobile, GIFs still in the device's image cache skip the queue entirely.
- **Still favourites (optional, off by default).** The favourites tab shows still images instead of playing GIFs. The GIF you send still animates.
- **Favourites only (optional, off by default).** Hides Trending GIFs and the other featured categories from the GIF picker's main page. The main page keeps the search bar (all GIFs) and the Favorites category, which opens your favourites with their own search, like normal Discord. The featured categories aren't fetched at all.
- **Precaching.** A **Precache** button in settings (and on desktop, on the Favorites page) downloads the previews of all your favourites ahead of time. It shows progress and can be stopped. Precached GIFs go first in the load queue and show no spinner, since they normally come straight from the cache. If Discord's cache has dropped one since, it downloads again like any other GIF, in order, instead of all at once.
- **Export and import.** Export your favourites as a file (desktop) or text (mobile), and import them on another account. The file has one GIF per line, so it's easy to read or edit. Import can **merge** into your favourites or **replace** them. Favourites can only hold about 750 KB in total (Discord's limit), so an import that would go over it is refused. Only `https` entries are imported, and if a file has GIFs from sites other than the usual GIF hosts (Tenor, Giphy, Klipy, Discord, Twitter, Imgur), the plugin lists those sites and asks first: a file from someone else could otherwise use your favourites to see when you open the GIF picker, or to send a different link than the GIF shows.
- **Theme colours.** The plugin's indicators and buttons use Discord's theme colours, so they fit light, dark and custom themes.
- **Faster GIF tab switch (mobile, on by default).** Discord builds the whole GIF picker in the same frame as the tab switch, so switching from emojis to GIFs freezes for a moment. The plugin switches the tab first and builds the picker right after.

| Source | How the preview is made |
|---|---|
| Klipy (Discord's default) | One extra call to Discord's own `/gifs/search` or `/gifs/trending-gifs` per results page, using a smaller `media_format` (`tinywebm`/`nanowebm` on desktop; on mobile only XS needs one, `nanowebp`, since Discord mobile already asks for `tinywebp`). The call starts at the same time as Discord's own, so GIFs only wait for it if it's still running when Discord's results arrive (3 seconds at most). Klipy gives every size a random file name, so the small URL can't be worked out from the full one. |
| Klipy favourites | Discord stores these as the full-size `.gif`. The plugin searches Discord's `/gifs/search` once for the slug in the favourite's `klipy.com/gifs/<slug>` link, asking for a small webp, and keeps the match whose page URL is the same. Results are saved, so each favourite is only looked up once. |
| Tenor | URL rewrite to Tenor's nano/tiny mp4 or animated webp. Discord mobile shows Tenor favourites as their page URL, so there the plugin uses the media URL saved with the favourite (no extra request); only when that isn't a Tenor URL does it follow the page's redirect once. |
| Giphy | URL rewrite to `100w`/`200w`/`480w` |
| Discord attachments, `media.discordapp.net`, `images-ext-*` (vx/fx/twitter and other embeds) | Discord media proxy with `width`, `height`, `format=webp` and `animated=true` |
| `pbs.twimg.com` | `name=240x240` / `360x360` / `small` |

Favourites saved from chat embeds are stored behind Discord's `images-ext` media proxy. For Tenor, Giphy, Klipy and Twitter links the plugin unwraps the proxy and uses the source's own small renditions.

If a preview fails to load, the tile falls back to the original URL.

### Where still favourites come from

| Source | Still image |
|---|---|
| Tenor | Tenor's PNG poster frame |
| Giphy | Giphy's single-frame `_s` rendition |
| Twitter GIFs (`video.twimg.com/tweet_video`) | The matching `pbs.twimg.com/tweet_video_thumb` image |
| Discord attachments and embeds | Discord's media proxy without `animated=true` (first frame), or `format=jpeg` for videos |
| Anything else, including Klipy | **Desktop:** the first frame is drawn onto a canvas and the GIF is released. **Mobile:** stays animated, because React Native can't pause an animated image from JavaScript. |

## Vencord

Vencord only loads user plugins in a build you make from source.

```bash
git clone https://github.com/Vendicated/Vencord && cd Vencord
pnpm install --frozen-lockfile
```

Copy the `vencord\gifPickerOptimizer` folder to `Vencord\src\userplugins\gifPickerOptimizer`, then:

```bash
pnpm build
```

```bash
pnpm inject
```

Enable **GIFs+** in Settings → Vencord → Plugins. The default quality is **S**. **Auto** picks S, or SD on screens with 2× pixel density or more (the picker's tiles are about 200 px wide).

GIFs loading at the same time defaults to **Auto** on new installs. Vencord saves a setting's default the first time it's read, so if you used the plugin before, pick **Auto** in the "GIFs loading at the same time" dropdown yourself to switch.

Vencord already has a built-in plugin called BetterGifPicker, so this one is called GIFs+. If you used GifPickerOptimizer before, your settings move over by themselves.

## Valenced

### Install from the plugin repository

Add this URL as a plugin repository in Valenced, then install **GIFs+** from it:

```
https://thatkerimguy.github.io/KerimsPluginRepo/index.json
```

Updates come through the same repository. The `Publish Valenced repository` workflow publishes it to GitHub Pages: on every push to `main` that changes `valenced/`, it builds any plugin whose `manifest.json` version isn't published yet. To release a change, bump `version` in `valenced/gif-picker-optimizer/manifest.json`.

### Test builds

[KerimsPluginRepo-Experimental](https://github.com/thatkerimguy/KerimsPluginRepo-Experimental) is a copy of this repository for trying changes before they're released. Every push there publishes a new build, so it can be broken:

```
https://thatkerimguy.github.io/KerimsPluginRepo-Experimental/index.json
```

It installs as **GIFs+ Experimental**, next to GIFs+ and with its own saved data. Enable only one of the two at a time.

### Build it yourself

Valenced plugins are built with the [Valenced plugin template](https://github.com/Valenced/valenced-plugin-template). The template needs [Bun](https://bun.com/) to build.

1. Clone the template and install its dependencies:

   ```bash
   git clone https://github.com/Valenced/valenced-plugin-template
   ```

   ```bash
   cd valenced-plugin-template
   ```

   ```bash
   bun install
   ```

2. Copy the `valenced\gif-picker-optimizer` folder into the template's `plugins` folder, so you have `plugins\gif-picker-optimizer\manifest.json`.

3. Build the JS bundle. The output is `plugins\gif-picker-optimizer\build\js\index.js`:

   ```bash
   bun run build gif-picker-optimizer
   ```

   To build the installable ZIP (`build\dist\thatkerimguy.gif-picker-optimizer@1.6.0.zip`), run `gradlew packageGifPickerOptimizer`. That needs the JDK and Android SDK listed in the template's README.

4. Load it in Valenced, either with `bun run serve` during development or by publishing the template repository as a plugin repository and adding its URL in Valenced.

Then enable **GIFs+** in Valenced's plugin list. The default quality is **S**: Discord mobile already loads the S (`tinywebp`) rendition of Klipy GIFs, so S needs no extra request. XS adds one request per search and shows about 90 px previews on tiles that are several times wider on a phone screen.

## Development

- The files both builds share are edited in `vencord/gifPickerOptimizer` and copied with `node .github/scripts/sync-shared.mjs` (CI fails when they differ).
- Tests: see [TESTING.md](TESTING.md) (`cd tests`, `npm ci`, `npm test`), including a check of the Vencord patches against Discord's current code and a checklist for trying a build in Discord.
- CI builds the Valenced plugin with the template, plugin CLI and types pinned to tested commits (`.github/scripts/setup-valenced-template.sh`). A plain `bun install` in the template, as above, takes their latest versions.
- [CHANGELOG.md](CHANGELOG.md) has what changed and how it was checked.

## About the code

These plugins were written with heavy AI assistance (vibecoded). If you're against full-on vibecoding, take that as you will. You're free to remake or edit the plugins yourself, with credit to this repository (https://github.com/thatkerimguy/KerimsPluginRepo), if you want to un-AI the code.

## License

[GPL-3.0-or-later](LICENSE), the same license as Vencord. You can use, change and share the code, as long as you keep the copyright and license notices and share your changes under the same license.
