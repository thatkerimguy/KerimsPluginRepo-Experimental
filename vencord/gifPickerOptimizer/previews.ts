/*
 * Which URL a tile shows: a low resolution preview, a still image, or the original.
 * Never changes what gets sent or favourited.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { GIFPickerViewStore, LocaleStore, RestAPI } from "@webpack/common";

import { patchWorks } from "./diagnostics";
import { LowResPages } from "./klipy";
import { isKlipyUrl, isVideoUrl, klipyFavoriteFormats, normalizeUrl, rewriteUrl, stillUrl } from "./lowres";
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

/** Small previews for search / trending pages (Klipy), requested alongside Discord's */
export function createLowResPages() {
    return new LowResPages({
        quality,
        enabled: () => settings.store.klipyLookup,
        selectedFormat: () => GIFPickerViewStore.getSelectedFormat(),
        locale: () => LocaleStore.locale,
        async get(url, query) {
            return (await RestAPI.get({ url, query, oldFormErrors: true }))?.body;
        },
        previews: apiPreviews,
        block: ms => queue.block(ms),
        warn: (message, e) => logger.warn(message, e),
    });
}

/** Discord's search (query) or trending (no query) request is starting: start ours with it (from a patch) */
export function lowResStarted(query: string | undefined, limit: number | undefined) {
    patchWorks("searchActions");
    try {
        runtime.lowRes?.started(typeof query === "string" ? query : undefined, typeof limit === "number" ? limit : undefined);
    } catch (e) {
        logger.error("Couldn't start the low resolution request", e);
    }
}

/** media_formats to look a Klipy favourite up with, or null when it doesn't need a lookup */
function klipyFormats(item: GifItem, src: string): string[] | null {
    const q = quality();
    if (!runtime.klipy || !settings.store.klipyLookup || q === "original") return null;
    // Search and trending results get small versions from LowResPages, in one request per page
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

    // A preview that failed before is still used: tiles retry it rather than load the full size original
    if (!low || low === original) return original;
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
