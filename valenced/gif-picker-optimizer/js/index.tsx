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

import { onFluxEventDispatched } from "@valenced/discord/flux";
import { getModuleWithImportedPath } from "@valenced/discord/utils/modules/finders";
import { getJsonStorage, pluginStoragePathFor } from "@valenced/json-storage";
import { getModules } from "@valenced/modules/finders";
import { withProps } from "@valenced/modules/finders/filters";
import { instead } from "@valenced/patcher";
import type { ReactNode } from "react";
import { AppState } from "react-native";

import { cacheNumbers, resetCaches } from "./cacheStats";
import { clearPatches, expectPatch, patchFailed, patchWorks } from "./diagnostics";
import { KlipyResolver } from "./klipyLookups";
import type { AnyComponent } from "./modules";
import { pickerModules } from "./modules";
import { CategoriesPage, DeferredPicker } from "./picker";
import { createLowResPages, locale } from "./previews";
import type { UrlListStore } from "./saved";
import SettingsComponent from "./settings";
import type { Settings } from "./settingsStore";
import { cacheControl, DefaultSettings, getSettings, setStorage } from "./settingsStore";
import type { GifItem, HttpClient } from "./state";
import type { FrecencyActions } from "./favoritesBackend";
import { apiPreviews, applyQueueSettings, failed, flushSaved, loadedThisSession, PLUGIN_ID, runtime, seen } from "./state";
import { TenorPageResolver } from "./tenor";
import type { ItemProps } from "./tile";
import { OptimizedItem } from "./tile";
import type { ResultsListProps } from "./viewport";
import { OptimizedResultsList } from "./viewport";

const GIF_PICKER = "modules/gif_picker/native/";
const ACTIONS_PATH = "actions/GIFPickerActionCreators.tsx";
const ITEM_VIEW_PATH = `${GIF_PICKER}GIFPickerItemView.tsx`;
const RESULTS_LIST_PATH = `${GIF_PICKER}GIFPickerResultsList.tsx`;
const PICKER_PATH = `${GIF_PICKER}GIFPicker.tsx`;
const CATEGORIES_PAGE_PATH = `${GIF_PICKER}GIFPickerCategoriesPage.tsx`;
const PICKER_UTILS_PATH = `${GIF_PICKER}GIFPickerUtils.tsx`;
const CATEGORY_VIEW_PATH = `${GIF_PICKER}GIFPickerCategoryView.tsx`;

/** React.memo object: patching `type` changes what every picker renders */
type Memo = { type: AnyComponent; };

/** Discord's API module, found by its exports */
interface HttpModule {
    HTTP: HttpClient;
    get: unknown;
    post: unknown;
    put: unknown;
    patch: unknown;
    del: unknown;
}

/** Discord's GIF picker actions (only what's patched) */
interface GifPickerActions {
    /** (query, resultType, immediate, limit). Debounces its request 250 ms unless `immediate`. */
    search?: (query: string, type?: unknown, immediate?: boolean, limit?: number) => unknown;
    fetchTrendingGIFs?: (limit?: number) => unknown;
}

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

            getModules(
                withProps<HttpModule>("HTTP", "get", "post", "put", "patch", "del"),
                mod => {
                    runtime.http = mod.HTTP;
                },
                { max: 1 },
            ),

            // Discord's favourites (export and import)
            getModules(
                withProps<{ FrecencyUserSettingsActionCreators: FrecencyActions; }>("FrecencyUserSettingsActionCreators"),
                mod => {
                    runtime.frecency = mod.FrecencyUserSettingsActionCreators;
                },
                { max: 1 },
            ),

            // Start the low resolution request for Klipy previews together with Discord's
            // search / trending request. Without these, it's sent once results arrive.
            getModuleWithImportedPath<GifPickerActions>(ACTIONS_PATH, mod => {
                const startWith = (name: string, start: (args: unknown[]) => void) => {
                    if (typeof (mod as Record<string, unknown>)[name] !== "function") {
                        runtime.logger?.warn?.(`GIFPickerActionCreators.${name} not found, low resolution previews start after the results`);
                        patchFailed("searchActions", `GIFPickerActionCreators.${name} not found`);
                        return;
                    }
                    try {
                        cleanup(instead(mod as Record<string, (...a: unknown[]) => unknown>, name, function (this: unknown, args, orig) {
                            patchWorks("searchActions");
                            try {
                                start(args);
                            } catch (e) {
                                runtime.logger?.error?.("Couldn't start the low resolution request", e);
                            }
                            return Reflect.apply(orig, this, args);
                        }));
                    } catch (e) {
                        runtime.logger?.warn?.(`Couldn't patch GIFPickerActionCreators.${name}`, e);
                        patchFailed("searchActions", `couldn't patch GIFPickerActionCreators.${name}`);
                    }
                };
                startWith("search", ([query, , immediate, limit]) => {
                    if (typeof query !== "string") return;
                    runtime.lowRes?.search(query, typeof limit === "number" ? limit : undefined, immediate === true);
                });
                startWith("fetchTrendingGIFs", ([limit]) => {
                    runtime.lowRes?.started(undefined, typeof limit === "number" ? limit : undefined);
                });
            }),

            onFluxEventDispatched<{ query?: string; items?: GifItem[]; }>("GIF_PICKER_QUERY_SUCCESS", payload => {
                runtime.lowRes?.arrived(payload).catch(() => { });
                // Returning the payload lets the event through unchanged
                return payload;
            }),

            // Each GIF tile
            getModuleWithImportedPath<{ default: (props: ItemProps) => ReactNode; }>(ITEM_VIEW_PATH, mod => {
                cleanup(
                    instead(mod, "default", function (this: unknown, args, orig) {
                        const props = args[0];
                        if (!props?.item?.src) return Reflect.apply(orig, this, args);
                        return (
                            <OptimizedItem
                                key={props.item.src}
                                props={props}
                                render={p => Reflect.apply(orig, this, [p])}
                            />
                        );
                    }),
                );
            }),

            // The list of tiles: tracks which ones are on screen
            getModuleWithImportedPath<{ default: (props: ResultsListProps) => ReactNode; }>(RESULTS_LIST_PATH, mod => {
                cleanup(
                    instead(mod, "default", function (this: unknown, args, orig) {
                        return (
                            <OptimizedResultsList
                                props={args[0]}
                                render={p => Reflect.apply(orig, this, [p])}
                            />
                        );
                    }),
                );
            }),

            getModuleWithImportedPath<NonNullable<typeof pickerModules.utils>>(PICKER_UTILS_PATH, mod => {
                pickerModules.utils = mod;
            }),

            getModuleWithImportedPath<{ default: AnyComponent; }>(CATEGORY_VIEW_PATH, mod => {
                pickerModules.categoryView = mod;
            }),

            // Faster GIF tab switch
            getModuleWithImportedPath<{ default: Memo; }>(PICKER_PATH, mod => {
                const memo = mod.default;
                if (typeof memo?.type !== "function") {
                    runtime.logger?.warn?.("GIFPicker isn't a memo component any more, faster tab switch is off");
                    patchFailed("picker", "GIFPicker isn't a memo component any more");
                    return;
                }
                pickerModules.picker = memo.type;
                cleanup(instead(memo, "type", (args, orig) => {
                    patchWorks("picker");
                    pickerModules.picker = orig;
                    return <DeferredPicker props={args[0] ?? {}} />;
                }));
            }),

            // Main page with favourites only
            getModuleWithImportedPath<{ default: Memo; }>(CATEGORIES_PAGE_PATH, mod => {
                const memo = mod.default;
                if (typeof memo?.type !== "function") {
                    runtime.logger?.warn?.("GIFPickerCategoriesPage isn't a memo component any more, favourites only is off");
                    patchFailed("categoriesPage", "GIFPickerCategoriesPage isn't a memo component any more");
                    return;
                }
                pickerModules.categoriesPage = memo.type;
                cleanup(instead(memo, "type", (args, orig) => {
                    patchWorks("categoriesPage");
                    pickerModules.categoriesPage = orig;
                    return <CategoriesPage props={args[0] ?? {}} />;
                }));
            }),
        );
    },

    SettingsComponent,
});
