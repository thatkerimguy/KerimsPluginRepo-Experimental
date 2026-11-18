/*
 * X posts through the FxEmbed API (api.fxtwitter.com/i/status/<id>): text with
 * t.co links already expanded, every photo and video (up to 20 since 2026-11),
 * quote, poll and counts, no login.
 */

import type { HttpClient } from "../fetcher";
import { NotFoundError, ParseError } from "../fetcher";
import { isSafeMediaUrl, MEDIA_HOSTS } from "../media";
import type { Media, MediaVariant, Poll, Post, Thread } from "../model";
import { decodeEntities, linkify } from "../text";

export const X_API = "https://api.fxtwitter.com";

/* The parts of FxEmbed's API response we read (github.com/FxEmbed/FxEmbed, APITwitterStatus). */
interface FxAuthor {
    name?: string;
    screen_name?: string;
    avatar_url?: string;
    url?: string;
    verification?: { verified?: boolean; };
}

interface FxPhoto {
    type: "photo";
    url: string;
    width?: number;
    height?: number;
    altText?: string;
}

interface FxVideo {
    type: "video" | "gif";
    url: string;
    thumbnail_url?: string;
    width?: number;
    height?: number;
    duration?: number;
    format?: string;
    variants?: { content_type?: string; bitrate?: number; url: string; }[];
}

interface FxPoll {
    choices?: { label?: string; count?: number; percentage?: number; }[];
    total_votes?: number;
    ends_at?: string;
    time_left_en?: string;
}

export interface FxStatus {
    id: string;
    url?: string;
    text?: string;
    author?: FxAuthor;
    replies?: number;
    retweets?: number;
    likes?: number;
    bookmarks?: number;
    views?: number | null;
    created_timestamp?: number;
    possibly_sensitive?: boolean;
    replying_to?: string | null;
    media?: { all?: (FxPhoto | FxVideo)[]; photos?: FxPhoto[]; videos?: FxVideo[]; };
    quote?: FxStatus;
    poll?: FxPoll;
}

interface FxResponse {
    code: number;
    message?: string;
    tweet?: FxStatus;
}

const SAFE = MEDIA_HOSTS.x;

/** pbs.twimg.com/media/<name>.<ext>?name=… → the four sizes X serves (small 680, medium 1200, large 2048, orig). */
export function photoVariants(url: string, width: number, height: number): MediaVariant[] {
    const m = /^https:\/\/pbs\.twimg\.com\/media\/([A-Za-z0-9_-]+)(?:\.(jpg|jpeg|png|webp))?(?:\?([^#]*))?/i.exec(url);
    if (!m) return [{ url, width: width || undefined, height: height || undefined }];
    const format = (m[2] ?? /(?:^|&)format=(\w+)/.exec(m[3] ?? "")?.[1] ?? "jpg").toLowerCase().replace("jpeg", "jpg");
    const longest = Math.max(width, height);
    const out: MediaVariant[] = [];
    for (const [name, limit] of [["small", 680], ["medium", 1200], ["large", 2048]] as const) {
        if (longest && longest <= limit) break;
        const scale = longest ? limit / longest : 1;
        out.push({
            url: `https://pbs.twimg.com/media/${m[1]}?format=${format}&name=${name}`,
            width: width ? Math.round(width * scale) : undefined,
            height: height ? Math.round(height * scale) : undefined,
            contentType: `image/${format === "jpg" ? "jpeg" : format}`,
        });
    }
    out.push({
        url: `https://pbs.twimg.com/media/${m[1]}?format=${format}&name=orig`,
        width: width || undefined,
        height: height || undefined,
        contentType: `image/${format === "jpg" ? "jpeg" : format}`,
    });
    return out;
}

function toMedia(item: FxPhoto | FxVideo): Media | null {
    if (!isSafeMediaUrl(item.url, SAFE)) return null;
    const width = item.width ?? 0;
    const height = item.height ?? 0;
    if (item.type === "photo") {
        const variants = photoVariants(item.url, width, height);
        return {
            kind: "photo",
            width,
            height,
            url: variants[variants.length - 1].url,
            thumbnail: variants[0].url,
            variants,
            alt: item.altText || undefined,
        };
    }
    const variants: MediaVariant[] = (item.variants ?? [])
        .filter(v => isSafeMediaUrl(v.url, SAFE) && (v.content_type ?? "video/mp4") === "video/mp4")
        .map(v => {
            // Resolution is in the path: /vid/avc1/720x1280/…
            const size = /\/(\d{2,4})x(\d{2,4})\//.exec(v.url);
            return {
                url: v.url,
                bitrate: v.bitrate,
                width: size ? Number(size[1]) : undefined,
                height: size ? Number(size[2]) : undefined,
                contentType: "video/mp4",
            };
        })
        .sort((a, b) => (a.bitrate ?? 0) - (b.bitrate ?? 0));
    if (!variants.length) variants.push({ url: item.url, width: width || undefined, height: height || undefined, contentType: "video/mp4" });
    const hls = item.variants?.find(v => v.content_type === "application/x-mpegURL" && isSafeMediaUrl(v.url, SAFE))?.url;
    return {
        kind: item.type === "gif" ? "gif" : "video",
        width,
        height,
        url: item.url,
        thumbnail: isSafeMediaUrl(item.thumbnail_url, SAFE) ? item.thumbnail_url : undefined,
        variants,
        durationMs: item.duration ? Math.round(item.duration * 1000) : undefined,
        hls,
    };
}

function toPoll(p: FxPoll | undefined): Poll | undefined {
    if (!p?.choices?.length) return undefined;
    const endsAt = p.ends_at ? Date.parse(p.ends_at) : NaN;
    const total = p.total_votes ?? p.choices.reduce((s, c) => s + (c.count ?? 0), 0);
    return {
        options: p.choices.map(c => ({
            label: c.label ?? "",
            votes: c.count ?? 0,
            percent: c.percentage ?? (total ? Math.round(((c.count ?? 0) / total) * 1000) / 10 : 0),
        })),
        totalVotes: total,
        endsAt: Number.isFinite(endsAt) ? endsAt : undefined,
        ended: Number.isFinite(endsAt) ? endsAt <= Date.now() : /final/i.test(p.time_left_en ?? ""),
    };
}

/** FxEmbed status → Post. Exported for tests. */
export function parseStatus(s: FxStatus, depth = 0): Post {
    if (!s || typeof s.id !== "string" || !s.author?.screen_name) throw new ParseError("FxEmbed status without id or author");
    const handle = s.author.screen_name;
    const all = s.media?.all ?? [...(s.media?.photos ?? []), ...(s.media?.videos ?? [])];
    return {
        platform: "x",
        id: s.id,
        url: `https://x.com/${handle}/status/${s.id}`,
        author: {
            name: s.author.name || handle,
            handle,
            avatar: isSafeMediaUrl(s.author.avatar_url, SAFE) ? s.author.avatar_url : undefined,
            url: `https://x.com/${handle}`,
            verified: s.author.verification?.verified || undefined,
        },
        text: linkify(decodeEntities(s.text ?? ""), "x"),
        createdAt: s.created_timestamp ? s.created_timestamp * 1000 : 0,
        media: all.map(toMedia).filter((m): m is Media => m !== null),
        // One level of quotes, like the app
        quote: s.quote && depth === 0 ? parseStatus(s.quote, 1) : undefined,
        poll: toPoll(s.poll),
        stats: {
            replies: s.replies,
            reposts: s.retweets,
            likes: s.likes,
            bookmarks: s.bookmarks,
            views: s.views ?? undefined,
        },
        nsfw: !!s.possibly_sensitive,
        spoiler: false,
        replyingTo: s.replying_to || undefined,
    };
}

export async function resolveX(id: string, http: HttpClient): Promise<Thread> {
    const res = await http.getJson<FxResponse>(`${X_API}/i/status/${encodeURIComponent(id)}`);
    if (res?.code === 404 || res?.code === 401) throw new NotFoundError(res.message);
    if (res?.code !== 200 || !res.tweet) throw new ParseError(`FxEmbed answered ${res?.code} ${res?.message ?? ""}`.trim());
    return { post: parseStatus(res.tweet) };
}
