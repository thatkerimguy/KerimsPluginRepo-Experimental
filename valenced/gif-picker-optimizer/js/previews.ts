/*
 * Which URL a tile shows: a low resolution preview, a still image, or the original.
 * Never changes what gets sent or favourited.
 */

import { Stores } from "@valenced/discord/flux";

import { favoritesBackend } from "./favorites";
import type { LowResRequest } from "./klipy";
import { LowResPrefetcher, wait } from "./klipy";
import { isKlipyUrl, isTenorPageGif, isVideoUrl, klipyFavoriteFormats, lowResMediaFormat, normalizeUrl, rewriteUrl, stillUrl, tenorMediaFromSrc } from "./lowres";
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

/** Longest the queue waits for the low resolution results of a page */
const LOW_RES_CAP_MS = 3000;

/** The media_format for small search / trending previews, or null when none is needed */
function lowResFormat() {
    const { quality: q, klipyLookup } = getSettings();
    if (!klipyLookup || q === "original" || !runtime.http) return null;
    return lowResMediaFormat(selectedFormat(), q);
}

/** Asks Discord's GIF API for a search or trending page in a small media_format, and keeps the URLs */
async function requestLowRes({ query, format, limit }: LowResRequest) {
    const { http } = runtime;
    if (!http) throw new Error("HTTP module not found yet");
    const q = getSettings().quality;
    const isSearch = typeof query === "string";
    const lang = locale();
    const res = await http.get({
        url: isSearch ? "/gifs/search" : "/gifs/trending-gifs",
        query: {
            ...(isSearch ? { q: query } : {}),
            media_format: format,
            ...(lang ? { locale: lang } : {}),
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
        onError: (e, req) => runtime.logger?.warn?.(`Couldn't fetch low resolution Klipy previews (media_format=${req.format})`, e),
    });
}

/**
 * Discord's results for a search or trending page arrived. Klipy results (whose
 * URLs can't be rewritten) get small previews from a second request for the same
 * page in a small media_format. That request normally started with Discord's own
 * (the `search` / `fetchTrendingGIFs` patches), so the queue only waits for it if
 * it's still in flight. If it wasn't started (the patch didn't apply), it's sent
 * now and the queue waits.
 */
export async function lookupLowRes(event: { query?: string; items?: GifItem[]; }) {
    const { quality: q, klipyLookup } = getSettings();
    if (!klipyLookup || q === "original" || !runtime.http) return;

    const items = event.items ?? [];
    if (!items.some(i => i?.src && isKlipyUrl(i.src) && !apiPreviews.has(q, i))) return;

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
        runtime.logger?.warn?.(`Couldn't fetch low resolution Klipy previews (media_format=${format})`, e);
    } finally {
        release();
    }
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
    // Search and trending results get small versions from lookupLowRes, in one request per page
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

        if (!low || low === original || failed.has(low)) return original;
        // Mobile tiles are images: an mp4/webm URL would never load
        if (isVideoUrl(low)) return original;
        return low;
    } catch {
        return original;
    }
}

/** The URL a favourite's tile shows (what precaching downloads) */
export function favoriteUrl(item: GifItem): string {
    return pickSrc(item, getSettings().stillFavorites && isFavoriteItem(item));
}

const urlLists = new WeakMap<GifItem[], { key: string; urls: string[]; }>();

/**
 * `favoriteUrl` for every item, kept per list and only worked out again when
 * something it depends on changed (quality, still favourites, lookups, failed
 * previews). Precache counts re-render often during a run.
 */
export function favoriteUrls(items: GifItem[]): string[] {
    const { quality, stillFavorites } = getSettings();
    const key = [
        quality,
        stillFavorites,
        runtime.klipy?.version ?? 0,
        runtime.tenorPages?.version ?? 0,
        failed.version,
        favoritesBackend.read() ? 1 : 0,
    ].join("|");
    const memo = urlLists.get(items);
    if (memo?.key === key) return memo.urls;
    const urls = items.map(favoriteUrl);
    urlLists.set(items, { key, urls });
    return urls;
}

/** Longest a precache job waits for a Klipy or Tenor lookup */
const PRECACHE_LOOKUP_MS = 8000;

/** Looks the small version up first (Klipy, Tenor pages), then gives the URL to download */
export async function precacheUrl(item: GifItem): Promise<string> {
    const lookup = lookupFor(item);
    if (lookup) await Promise.race([lookup.catch(() => { }), wait(PRECACHE_LOOKUP_MS)]);
    return favoriteUrl(item);
}
