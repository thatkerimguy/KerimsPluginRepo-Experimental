/** @jsxRuntime classic */
/** @jsx valenced.react.React.createElement */
/** @jsxFrag valenced.react.React.Fragment */
/*
 * Everything GIFs+ patches or finds in Discord's mobile code. Diagnostics
 * (diagnostics.ts) record which of these are seen working.
 */

import { onFluxEventDispatched } from "@valenced/discord/flux";
import { getModuleWithImportedPath } from "@valenced/discord/utils/modules/finders";
import { getModules } from "@valenced/modules/finders";
import { withProps } from "@valenced/modules/finders/filters";
import { instead } from "@valenced/patcher";
import type { ReactNode } from "react";

import { patchFailed, patchWorks } from "./diagnostics";
import type { FrecencyActions } from "./favoritesBackend";
import type { GifItem } from "./items";
import type { AnyComponent } from "./modules";
import { pickerModules } from "./modules";
import { DeferredPicker } from "./picker";
import type { HttpClient } from "./state";
import { runtime } from "./state";
import type { ItemProps } from "./tile";
import { GifTile } from "./tile";
import type { ResultsListProps } from "./viewport";
import { OptimizedResultsList } from "./viewport";

const GIF_PICKER = "modules/gif_picker/native/";
const ACTIONS_PATH = "actions/GIFPickerActionCreators.tsx";
const ITEM_VIEW_PATH = `${GIF_PICKER}GIFPickerItemView.tsx`;
const RESULTS_LIST_PATH = `${GIF_PICKER}GIFPickerResultsList.tsx`;
const PICKER_PATH = `${GIF_PICKER}GIFPicker.tsx`;

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

/** The plugin's `cleanup`: runs what it's given when the plugin stops */
type Cleanup = (...fns: (() => unknown)[]) => void;

/** Applies every patch; each one is undone through `cleanup` when the plugin stops */
export function applyPatches(cleanup: Cleanup) {
    cleanup(
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
                        <GifTile
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
    );
}
