/** @jsxRuntime classic */
/** @jsx valenced.react.React.createElement */
/** @jsxFrag valenced.react.React.Fragment */
/*
 * GIFs+ for Valenced (plugin id thatkerimguy.gif-picker-optimizer)
 *
 * - Loads GIF picker results one at a time, in reading order (left to right,
 *   top to bottom), waiting for each one to finish before starting the next.
 * - Shows a loading / progress indicator on tiles that are still empty.
 * - Shows a lower resolution preview in the picker (XS / S / SD) while still
 *   sending and favouriting the original, full resolution GIF.
 * - Shows GIFs that loaded recently from cache at once, and ones seen before
 *   first. (Discord's list already unmounts GIFs that scroll away.)
 * - Optionally shows still (not animated) previews in the favourites tab.
 * - Exports / imports favourites between accounts.
 */

import { getJsonStorage, pluginStoragePathFor } from "@valenced/json-storage";
import { AppState } from "react-native";

import { cacheNumbers, resetCaches } from "./cacheStats";
import { clearPatches, expectPatch } from "./diagnostics";
import { KlipyResolver } from "./klipyLookups";
import { applyPatches } from "./patches";
import { createLowResPages, locale } from "./previews";
import type { UrlListStore } from "./saved";
import SettingsComponent from "./settings";
import type { Settings } from "./settingsStore";
import { cacheControl, DefaultSettings, getSettings, setStorage } from "./settingsStore";
import { apiPreviews, applyQueueSettings, failed, flushSaved, loadedThisSession, PLUGIN_ID, runtime, seen } from "./state";
import { TenorPageResolver } from "./tenor";

/** A file in the plugin's storage holding a string -> string map */
function savedMap(file: string) {
    const storage = getJsonStorage<{ entries: Record<string, string>; }>(
        pluginStoragePathFor(PLUGIN_ID, file),
        { default: { entries: {} } },
    );
    return {
        load: async () => (await storage.get())?.entries,
        save: (entries: Record<string, string>) => void storage.set({ entries }, true),
    };
}

/** A file in the plugin's storage holding a saved URL list ([url, when] pairs) */
function savedList(file: string): UrlListStore {
    const storage = getJsonStorage<{ entries: [string, number][]; }>(
        pluginStoragePathFor(PLUGIN_ID, file),
        { default: { entries: [] } },
    );
    return {
        load: async () => (await storage.get())?.entries,
        save: entries => void storage.set({ entries }, true),
    };
}

export default plugin<{ jsonStorage: Settings; }>({
    jsonStorage: {
        load: true,
        default: DefaultSettings,
    },

    start({ cleanup, jsonStorage, logger }) {
        setStorage(jsonStorage);
        runtime.logger = logger;
        loadedThisSession.resize(getSettings().cacheSize);
        applyQueueSettings(getSettings());
        cacheControl.stats = cacheNumbers;
        cacheControl.reset = resetCaches;
        // Seen working when the code each patch calls runs (diagnostics.ts, shown in settings)
        expectPatch("tiles", "GIF tiles (one by one, previews)", "open the GIF picker");
        expectPatch("resultsList", "On-screen GIFs first", "open the GIF picker");
        expectPatch("searchActions", "Early low resolution requests", "search for GIFs or open Trending");
        expectPatch("picker", "Faster GIF tab switch", "open the GIF tab");
        expectPatch("categoriesPage", "Main page (Favourites only)", "open the GIF tab's main page");

        seen.attach(savedList("seen.json"));
        failed.attach(savedList("failed.json"));
        runtime.tenorPages = new TenorPageResolver(savedMap("tenor-pages.json"), (message, e) => runtime.logger?.warn?.(message, e));
        // Precaching was removed: drop its saved list
        void getJsonStorage(pluginStoragePathFor(PLUGIN_ID, "precache.json"), { default: {} }).delete().catch(() => { });
        runtime.lowRes = createLowResPages();
        // Saves are batched (persist.ts): save right away when the app goes to the background
        const appState = AppState.addEventListener("change", state => {
            if (state !== "active") flushSaved();
        });

        const klipyStore = savedMap("klipy-previews.json");
        runtime.klipy = new KlipyResolver({
            async search(q, format, limit) {
                const { http } = runtime;
                if (!http) throw new Error("HTTP module not found yet");
                const lang = locale();
                const res = await http.get({
                    url: "/gifs/search",
                    query: { q, media_format: format, ...(lang ? { locale: lang } : {}), limit },
                    oldFormErrors: true,
                });
                return Array.isArray(res?.body) ? res.body : [];
            },
            load: klipyStore.load,
            save: klipyStore.save,
            onError: e => runtime.logger?.warn?.("Klipy favourite lookup failed", e),
        });

        cleanup(
            () => {
                appState.remove();
                clearPatches();
                runtime.lowRes?.clear();
                runtime.lowRes = undefined;
                runtime.frecency = undefined;
                runtime.klipy?.stop();
                runtime.tenorPages?.stop();
                runtime.tenorPages = undefined;
                runtime.klipy = undefined;
                runtime.http = undefined;
                setStorage(undefined);
                cacheControl.stats = undefined;
                cacheControl.reset = undefined;
                seen.detach();
                failed.detach();
                loadedThisSession.clear();
                apiPreviews.clear();
            },
        );
        applyPatches(cleanup);
    },

    SettingsComponent,
});
