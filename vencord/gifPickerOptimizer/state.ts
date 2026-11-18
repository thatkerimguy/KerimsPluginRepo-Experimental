/*
 * Module-level state shared by the tiles, the settings and the plugin.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import type { ReactNode } from "react";

import type { KlipyResolver } from "./klipyLookups";
import type { LowResPages } from "./lowResPages";
import { preconnect } from "./preconnect";
import { createTracking } from "./tracking";

export const PLUGIN_NAME = "GIFs+";
/**
 * This build's version, the same as the Valenced manifest's (a test checks). When it
 * differs from the one that saved the caches, they're cleared (invalidation.ts).
 */
export const PLUGIN_VERSION = "1.7.3";
/** The plugin's name before 1.6.0, to carry its settings over */
export const OLD_PLUGIN_NAME = "GifPickerOptimizer";

export const logger = new Logger(PLUGIN_NAME);
export const cl = classNameFactory("vc-gpo-");

export const KLIPY_STORE_KEY = "GifPickerOptimizer_klipyPreviews";
/** Precached URLs, before precaching was removed (deleted on start) */
export const OLD_PRECACHE_STORE_KEY = "GifPickerOptimizer_precached";
export const SEEN_STORE_KEY = "GifPickerOptimizer_seen";
export const FAILED_STORE_KEY = "GifPickerOptimizer_failed";
/** The version that saved the caches */
export const CACHE_VERSION_STORE_KEY = "GifPickerOptimizer_cacheVersion";

/** Set while the plugin is running */
export const runtime: {
    /** Looks up small versions of Klipy favourites */
    klipy?: KlipyResolver;
    /** Small previews for search / trending pages, requested alongside Discord's */
    lowRes?: LowResPages;
} = {};

/**
 * Settings panels that use the settings themselves. index.tsx fills this in,
 * so settings.tsx doesn't import them (that would be an import cycle).
 */
export const settingsPanels: { favorites?: () => ReactNode; } = {};

export const {
    queue, loadedThisSession, seen, failed, apiPreviews,
    isLoadedThisSession, isSeenBefore, markLoaded, forgetLoaded, drop, isDropped, tileEnv, flushSaved,
} = createTracking({
    loadedSize: 1000,
    savedCaches: () => [runtime.klipy],
    onError: (message, e) => logger.error(message, e),
    warmUp: preconnect,
});
