/*
 * GIFs+ for Vencord (named GifPickerOptimizer before 1.6.0)
 *
 * - Loads GIF picker results one at a time, in reading order (left to right,
 *   top to bottom), waiting for each one to finish before starting the next.
 * - Shows a loading / progress indicator on tiles that are still empty.
 * - Shows a lower resolution preview in the picker (XS / S / SD) while still
 *   sending and favouriting the original, full resolution GIF.
 * - Remembers which GIFs loaded (also across restarts), so they show again
 *   without waiting in the queue, and big favourite libraries stay smooth.
 * - Precaches favourites, and exports / imports them.
 * - Optionally shows still (not animated) previews in the favourites tab.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { migratePluginSettings } from "@api/Settings";
import definePlugin from "@utils/types";
import { LocaleStore, RestAPI } from "@webpack/common";

import { precacheOptions } from "./favorites";
import { featured, mountCategories, needsCategories } from "./favoritesOnly";
import { FavoritesSettings } from "./FavoritesSettings";
import { KlipyResolver } from "./klipy";
import { Precacher } from "./precache";
import { renderPrecacheButton } from "./precacheUi";
import { createLowResPrefetcher, lookupLowRes, lowResStarted } from "./previews";
import type { UrlListStore } from "./saved";
import { SequentialResult } from "./SequentialResult";
import { settings } from "./settings";
import { failed, FAILED_STORE_KEY, KLIPY_STORE_KEY, loaded, logger, OLD_PLUGIN_NAME, PLUGIN_NAME, runtime, seen, SEEN_STORE_KEY, settingsPanels } from "./state";
import { frames } from "./stillFrames";
import managedStyle from "./styles.css?managed";
import type { GifItem } from "./types";
import { disconnectWatchers } from "./viewport";

migratePluginSettings(PLUGIN_NAME, OLD_PLUGIN_NAME);
settingsPanels.favorites = () => <FavoritesSettings />;

/** A saved URL list ([url, when] pairs) in Vencord's DataStore */
function savedList(key: string): UrlListStore {
    return {
        load: () => DataStore.get<[string, number][]>(key),
        save: entries => void DataStore.set(key, entries),
    };
}

export default definePlugin({
    name: PLUGIN_NAME,
    description: "A better GIF picker: one-by-one loading with low resolution previews, unloading off-screen GIFs, precaching and exporting / importing favourites. Sends the full resolution GIF.",
    authors: [{ name: "thatkerimguy", id: 0n }],
    settings,
    managedStyle,

    patches: [
        {
            // GIF picker results list (masonry of GIF tiles)
            find: "renderEmptyFavorite",
            replacement: {
                match: /(\(0,\i\.jsx\)\()(\i),\{(?=item:(\i),index:\i,format:\3\.format,src:\3\.src)/,
                replace: "$1$self.SequentialResult,{Result:$2,resultType:this?.props?.resultType,",
            },
        },
        {
            // GIF picker actions: search (`y`, debounced 250 ms) and trending GIFs (`Z4`).
            // The low resolution request for Klipy previews starts together with Discord's.
            // Without this patch, it's sent once Discord's results arrive (lookupLowRes).
            find: '"GIF_PICKER_QUERY_SUCCESS",query:',
            replacement: [
                {
                    match: /(?=\i\.\i\.get\(\{url:\i\.\i\.GIFS_SEARCH,query:\{q:(\i),media_format:[^}]*?limit:(\i)\})/,
                    replace: "$self.lowResStarted($1,$2),",
                },
                {
                    match: /(?=\i\.\i\.get\(\{url:\i\.\i\.GIFS_TRENDING_GIFS,query:\{media_format:[^}]*?limit:(\i)\})/,
                    replace: "$self.lowResStarted(void 0,$1),",
                },
            ],
        },
        {
            // GIF picker main page (categories grid) and the page around it
            find: "hideFavoritesTile:",
            replacement: [
                {
                    // Don't fetch trending categories on mount ("Favourites only")
                    match: /0===this\.props\.trendingCategories\.length&&\(0,(\i\.\i)\)\(\)/,
                    replace: "$self.mountCategories(this.props.trendingCategories,$1)",
                },
                {
                    // The tiles: [favorites, ...trendingCategories]
                    match: /(this\.memoizedData\(this\.state\.favoritesTile,)this\.props\.trendingCategories/,
                    replace: "$1$self.featured(this.props.trendingCategories)",
                },
                {
                    // Shows a loading skeleton while there are no trending categories
                    match: /(trendingCategories:(\i)\}=this\.props;return )0===\2\.length/,
                    replace: "$1$self.needsCategories($2)",
                },
                {
                    // Precache button in the Favorites page header
                    match: /(case \i\.\i\.FAVORITES:return\(0,\i\.jsxs\)\("div",\{className:\i\.\i,children:\[)/,
                    replace: "$1$self.renderPrecacheButton(\"Favorites\",this.props.favorites),",
                },
            ],
        },
    ],

    flux: {
        GIF_PICKER_QUERY_SUCCESS(event: { query?: string; items?: GifItem[]; }) {
            lookupLowRes(event);
        },
    },

    // Used by the patches as $self
    SequentialResult,
    featured,
    lowResStarted,
    mountCategories,
    needsCategories,
    renderPrecacheButton,

    start() {
        loaded.resize(settings.store.cacheSize);
        seen.attach(savedList(SEEN_STORE_KEY));
        failed.attach(savedList(FAILED_STORE_KEY));
        runtime.klipy = new KlipyResolver({
            async search(q, format, limit) {
                const res = await RestAPI.get({
                    url: "/gifs/search",
                    query: { q, media_format: format, locale: LocaleStore.locale, limit },
                    oldFormErrors: true,
                });
                return Array.isArray(res?.body) ? res.body : [];
            },
            load: () => DataStore.get<Record<string, string>>(KLIPY_STORE_KEY),
            save: entries => void DataStore.set(KLIPY_STORE_KEY, entries),
            onError: e => logger.warn("Klipy favourite lookup failed", e),
        });
        runtime.precache = new Precacher(precacheOptions);
        runtime.lowRes = createLowResPrefetcher();
    },

    stop() {
        seen.detach();
        failed.detach();
        runtime.klipy?.flush();
        runtime.klipy = undefined;
        runtime.precache?.stop();
        runtime.precache = undefined;
        runtime.lowRes?.clear();
        runtime.lowRes = undefined;
        disconnectWatchers();
        loaded.clear();
        frames.clear();
    },
});
