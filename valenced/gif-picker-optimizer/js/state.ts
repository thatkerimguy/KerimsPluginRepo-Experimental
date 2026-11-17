/*
 * Module-level state shared by the tiles, the settings and the plugin.
 */

import type { DiscordModules } from "@valenced/discord/types";

import type { FrecencyActions } from "./favoritesBackend";
import type { KlipyResolver } from "./klipyLookups";
import type { LowResPages } from "./lowResPages";
import type { Settings } from "./settingsStore";
import { DefaultSettings } from "./settingsStore";
import type { TenorPageResolver } from "./tenor";
import { createTracking } from "./tracking";

export const PLUGIN_ID = "thatkerimguy.gif-picker-optimizer";
export const PLUGIN_NAME = "GIFs+";

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
    /** Low resolution search / trending requests started alongside Discord's */
    lowRes?: LowResPages;
} = {};

export const {
    queue, loadedThisSession, seen, failed, apiPreviews,
    isLoadedThisSession, isSeenBefore, markLoaded, forgetLoaded, drop, isDropped, tileEnv, flushSaved,
} = createTracking({
    loadedSize: DefaultSettings.cacheSize,
    savedCaches: () => [runtime.klipy, runtime.tenorPages],
    onError: (message, e) => runtime.logger?.error?.(message, e),
});

/** Sets the load queue from the settings (on start and when they change, not per tile) */
export function applyQueueSettings({ sequential, concurrency }: Settings) {
    queue.concurrency = sequential ? concurrency : 64;
    queue.prioritizeVisible = true;
    queue.kick();
}
