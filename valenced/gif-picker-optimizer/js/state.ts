/*
 * Module-level state shared by the tiles, the settings and the plugin.
 */

import type { DiscordModules } from "@valenced/discord/types";

import type { GifRef } from "./cache";
import type { KlipyResolver, LowResPages } from "./klipy";
import type { Precacher } from "./precache";
import type { Settings } from "./settingsStore";
import { DefaultSettings } from "./settingsStore";
import type { TenorPageResolver } from "./tenor";
import type { FrecencyActions } from "./transfer";
import { createTracking } from "./tracking";

export const PLUGIN_ID = "thatkerimguy.gif-picker-optimizer";
export const PLUGIN_NAME = "GIFs+";

export interface GifItem extends GifRef {
    src: string;
    /** The GIF version of a video result */
    gifSrc?: string;
    format?: number;
    width?: number;
    height?: number;
    /** Only favourites have this (their position in the favourites list) */
    order?: number;
}

/** Favourites come from the frecency settings: they have an `order` and no `id` */
export function isFavoriteItem(item: GifItem) {
    return typeof item.order === "number" && item.id == null;
}

/** Discord's HTTP client (the `HTTP` export of its API module) */
export interface HttpClient {
    get(options: { url: string; query?: Record<string, unknown>; oldFormErrors?: boolean; }): Promise<{ body: unknown; }>;
}

/** Set while the plugin is running */
export const runtime: {
    logger?: DiscordModules.Logger;
    /** Found a moment after start */
    http?: HttpClient;
    /** Looks up small versions of Klipy favourites */
    klipy?: KlipyResolver;
    /** Resolves Tenor favourites shown as page URLs */
    tenorPages?: TenorPageResolver;
    frecency?: FrecencyActions;
    precache?: Precacher;
    /** Low resolution search / trending requests started alongside Discord's */
    lowRes?: LowResPages;
} = {};

export const {
    queue, loaded, seen, failed, apiPreviews,
    isCached, markLoaded, forgetLoaded, isPrecached, drop, isDropped, tileEnv, flushSaved,
} = createTracking({
    loadedSize: DefaultSettings.cacheSize,
    precache: () => runtime.precache,
    savedCaches: () => [runtime.klipy, runtime.tenorPages, runtime.precache],
    onError: (message, e) => runtime.logger?.error?.(message, e),
});

/** Sets the load queue from the settings (on start and when they change, not per tile) */
export function applyQueueSettings({ sequential, concurrency }: Settings) {
    queue.concurrency = sequential ? concurrency : 64;
    queue.prioritizeVisible = true;
    queue.kick();
}
