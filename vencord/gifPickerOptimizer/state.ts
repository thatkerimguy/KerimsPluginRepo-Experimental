/*
 * Module-level state shared by the tiles, the settings and the plugin.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import type { ReactNode } from "react";

import { ApiPreviewCache, LoadedCache } from "./cache";
import type { KlipyResolver, LowResPrefetcher } from "./klipy";
import type { Precacher } from "./precache";
import { LoadQueue, type Ticket } from "./queue";
import { SavedUrlSet } from "./saved";

export const PLUGIN_NAME = "GIFs+";
/** The plugin's name before 1.6.0, to carry its settings over */
export const OLD_PLUGIN_NAME = "GifPickerOptimizer";

export const logger = new Logger(PLUGIN_NAME);
export const cl = classNameFactory("vc-gpo-");

export const queue = new LoadQueue();
/** URLs that finished loading. Scrolled-back tiles with a cached URL skip the queue. */
export const loaded = new LoadedCache(1000);
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * GIFs that finished loading, saved across restarts. After a restart their tiles
 * go first in the queue without a spinner (like precached ones), since the files
 * are probably still in the HTTP / native image cache.
 */
export const seen = new SavedUrlSet(5000, 14 * DAY_MS);
/** Preview URLs that failed, saved for a week so they aren't tried again after a restart */
export const failed = new SavedUrlSet(600, 7 * DAY_MS);
/** Low resolution URLs for search and trending results, from Discord's GIF API */
export const apiPreviews = new ApiPreviewCache();

export const KLIPY_STORE_KEY = "GifPickerOptimizer_klipyPreviews";
export const PRECACHE_STORE_KEY = "GifPickerOptimizer_precached";
export const SEEN_STORE_KEY = "GifPickerOptimizer_seen";
export const FAILED_STORE_KEY = "GifPickerOptimizer_failed";

/** Set while the plugin is running */
export const runtime: {
    /** Looks up small versions of Klipy favourites */
    klipy?: KlipyResolver;
    precache?: Precacher;
    /** Low resolution search / trending requests started alongside Discord's */
    lowRes?: LowResPrefetcher;
} = {};

/**
 * Settings panels that use the settings themselves. index.tsx fills this in,
 * so settings.tsx doesn't import them (that would be an import cycle).
 */
export const settingsPanels: { favorites?: () => ReactNode; } = {};

/** Whether `url` loaded recently, so its tile can show it at once without a turn in the queue */
export function isCached(url: string | null | undefined) {
    return loaded.hit(url);
}

/** Remembers that `url` finished loading (this session, and saved for later ones) */
export function markLoaded(url: string) {
    loaded.mark(url);
    seen.add(url);
}

/** Forgets `url` everywhere after it failed to load */
export function forgetLoaded(url: string) {
    loaded.delete(url);
    seen.delete(url);
    runtime.precache?.forget(url);
}

/**
 * Whether `url` was precached or loaded in an earlier session. Its tile goes first
 * in the queue without a spinner, but still takes a turn: the browser may have evicted
 * it from its cache since.
 */
export function isPrecached(url: string | null | undefined) {
    return !!runtime.precache?.has(url) || seen.has(url);
}

/** Tickets that were cancelled; a lookup that finishes later must not start them */
const dropped = new WeakSet<Ticket>();

export function drop(ticket: Ticket | null) {
    if (!ticket) return;
    dropped.add(ticket);
    queue.cancel(ticket);
}

export function isDropped(ticket: Ticket) {
    return dropped.has(ticket);
}
