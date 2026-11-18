/*
 * Finds X, Reddit, TikTok and Instagram post links in message text.
 *
 * URLs are parsed by hand: React Native's URL polyfill isn't complete, and this
 * runs during chat row generation, so it must be fast and never throw.
 */

import type { Platform, PostRef } from "./model";

const X_HOSTS = new Set(["x.com", "twitter.com", "fxtwitter.com", "fixupx.com", "vxtwitter.com", "fixvx.com", "twittpr.com", "nitter.net"]);
const REDDIT_HOSTS = new Set(["reddit.com", "rxddit.com", "vxreddit.com"]);
const TIKTOK_HOSTS = new Set(["tiktok.com", "vxtiktok.com", "tnktok.com", "tiktxk.com"]);
const TIKTOK_SHORT_HOSTS = new Set(["vm.tiktok.com", "vt.tiktok.com"]);
const INSTAGRAM_HOSTS = new Set(["instagram.com", "ddinstagram.com", "kkinstagram.com", "instagramez.com"]);

/** Subdomains that are the same site (www.x.com, old.reddit.com, m.tiktok.com, …). */
const SAME_SITE_PREFIXES = ["www.", "m.", "mobile.", "old.", "new.", "np.", "sh.", "i.", "d."];

interface SplitUrl {
    host: string;
    /** Path segments, decoded, without empty ones. */
    segments: string[];
}

function splitUrl(url: string): SplitUrl | null {
    const match = /^https?:\/\/([^/?#\s]+)([^?#\s]*)/i.exec(url);
    if (!match) return null;
    let host = match[1].toLowerCase();
    const at = host.lastIndexOf("@");
    if (at !== -1) host = host.slice(at + 1);
    host = host.replace(/:\d+$/, "").replace(/\.$/, "");
    const segments: string[] = [];
    for (const part of match[2].split("/")) {
        if (!part) continue;
        try {
            segments.push(decodeURIComponent(part));
        } catch {
            segments.push(part);
        }
    }
    return { host, segments };
}

function baseHost(host: string, known: Set<string>): string | null {
    if (known.has(host)) return host;
    for (const prefix of SAME_SITE_PREFIXES) {
        if (host.startsWith(prefix) && known.has(host.slice(prefix.length))) return host.slice(prefix.length);
    }
    return null;
}

const isDigits = (s: string | undefined): s is string => !!s && /^\d{1,25}$/.test(s);
const isBase36 = (s: string | undefined): s is string => !!s && /^[a-z0-9]{1,12}$/i.test(s);
const isShortcode = (s: string | undefined): s is string => !!s && /^[A-Za-z0-9_-]{5,64}$/.test(s);
const isHandle = (s: string | undefined): s is string => !!s && /^[A-Za-z0-9_.]{1,50}$/.test(s);

function ref(platform: Platform, id: string, url: string, canonicalUrl: string, extra?: Partial<PostRef>): PostRef {
    return { platform, id, url, canonicalUrl, ...extra };
}

function parseX(url: string, { segments }: SplitUrl): PostRef | null {
    // /<user>/status/<id>[/photo/1], /i/status/<id>, /i/web/status/<id>, /<user>/statuses/<id>
    for (let i = 0; i < segments.length - 1; i++) {
        const s = segments[i].toLowerCase();
        if ((s === "status" || s === "statuses") && isDigits(segments[i + 1])) {
            const user = i > 0 && segments[i - 1].toLowerCase() !== "web" && isHandle(segments[i - 1]) ? segments[i - 1] : "i";
            const id = segments[i + 1];
            return ref("x", id, url, `https://x.com/${user}/status/${id}`);
        }
    }
    return null;
}

function parseReddit(url: string, { host, segments }: SplitUrl): PostRef | null {
    if (host === "redd.it" || host === "www.redd.it") {
        return isBase36(segments[0]) ? ref("reddit", segments[0].toLowerCase(), url, `https://www.reddit.com/comments/${segments[0].toLowerCase()}`) : null;
    }
    // /r/<sub>/s/<code>: share link, resolved by following the redirect
    if ((segments[0] === "r" || segments[0] === "u" || segments[0] === "user") && segments[2] === "s" && isShortcode(segments[3])) {
        return ref("reddit", "", url, url, { shortLink: true });
    }
    const at = segments.indexOf("comments");
    if (at === -1 || !isBase36(segments[at + 1])) return null;
    const id = segments[at + 1].toLowerCase();
    // /comments/<id>/<slug>/<commentId>
    const commentId = isBase36(segments[at + 3]) ? segments[at + 3].toLowerCase() : undefined;
    const canonical = commentId
        ? `https://www.reddit.com/comments/${id}/_/${commentId}`
        : `https://www.reddit.com/comments/${id}`;
    return ref("reddit", id, url, canonical, commentId ? { commentId } : undefined);
}

function parseTikTok(url: string, { host, segments }: SplitUrl): PostRef | null {
    if (TIKTOK_SHORT_HOSTS.has(host)) {
        return isShortcode(segments[0]) ? ref("tiktok", "", url, url, { shortLink: true }) : null;
    }
    if (segments[0] === "t" && isShortcode(segments[1])) return ref("tiktok", "", url, url, { shortLink: true });
    // /@user/video/<id>, /@user/photo/<id>, /embed/v2/<id>, /v/<id>.html
    if (segments[0]?.startsWith("@") && (segments[1] === "video" || segments[1] === "photo") && isDigits(segments[2])) {
        const user = segments[0].slice(1);
        return ref("tiktok", segments[2], url, `https://www.tiktok.com/@${user}/${segments[1]}/${segments[2]}`);
    }
    if (segments[0] === "embed" && isDigits(segments[segments.length - 1])) {
        const id = segments[segments.length - 1];
        return ref("tiktok", id, url, `https://www.tiktok.com/@_/video/${id}`);
    }
    if (segments[0] === "v" && /^\d{1,25}\.html$/.test(segments[1] ?? "")) {
        const id = segments[1].slice(0, -5);
        return ref("tiktok", id, url, `https://www.tiktok.com/@_/video/${id}`);
    }
    return null;
}

function parseInstagram(url: string, { segments }: SplitUrl): PostRef | null {
    // /p/<code>, /reel/<code>, /reels/<code>, /tv/<code>, also /<user>/p/<code>
    for (let i = 0; i < Math.min(segments.length - 1, 2); i++) {
        const kind = segments[i].toLowerCase();
        if ((kind === "p" || kind === "reel" || kind === "reels" || kind === "tv") && isShortcode(segments[i + 1])) {
            const code = segments[i + 1];
            const path = kind === "p" ? "p" : kind === "tv" ? "tv" : "reel";
            return ref("instagram", code, url, `https://www.instagram.com/${path}/${code}/`);
        }
    }
    return null;
}

/** Parses one URL. Returns null for anything that isn't a post link on a supported platform. */
export function parseLink(url: string): PostRef | null {
    const split = splitUrl(url);
    if (!split) return null;
    const { host } = split;
    if (baseHost(host, X_HOSTS)) return parseX(url, split);
    if (host === "redd.it" || host === "www.redd.it" || baseHost(host, REDDIT_HOSTS)) return parseReddit(url, split);
    if (TIKTOK_SHORT_HOSTS.has(host) || baseHost(host, TIKTOK_HOSTS)) return parseTikTok(url, split);
    if (baseHost(host, INSTAGRAM_HOSTS)) return parseInstagram(url, split);
    return null;
}

// URL characters Discord's own linkifier stops at, plus trailing punctuation it trims.
// Not "_" or "-": Instagram shortcodes can end with them.
const URL_RE = /https?:\/\/[^\s<>|"]+/gi;
const TRAILING = /[.,!?:;)\]}'*~]+$/;

/** Character ranges that are inside ||spoilers||. */
function spoilerRanges(content: string): [number, number][] {
    const ranges: [number, number][] = [];
    let start = -1;
    for (let i = content.indexOf("||"); i !== -1; i = content.indexOf("||", i + 2)) {
        if (start === -1) start = i + 2;
        else {
            ranges.push([start, i]);
            start = -1;
        }
    }
    return ranges;
}

/** Character ranges inside `code` / ```code blocks```, where Discord shows no link. */
function codeRanges(content: string): [number, number][] {
    const ranges: [number, number][] = [];
    const re = /```[\s\S]*?```|`[^`\n]*`/g;
    for (let m = re.exec(content); m; m = re.exec(content)) ranges.push([m.index, m.index + m[0].length]);
    return ranges;
}

const inside = (ranges: [number, number][], at: number) => ranges.some(([s, e]) => at >= s && at < e);

/**
 * Every supported post link in a message, in order, without duplicates.
 * Links in <angle brackets> (embeds suppressed by the author) and in code are skipped.
 */
export function findLinks(content: string | null | undefined, limit = 5): PostRef[] {
    if (!content || content.indexOf("http") === -1) return [];
    const spoilers = spoilerRanges(content);
    const code = codeRanges(content);
    const out: PostRef[] = [];
    const seen = new Set<string>();
    URL_RE.lastIndex = 0;
    for (let m = URL_RE.exec(content); m && out.length < limit; m = URL_RE.exec(content)) {
        const at = m.index;
        if (content[at - 1] === "<" || inside(code, at)) continue;
        // Markdown link [text](url): the url ends at the closing parenthesis
        let raw = m[0];
        if (content[at - 1] === "(" && content[at - 2] === "]") {
            const close = raw.indexOf(")");
            if (close !== -1) raw = raw.slice(0, close);
        }
        const url = raw.replace(TRAILING, "");
        const found = parseLink(url);
        if (!found) continue;
        const key = found.shortLink ? url : `${found.platform}:${found.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (inside(spoilers, at)) found.spoiler = true;
        out.push(found);
    }
    return out;
}

/** The stable cache key for a resolved ref. */
export const refKey = (r: Pick<PostRef, "platform" | "id">) => `${r.platform}:${r.id}`;
