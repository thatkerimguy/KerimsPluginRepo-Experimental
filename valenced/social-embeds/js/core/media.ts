/*
 * Choosing which file to load: the smallest version that still looks sharp at
 * the size it's shown, full size only in the viewer.
 */

import type { Media, MediaVariant } from "./model";

/** width / height, 1 when unknown. */
export const aspectOf = (m: Pick<Media, "width" | "height">) => (m.width > 0 && m.height > 0 ? m.width / m.height : 1);

const isVideoVariant = (v: MediaVariant) => !v.contentType || v.contentType === "video/mp4";

/**
 * Image URL for a box `boxWidth` × `boxHeight` CSS / density-independent pixels at `pixelRatio`.
 * The image is cropped to cover the box, so the needed width depends on both sides.
 */
export function pickImage(media: Media, boxWidth: number, boxHeight: number, pixelRatio = 1): string {
    const aspect = aspectOf(media);
    // Cover: scale so both sides fill the box
    const neededWidth = Math.max(boxWidth, boxHeight * aspect) * pixelRatio;
    const sized = media.variants
        .filter(v => (v.width ?? 0) > 0 && (!v.contentType || v.contentType.startsWith("image/")))
        .sort((a, b) => a.width! - b.width!);
    if (media.kind !== "photo") {
        // Videos and gifs: their still
        return media.thumbnail ?? sized[0]?.url ?? media.url;
    }
    if (!sized.length) return media.url;
    return (sized.find(v => v.width! >= neededWidth) ?? sized[sized.length - 1]).url;
}

export interface VideoChoice {
    url: string;
    /** HLS with sound when the platform splits audio (Reddit); players that can play HLS should prefer it. */
    hls?: string;
}

/**
 * Video file: on data saver the smallest mp4, otherwise the best one up to `maxQuality`
 * ("720" = 720p: the short side, so portrait videos count the same as landscape ones).
 */
export function pickVideo(media: Media, maxQuality = 1080, dataSaver = false): VideoChoice {
    const mp4 = media.variants.filter(isVideoVariant);
    if (!mp4.length) return { url: media.url, hls: media.hls };
    const shortSide = (v: MediaVariant) => Math.min(v.width ?? Infinity, v.height ?? Infinity);
    const rank = (v: MediaVariant) => v.bitrate ?? (Number.isFinite(shortSide(v)) ? shortSide(v) * 1000 : 0);
    const sorted = [...mp4].sort((a, b) => rank(a) - rank(b));
    if (dataSaver) return { url: sorted[0].url, hls: media.hls };
    const fitting = sorted.filter(v => shortSide(v) <= maxQuality || !Number.isFinite(shortSide(v)));
    return { url: (fitting[fitting.length - 1] ?? sorted[0]).url, hls: media.hls };
}

/** Whether a URL is https and on one of the hosts (or their subdomains). */
export function isSafeMediaUrl(url: string | undefined, hosts: readonly string[]): url is string {
    if (!url) return false;
    const m = /^https:\/\/([^/?#:@\s]+)(?:[/?#]|$)/i.exec(url);
    if (!m) return false;
    const host = m[1].toLowerCase();
    return hosts.some(h => host === h || host.endsWith(`.${h}`));
}

/** Media hosts each platform serves from (used for safety checks and desktop CSP requests). */
export const MEDIA_HOSTS = {
    x: ["pbs.twimg.com", "video.twimg.com", "abs.twimg.com"],
    reddit: ["i.redd.it", "preview.redd.it", "external-preview.redd.it", "v.redd.it", "styles.redditmedia.com", "b.thumbs.redditmedia.com", "a.thumbs.redditmedia.com", "www.redditstatic.com"],
    tiktok: ["tiktokcdn.com", "tiktokcdn-us.com", "tiktokv.com", "tiktok.com"],
    instagram: ["cdninstagram.com", "fbcdn.net"],
} as const;
