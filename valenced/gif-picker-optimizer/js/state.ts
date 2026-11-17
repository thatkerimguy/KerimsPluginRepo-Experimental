/*
 * Module-level state shared by the tiles, the settings and the plugin.
 */

import type { DiscordModules } from "@valenced/discord/types";

import type { GifRef } from "./cache";
import { ApiPreviewCache, LoadedCache } from "./cache";
import type { KlipyResolver, LowResPages } from "./klipy";
import type { Precacher } from "./precache";
import type { Ticket } from "./queue";
import { LoadQueue } from "./queue";
import { SavedUrlSet } from "./saved";
import type { Settings } from "./settingsStore";
import { DefaultSettings } from "./settingsStore";
import type { TenorPageResolver } from "./tenor";
import type { TileEnv } from "./tileLoader";

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

export const queue = new LoadQueue();
/** URLs that finished loading. Scrolled-back tiles with a cached URL skip the queue. */
export const loaded = new LoadedCache(DefaultSettings.cacheSize);
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

/** Discord's frecency settings actions (favourites are saved and synced through these) */
export interface FrecencyActions {
    getCurrentValue(): { favoriteGifs?: { gifs?: Record<string, any>; }; } | undefined;
    updateAsync(key: "favoriteGifs", updater: (value: any) => unknown, delay: number): Promise<unknown>;
    /** The FrecencyUserSettings protobuf type (for the exact favourites size) */
    ProtoClass?: unknown;
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

/** Whether `url` loaded recently, so its tile shows it at once without a turn in the queue */
export function isCached(url: string) {
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
 * in the queue without a spinner, but still takes a turn: Fresco may have evicted
 * it from its cache since.
 */
export function isPrecached(url: string) {
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

/** What the shared tile loader (tileLoader.ts) works with */
export const tileEnv: TileEnv = {
    queue,
    isCached,
    isPrecached,
    markLoaded,
    markFailed(url) {
        failed.add(url);
        forgetLoaded(url);
    },
    drop,
    isDropped,
    onError: (message, e) => runtime.logger?.error?.(message, e),
};

/** Sets the load queue from the settings (on start and when they change, not per tile) */
export function applyQueueSettings({ sequential, concurrency }: Settings) {
    queue.concurrency = sequential ? concurrency : 64;
    queue.prioritizeVisible = true;
    queue.kick();
}

/** Saves anything pending in the saved lists right away (the app going to the background) */
export function flushSaved() {
    seen.flush();
    failed.flush();
    runtime.klipy?.flush();
    runtime.tenorPages?.flush();
    runtime.precache?.flush();
}
