/*
 * Which URL a tile shows: a low resolution preview, a still image, or the original.
 * Never changes what gets sent or favourited.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { GIFPickerViewStore, LocaleStore, RestAPI } from "@webpack/common";

import { LowResPrefetcher, type LowResRequest, wait } from "./klipy";
import { isKlipyUrl, isVideoUrl, klipyFavoriteFormats, lowResMediaFormat, normalizeUrl, rewriteUrl, stillUrl } from "./lowres";
import { quality, settings } from "./settings";
import { apiPreviews, failed, logger, queue, runtime } from "./state";
import type { GifItem } from "./types";

/** Favourites come from the frecency settings: they have an `order` and no `id` */
export function isFavoriteItem(item: GifItem) {
    return typeof item.order === "number" && item.id == null;
}

export function isFavoritesTile(resultType: unknown, item: GifItem) {
    if (typeof resultType === "string" && /favou?rite/i.test(resultType)) return true;
    return isFavoriteItem(item);
}

/** Longest the queue waits for the low resolution results of a page */
const LOW_RES_CAP_MS = 3000;

/** The media_format for small search / trending previews, or null when none is needed */
function lowResFormat() {
    const q = quality();
    if (!settings.store.klipyLookup || q === "original") return null;
    return lowResMediaFormat(GIFPickerViewStore.getSelectedFormat(), q);
}

/** Asks Discord's GIF API for a search or trending page in a small media_format, and keeps the URLs */
async function requestLowRes({ query, format, limit }: LowResRequest) {
    const q = quality();
    const isSearch = typeof query === "string";
    const res = await RestAPI.get({
        url: isSearch ? "/gifs/search" : "/gifs/trending-gifs",
        query: {
            ...(isSearch ? { q: query } : {}),
            media_format: format,
            locale: LocaleStore.locale,
            ...(limit != null ? { limit } : {}),
        },
        oldFormErrors: true,
    });
    apiPreviews.store(q, (Array.isArray(res?.body) ? res.body : []) as GifItem[]);
}

export function createLowResPrefetcher() {
    return new LowResPrefetcher({
        format: lowResFormat,
        request: requestLowRes,
        onError: (e, req) => logger.warn(`Couldn't fetch low resolution Klipy previews (media_format=${req.format})`, e),
    });
}

/** Discord's search (query) or trending (no query) request is starting: start ours with it (from a patch) */
export function lowResStarted(query: string | undefined, limit: number | undefined) {
    try {
        runtime.lowRes?.start(typeof query === "string" ? query : undefined, typeof limit === "number" ? limit : undefined);
    } catch (e) {
        logger.error("Couldn't start the low resolution request", e);
    }
}

/**
 * Discord's results for a search or trending page arrived. Klipy results (whose
 * URLs can't be rewritten) get small previews from a second request for the same
 * page in a small media_format. That request normally started with Discord's own
 * (`lowResStarted`), so the queue only waits for it if it's still in flight. If
 * it wasn't started (the patch didn't apply), it's sent now and the queue waits.
 */
export async function lookupLowRes(event: { query?: string; items?: GifItem[]; }) {
    const q = quality();
    if (!settings.store.klipyLookup || q === "original") return;

    const items = event.items ?? [];
    const missing = items.some(i => i?.src && isKlipyUrl(i.src) && !apiPreviews.has(q, i));
    if (!missing) return;

    const format = lowResFormat();
    if (!format) return;

    const query = typeof event.query === "string" ? event.query : undefined;
    const early = runtime.lowRes?.pending(query);
    if (early) {
        const left = LOW_RES_CAP_MS - early.runningMs;
        if (early.wait && left > 0) early.wait.finally(queue.block(left));
        return;
    }

    // Hold the queue so tiles don't start loading the full resolution file meanwhile
    const release = queue.block(LOW_RES_CAP_MS);
    try {
        await requestLowRes({ query, format, limit: items.length });
    } catch (e) {
        logger.warn(`Couldn't fetch low resolution Klipy previews (media_format=${format})`, e);
    } finally {
        release();
    }
}

/** media_formats to look a Klipy favourite up with, or null when it doesn't need a lookup */
function klipyFormats(item: GifItem, src: string): string[] | null {
    const q = quality();
    if (!runtime.klipy || !settings.store.klipyLookup || q === "original") return null;
    // Search and trending results get small versions from lookupLowRes, in one request per page
    if (!isFavoriteItem(item)) return null;
    if (apiPreviews.has(q, item)) return null;
    if (!isKlipyUrl(src) || !runtime.klipy.canResolve(item.url)) return null;
    const formats = klipyFavoriteFormats(isVideoUrl(src), GIFPickerViewStore.getSelectedFormat(), q);
    return formats.length ? formats : null;
}

/** A pending Klipy lookup for `item`, or null when its preview URL is already known */
export function klipyLookupFor(item: GifItem, src: string): Promise<unknown> | null {
    const formats = klipyFormats(item, src);
    if (!formats || runtime.klipy!.peek(item.url, formats) !== undefined) return null;
    return runtime.klipy!.resolve(item.url!, formats);
}

/** The URL a tile should display */
export function pickSrc(item: GifItem, src: string): string {
    const original = normalizeUrl(src);
    const q = quality();
    if (q === "original") return original;

    const formats = klipyFormats(item, src);
    const low = apiPreviews.get(q, item)
        ?? (formats && runtime.klipy!.peek(item.url, formats))
        ?? rewriteUrl(original, q, item);

    if (!low || low === original || failed.has(low)) return original;
    // Must stay the same media type or the picker would render it with the wrong element
    if (isVideoUrl(low) !== isVideoUrl(original)) return original;
    return low;
}

export interface StillSource {
    url: string;
    /** True when `url` is animated and the first frame has to be captured locally */
    capture: boolean;
}

/** What a still favourite shows: a still rendition if the source has one, else a frame of the preview */
export function pickStill(item: GifItem, src: string): StillSource {
    const frame = stillUrl(normalizeUrl(src), quality(), item);
    if (frame && !failed.has(frame)) return { url: frame, capture: false };
    return { url: pickSrc(item, src), capture: true };
}

/** The URL a favourite's tile downloads in the favourites tab */
export function favoriteUrl(item: GifItem) {
    return settings.store.stillFavorites ? pickStill(item, item.src).url : pickSrc(item, item.src);
}

const urlLists = new WeakMap<GifItem[], { key: string; urls: string[]; }>();

/**
 * `favoriteUrl` for every item, kept per list and only worked out again when
 * something it depends on changed (quality, still favourites, Klipy lookups,
 * failed previews). Precache counts re-render often during a run.
 */
export function favoriteUrls(items: GifItem[]): string[] {
    const key = `${quality()}|${settings.store.stillFavorites}|${runtime.klipy?.version ?? 0}|${failed.version}`;
    const memo = urlLists.get(items);
    if (memo?.key === key) return memo.urls;
    const urls = items.map(favoriteUrl);
    urlLists.set(items, { key, urls });
    return urls;
}

/** Longest a precache waits for a Klipy lookup */
const PRECACHE_LOOKUP_MS = 8000;

/** Resolves the URL a favourite's tile will show, looking up its small version first if needed */
export async function precacheUrl(item: GifItem) {
    const lookup = klipyLookupFor(item, item.src);
    if (lookup) await Promise.race([lookup, wait(PRECACHE_LOOKUP_MS)]).catch(() => { });
    return favoriteUrl(item);
}
