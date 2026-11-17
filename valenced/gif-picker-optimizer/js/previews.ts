/*
 * Which URL a tile shows: a low resolution preview, a still image, or the original.
 * Never changes what gets sent or favourited.
 */

import { Stores } from "@valenced/discord/flux";

import { favoritesBackend } from "./favorites";
import { klipyFavoriteFormats } from "./klipyLookups";
import { LowResPages } from "./lowResPages";
import { isKlipyUrl, isTenorPageGif, isVideoUrl, normalizeUrl, rewriteUrl, stillUrl, tenorMediaFromSrc } from "./lowres";
import { getSettings } from "./settingsStore";
import type { GifItem } from "./state";
import { apiPreviews, failed, isFavoriteItem, queue, runtime } from "./state";

/** The media_format Discord's GIF picker asks for (`tinywebp` on mobile) */
export function selectedFormat() {
    return (Stores.GIFPickerViewStore as unknown as { getSelectedFormat?(): string; } | undefined)?.getSelectedFormat?.() ?? "tinywebp";
}

export function locale() {
    return (Stores.LocaleStore as unknown as { locale?: string; } | undefined)?.locale;
}

/** Small previews for search / trending pages (Klipy), requested alongside Discord's */
export function createLowResPages() {
    return new LowResPages({
        quality: () => getSettings().quality,
        enabled: () => getSettings().klipyLookup && !!runtime.http,
        selectedFormat,
        locale,
        async get(url, query) {
            const { http } = runtime;
            if (!http) throw new Error("HTTP module not found yet");
            return (await http.get({ url, query, oldFormErrors: true }))?.body;
        },
        previews: apiPreviews,
        hold: ms => queue.hold(ms),
        warn: (message, e) => runtime.logger?.warn?.(message, e),
    });
}

/** The src Discord saved for a favourite (the tab shows a changed URL for some) */
function savedSrc(item: GifItem): string | undefined {
    if (!item.url || !isFavoriteItem(item)) return undefined;
    return favoritesBackend.read()?.[item.url]?.src;
}

/**
 * For a Tenor favourite shown as its page URL (`<page>.gif`, a redirect): the
 * Tenor media URL to take the small version from. The saved src normally holds
 * it (directly or proxied), so no request is needed. Only when it doesn't, the
 * page is looked up with a HEAD request (`TenorPageResolver`).
 */
function tenorMediaFor(item: GifItem, original: string): string | undefined {
    if (!isTenorPageGif(original)) return undefined;
    return tenorMediaFromSrc(savedSrc(item)) || runtime.tenorPages?.peek(original) || undefined;
}

/** media_formats to look a Klipy favourite up with, or null when it doesn't need a lookup */
function klipyFormats(item: GifItem): string[] | null {
    const { quality: q, klipyLookup } = getSettings();
    const { klipy } = runtime;
    if (!klipy || !klipyLookup || q === "original") return null;
    // Search and trending results get small versions from LowResPages, in one request per page
    if (!isFavoriteItem(item)) return null;
    if (apiPreviews.has(q, item)) return null;
    if (!isKlipyUrl(item.src) || !klipy.canResolve(item.url)) return null;
    // Mobile tiles are always images, even when the favourite is a proxied video
    const formats = klipyFavoriteFormats(false, selectedFormat(), q);
    return formats.length ? formats : null;
}

/** A pending Tenor or Klipy lookup for `item`, or null when its preview URL is already known */
export function lookupFor(item: GifItem): Promise<unknown> | null {
    const { quality: q } = getSettings();
    const { tenorPages, klipy } = runtime;
    if (q !== "original" && isTenorPageGif(item.src)) {
        // The saved src has the media URL: nothing to look up
        if (!tenorPages || tenorMediaFromSrc(savedSrc(item))) return null;
        const page = normalizeUrl(item.src);
        const unknown = tenorPages.peek(page) === undefined && !tenorPages.recentlyFailed(page);
        return unknown ? tenorPages.resolve(page) : null;
    }
    const formats = klipyFormats(item);
    if (!formats || klipy!.peek(item.url, formats) !== undefined) return null;
    return klipy!.resolve(item.url!, formats);
}

/**
 * The URL a tile should display.
 * With `still`, a non-animated image is preferred when the source has one.
 */
export function pickSrc(item: GifItem, still = false): string {
    const original = normalizeUrl(item.src);
    try {
        const q = getSettings().quality;
        // Tenor favourite shown as its page URL: work from its media URL (stills too)
        const tenorMedia = tenorMediaFor(item, original);
        if (still) {
            const frame = stillUrl(tenorMedia || original, q, item);
            if (frame && !failed.has(frame)) return frame;
        }
        if (q === "original") return original;

        const formats = klipyFormats(item);
        const low = apiPreviews.get(q, item)
            ?? (formats && runtime.klipy!.peek(item.url, formats))
            ?? rewriteUrl(tenorMedia || original, q, item, { imagesOnly: true });

        // A preview that failed before is still used: tiles retry it rather than load the full size original
        if (!low || low === original) return original;
        // Mobile tiles are images: an mp4/webm URL would never load
        if (isVideoUrl(low)) return original;
        return low;
    } catch {
        return original;
    }
}
