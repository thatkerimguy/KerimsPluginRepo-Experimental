/*
 * GIFs+ — low resolution preview URL helpers.
 * Shared between the Vencord and Valenced builds (keep both copies in sync).
 *
 * Only the URL that the picker *displays* is changed. The item objects that
 * Discord sends/favourites are never modified, so the full resolution GIF is
 * what ends up in chat and in your favourites.
 *
 * URLs are parsed by hand instead of with `URL`, because React Native's `URL`
 * polyfill doesn't implement every getter and `searchParams.set` everywhere.
 */

export type Quality = "xs" | "s" | "sd" | "original";

/** Longest side (px) a downscaled image is asked for, per quality. */
export const QUALITY_CAP: Record<Exclude<Quality, "original">, number> = {
    xs: 128,
    s: 240,
    sd: 360,
};

// Tenor encodes the rendition in the last two characters of the media id.
//   image: A2 = nanowebp (90px), A1 = tinywebp (200px), Ax = webp (498px). All animated.
//          (A5 is a static frame, not usable for previews.)
//   video: P2 = nanomp4,  P1 = tinymp4 (P3 is tinywebm, which isn't an mp4)
// Checked against Tenor's API in 2026-11.
const TENOR_CODES = {
    xs: { image: "A2", video: "P2" },
    s: { image: "A1", video: "P1" },
    sd: { image: "Ax", video: "P1" },
} as const;

// Giphy rendition names
const GIPHY_CODES = {
    xs: { image: "100w", video: "100w" },
    s: { image: "200w", video: "200w" },
    sd: { image: "480w", video: "200w" },
} as const;

// Twitter / X (pbs.twimg.com) — used by vx/fx/twitter embeds
const TWITTER_NAMES = {
    xs: "240x240",
    s: "360x360",
    sd: "small",
} as const;

const TENOR_RE = /^https:\/\/(?:media\d?|c)\.tenor\.com(?:\/m)?\/([^/]+?)([A-Za-z0-9]{2})\/([^/?#]+)\.(gif|webp|mp4|webm)(?:[?#].*)?$/i;
const GIPHY_RE = /^https:\/\/(?:media\d?|i)\.giphy\.com\/(?:media\/(?:v\d\.[^/]+\/)?)?([A-Za-z0-9]+)\/?(?:[^/?#]*)\.(gif|webp|mp4)(?:[?#].*)?$/i;
const IMAGES_EXT_RE = /^images-ext-\d+\.discordapp\.net$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)$/i;
const URL_RE = /^(https?:)\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i;
// images-ext-N.discordapp.net/external/<signature>/<scheme>/<host>/<path>
const EXTERNAL_PATH_RE = /^\/external\/[^/]+\/(https?)\/(.+)$/i;
/** Hosts whose own small renditions beat resizing through Discord's proxy */
const UNWRAP_HOSTS_RE = /(^|\.)(tenor\.com|tenor\.co|giphy\.com|klipy\.com|twimg\.com)$/i;

/** Absolute https URL */
export function normalizeUrl(url: string): string {
    return url.startsWith("//") ? `https:${url}` : url;
}

/** Minimal URL model: enough to read the host/path and add query parameters */
interface ParsedUrl {
    protocol: string;
    host: string;
    hostname: string;
    pathname: string;
    /** raw (still encoded) key/value pairs, in order */
    params: [string, string][];
    hash: string;
}

function parseUrl(url: string): ParsedUrl | null {
    const m = URL_RE.exec(normalizeUrl(url));
    if (!m) return null;
    const [, protocol, host, pathname, search = "", hash = ""] = m;
    const params: [string, string][] = [];
    for (const part of search.slice(1).split("&")) {
        if (!part) continue;
        const eq = part.indexOf("=");
        params.push(eq === -1 ? [part, ""] : [part.slice(0, eq), part.slice(eq + 1)]);
    }
    return {
        protocol: protocol.toLowerCase(),
        host,
        hostname: host.replace(/:\d+$/, "").toLowerCase(),
        pathname: pathname || "/",
        params,
        hash,
    };
}

function setParam(u: ParsedUrl, key: string, value: string) {
    const v = encodeURIComponent(value);
    const existing = u.params.find(([k]) => k === key);
    if (existing) existing[1] = v;
    else u.params.push([key, v]);
}

function stringifyUrl(u: ParsedUrl): string {
    const search = u.params.length ? `?${u.params.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
    return `${u.protocol}//${u.host}${u.pathname}${search}${u.hash}`;
}

/** Path of the underlying media, also for images-ext proxied external URLs */
function mediaPath(u: ParsedUrl) {
    let path = u.pathname;
    try { path = decodeURIComponent(path); } catch { }
    return path.toLowerCase();
}

/**
 * For a URL behind Discord's external media proxy (images-ext), returns the URL it
 * proxies. Favourites saved from chat embeds (Tenor, Klipy, vx/fx links) are stored
 * like that. Returns null for anything else.
 */
export function unwrapProxyUrl(url: string): string | null {
    const u = parseUrl(url);
    if (!u || !IMAGES_EXT_RE.test(u.hostname)) return null;
    const m = EXTERNAL_PATH_RE.exec(u.pathname);
    if (!m) return null;
    let rest = m[2];
    try { rest = decodeURIComponent(rest); } catch { }
    return `${m[1].toLowerCase()}://${rest}`;
}

/** The URL to work out previews from: the proxied URL for known GIF hosts, else `url` itself */
function sourceUrl(url: string): string {
    const inner = unwrapProxyUrl(url);
    if (inner) {
        const host = parseUrl(inner)?.hostname;
        if (host && UNWRAP_HOSTS_RE.test(host)) return inner;
    }
    return normalizeUrl(url);
}

/**
 * For a URL Discord's media proxy can resize (CDN attachments, media.discordapp.net,
 * images-ext), points it at the proxy and returns true. False for anything else.
 */
function toMediaProxy(u: ParsedUrl): boolean {
    const isCdnAttachment = u.hostname === "cdn.discordapp.com" && /^\/(ephemeral-)?attachments\//.test(u.pathname);
    if (isCdnAttachment) u.host = u.hostname = "media.discordapp.net";
    return isCdnAttachment || u.hostname === "media.discordapp.net" || IMAGES_EXT_RE.test(u.hostname);
}

/**
 * Asks the media proxy for `quality`'s size, keeping the aspect ratio and never
 * bigger than the original. False when the original is known to be no bigger.
 */
function setProxySize(u: ParsedUrl, quality: Exclude<Quality, "original">, dims?: { width?: number; height?: number; }): boolean {
    const cap = QUALITY_CAP[quality];
    const w = dims?.width ?? 0;
    const h = dims?.height ?? 0;
    if (!(w > 0 && h > 0)) {
        setParam(u, "width", String(cap));
        return true;
    }
    const scale = Math.min(1, cap / Math.max(w, h));
    setParam(u, "width", String(Math.max(1, Math.round(w * scale))));
    setParam(u, "height", String(Math.max(1, Math.round(h * scale))));
    return scale < 1;
}

export function isVideoUrl(url: string): boolean {
    const u = parseUrl(url);
    return u != null && VIDEO_EXT_RE.test(mediaPath(u));
}

export function isKlipyUrl(url: string): boolean {
    const u = parseUrl(sourceUrl(url));
    return u != null && /(^|\.)klipy\.com$/i.test(u.hostname);
}

export interface RewriteOptions {
    /**
     * Always return an (animated) image, never a video. Discord mobile shows every
     * GIF picker tile with an image component, which can't play mp4/webm.
     */
    imagesOnly?: boolean;
}

/**
 * Returns a lower resolution URL for `src` that can be derived from the URL alone,
 * or null if none is known. Keeps the media category (video stays video, image
 * stays image) so the picker renders it with the same element type, unless
 * `imagesOnly` asks for images only.
 */
export function rewriteUrl(src: string, quality: Quality, dims?: { width?: number; height?: number; }, opts?: RewriteOptions): string | null {
    if (quality === "original" || !src) return null;
    const url = sourceUrl(src);
    const imagesOnly = opts?.imagesOnly === true;

    // Tenor
    const tenor = url.match(TENOR_RE);
    if (tenor) {
        const [, id, , name, ext] = tenor;
        const video = !imagesOnly && (ext === "mp4" || ext === "webm");
        const code = TENOR_CODES[quality][video ? "video" : "image"];
        return `https://media.tenor.com/${id}${code}/${name}.${video ? "mp4" : "webp"}`;
    }

    // Giphy
    const giphy = url.match(GIPHY_RE);
    if (giphy) {
        const [, id, ext] = giphy;
        const video = !imagesOnly && ext === "mp4";
        const code = GIPHY_CODES[quality][video ? "video" : "image"];
        return `https://media.giphy.com/media/${id}/${code}.${video ? "mp4" : "webp"}`;
    }

    const u = parseUrl(url);
    if (!u) return null;
    const host = u.hostname;

    // Twitter / X images (vx/fx/twitter embeds)
    if (host === "pbs.twimg.com" && /^\/(media|ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\//.test(u.pathname)) {
        if (u.pathname.startsWith("/media/")) {
            setParam(u, "name", TWITTER_NAMES[quality]);
            return stringifyUrl(u);
        }
        return null;
    }

    // Discord CDN, media proxy and external media proxy (images-ext, used for vx/fx/twitter and every other embed)
    const path = mediaPath(u);
    if (toMediaProxy(u)) {
        const isVideo = VIDEO_EXT_RE.test(path);
        // Desktop plays these as videos, and the media proxy can't shrink a video into
        // a video. Mobile shows proxied videos as animated webp (`animated=true`, like
        // Discord mobile itself), and that can be resized like any image.
        if (isVideo && !(imagesOnly && IMAGES_EXT_RE.test(host))) return null;

        // Already small: only worth proxying to turn a GIF or video into webp
        if (!setProxySize(u, quality, dims) && !path.endsWith(".gif") && !isVideo) return null;

        // Anything that may be animated (GIF, webp, avif, video, unknown) stays animated as webp
        if (!/\.(png|jpe?g)$/.test(path)) {
            setParam(u, "format", "webp");
            setParam(u, "animated", "true");
        }
        return stringifyUrl(u);
    }

    return null;
}

// Still (non-animated) renditions, for "still previews in favourites"
//   Tenor: PNG poster frames. Ag = nano, AN = tiny, Ae = medium, AD = full size
const TENOR_STILL_CODES: Record<Quality, string> = { xs: "Ag", s: "AN", sd: "Ae", original: "AD" };
//   Giphy: single frame renditions
const GIPHY_STILL_NAMES: Record<Quality, string> = { xs: "100w_s.gif", s: "200w_s.gif", sd: "480w_s.jpg", original: "giphy_s.gif" };
const TWITTER_VIDEO_RE = /^https:\/\/video\.twimg\.com\/tweet_video\/([A-Za-z0-9_-]+)\.mp4(?:[?#].*)?$/i;

/**
 * Returns the URL of a still (first frame, not animated) image for `src`, or null
 * if none can be derived from the URL. The result is always an image, also for videos.
 */
export function stillUrl(src: string, quality: Quality, dims?: { width?: number; height?: number; }): string | null {
    if (!src) return null;
    const url = sourceUrl(src);

    const tenor = url.match(TENOR_RE);
    if (tenor) {
        const [, id, , name] = tenor;
        return `https://media.tenor.com/${id}${TENOR_STILL_CODES[quality]}/${name}.png`;
    }

    const giphy = url.match(GIPHY_RE);
    if (giphy) return `https://media.giphy.com/media/${giphy[1]}/${GIPHY_STILL_NAMES[quality]}`;

    // Twitter GIFs are mp4s with a matching thumbnail
    const twVideo = url.match(TWITTER_VIDEO_RE);
    if (twVideo) return `https://pbs.twimg.com/tweet_video_thumb/${twVideo[1]}.jpg`;

    const u = parseUrl(url);
    if (!u) return null;
    const host = u.hostname;

    // pbs.twimg.com images are already still
    if (host === "pbs.twimg.com") return quality === "original" ? url : rewriteUrl(url, quality, dims) ?? url;

    // Discord's media proxy returns the first frame unless `animated=true` is asked for,
    // and a thumbnail for videos
    if (toMediaProxy(u)) {
        u.params = u.params.filter(([k]) => k !== "animated");
        if (quality !== "original") setProxySize(u, quality, dims);
        setParam(u, "format", VIDEO_EXT_RE.test(mediaPath(u)) ? "jpeg" : "webp");
        return stringifyUrl(u);
    }

    return null;
}

/**
 * media_format to ask Discord's /gifs API for, to get a lower resolution rendition
 * of Klipy results (Klipy uses a different random file name per rendition, so they
 * cannot be derived from the full resolution URL). Returns null when Discord's
 * default is already as small as or smaller than the wanted quality.
 */
export function lowResMediaFormat(selectedFormat: string, quality: Quality): string | null {
    if (quality === "original" || quality === "sd") return null;
    const fmt = selectedFormat.toLowerCase();
    const isWebp = fmt.includes("webp");
    const isMp4 = fmt.includes("mp4");
    const family = isWebp ? "webp" : isMp4 ? "mp4" : "webm";
    const wanted = quality === "xs" ? "nano" : "tiny";

    if (fmt.startsWith("nano")) return null;
    if (fmt.startsWith("tiny") && wanted === "tiny") return null;
    return wanted + family;
}

// Discord mobile turns Tenor favourites into `<tenor page URL>.gif`, which redirects
// to the full size GIF on media.tenor.com
const TENOR_PAGE_GIF_RE = /^https?:\/\/(?:www\.)?tenor\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?view\/[^?#]+\.gif(?:[?#].*)?$/i;

export function isTenorPageGif(url: string): boolean {
    return TENOR_PAGE_GIF_RE.test(normalizeUrl(url));
}

/** Whether `url` is a Tenor media URL that `rewriteUrl` understands */
export function isTenorMediaUrl(url: string): boolean {
    return TENOR_RE.test(normalizeUrl(url));
}

/**
 * The Tenor media URL a saved favourite's src points at, directly or through
 * Discord's images-ext proxy, or null when it isn't one. Discord mobile shows
 * Tenor favourites as their page URL, but the saved src still holds the media URL.
 */
export function tenorMediaFromSrc(src: string | undefined): string | null {
    if (!src) return null;
    const plain = normalizeUrl(src);
    const url = unwrapProxyUrl(plain) ?? plain;
    return isTenorMediaUrl(url) ? url : null;
}

/* -------------------------------------------------------------------------- */
/*                         Klipy favourites lookup                            */
/* -------------------------------------------------------------------------- */

const KLIPY_PAGE_RE = /^https?:\/\/(?:www\.)?klipy\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:gifs?|stickers?|clips?)\/([^/?#]+)/i;

/** Search query for a Klipy page URL (`https://klipy.com/gifs/guh-lexa-fortnite` -> `guh lexa fortnite`) */
export function klipyPageQuery(pageUrl: string | undefined): string | null {
    const m = pageUrl && KLIPY_PAGE_RE.exec(normalizeUrl(pageUrl));
    if (!m) return null;
    let slug = m[1];
    try { slug = decodeURIComponent(slug); } catch { }
    const q = slug.replace(/[-_]+/g, " ").trim();
    return q || null;
}

/** Compares page URLs, ignoring scheme, www, letter case, query and trailing slash */
export function pageKey(url: string | undefined): string {
    return normalizeUrl(url ?? "")
        .replace(/^https?:\/\//i, "")
        .replace(/^www\./i, "")
        .replace(/[?#].*$/, "")
        .replace(/\/+$/, "")
        .toLowerCase();
}

/**
 * media_formats to look a Klipy favourite up with, best first. Favourites are
 * usually stored as the full size .gif, so images get a small webp; videos keep
 * their family.
 */
export function klipyFavoriteFormats(originalIsVideo: boolean, selectedFormat: string, quality: Quality): string[] {
    if (quality === "original") return [];
    if (originalIsVideo) {
        const f = lowResMediaFormat(selectedFormat, quality);
        return f ? [f] : [];
    }
    return quality === "xs" ? ["nanowebp", "tinywebp"] : ["tinywebp"];
}
