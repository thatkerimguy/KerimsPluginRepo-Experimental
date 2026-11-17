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
 * - Exports / imports favourites.
 * - Optionally shows still (not animated) previews in the favourites tab.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { migratePluginSettings } from "@api/Settings";
import definePlugin from "@utils/types";
import { LocaleStore, RestAPI } from "@webpack/common";

import { clearPatches, expectPatch } from "./diagnostics";
import { featured, mountCategories, needsCategories } from "./favoritesOnly";
import { FavoritesSettings } from "./FavoritesSettings";
import { KlipyResolver } from "./klipy";
import { patches } from "./patches";
import { createLowResPages, lowResStarted } from "./previews";
import type { UrlListStore } from "./saved";
import { SequentialResult } from "./SequentialResult";
import { applyQueueSettings, onConnectionChange, settings } from "./settings";
import { apiPreviews, failed, FAILED_STORE_KEY, flushSaved, KLIPY_STORE_KEY, loaded, logger, OLD_PLUGIN_NAME, OLD_PRECACHE_STORE_KEY, PLUGIN_NAME, runtime, seen, SEEN_STORE_KEY, settingsPanels } from "./state";
import { frames } from "./stillFrames";
import managedStyle from "./styles.css?managed";
import type { GifItem } from "./types";
import { disconnectWatchers } from "./viewport";

migratePluginSettings(PLUGIN_NAME, OLD_PLUGIN_NAME);
settingsPanels.favorites = () => <FavoritesSettings />;

/** Saves are batched (persist.ts), so save right away when Discord closes or is hidden */
const flushWhenHidden = () => {
    if (document.visibilityState === "hidden") flushSaved();
};
let stopWatchingConnection: (() => void) | undefined;

/** A saved URL list ([url, when] pairs) in Vencord's DataStore */
function savedList(key: string): UrlListStore {
    return {
        load: () => DataStore.get<[string, number][]>(key),
        save: entries => void DataStore.set(key, entries),
    };
}

export default definePlugin({
    name: PLUGIN_NAME,
    description: "Various Tweaks to the Discord's Gif Picker",
    authors: [{ name: "thatkerimguy", id: 0n }],
    settings,
    managedStyle,

    patches,

    flux: {
        GIF_PICKER_QUERY_SUCCESS(event: { query?: string; items?: GifItem[]; }) {
            runtime.lowRes?.arrived(event).catch(e => logger.warn("Low resolution previews failed", e));
        },
    },

    // Used by the patches as $self
    SequentialResult,
    featured,
    lowResStarted,
    mountCategories,
    needsCategories,

    start() {
        // Patches are seen working when the code they call runs (diagnostics.ts, shown in settings)
        expectPatch("results", "GIF tiles (one by one, previews)", "open the GIF picker");
        expectPatch("searchActions", "Early low resolution requests", "search for GIFs or open Trending");
        expectPatch("categories", "Main page categories (Favourites only)", "open the GIF picker's main page");
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
        // Precaching was removed: drop its saved list
        void DataStore.del(OLD_PRECACHE_STORE_KEY);
        runtime.lowRes = createLowResPages();
        applyQueueSettings();
        stopWatchingConnection = onConnectionChange(applyQueueSettings);
        window.addEventListener("beforeunload", flushSaved);
        document.addEventListener("visibilitychange", flushWhenHidden);
    },

    stop() {
        stopWatchingConnection?.();
        stopWatchingConnection = undefined;
        window.removeEventListener("beforeunload", flushSaved);
        document.removeEventListener("visibilitychange", flushWhenHidden);
        seen.detach();
        failed.detach();
        runtime.klipy?.stop();
        runtime.klipy = undefined;
        runtime.lowRes?.clear();
        runtime.lowRes = undefined;
        disconnectWatchers();
        clearPatches();
        loaded.clear();
        // Like the Valenced build: the patches stay applied until Discord reloads, so drop what was cached
        apiPreviews.clear();
        frames.clear();
    },
});
