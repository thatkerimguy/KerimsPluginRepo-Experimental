/*
 * Reddit posts and comments from the public JSON (www.reddit.com/comments/<id>.json):
 * galleries (media_metadata, up to 20), Reddit-hosted video (HLS with sound),
 * images, link posts, crossposts, and the comment tree.
 */

import type { HttpClient } from "../fetcher";
import { NotFoundError, ParseError } from "../fetcher";
import { isSafeMediaUrl, MEDIA_HOSTS } from "../media";
import type { Comment, Media, MediaVariant, Post, Thread } from "../model";
import { decodeEntities, linkify, redditMarkdown } from "../text";

export const REDDIT_ORIGIN = "https://www.reddit.com";
const SAFE = MEDIA_HOSTS.reddit;

/* The parts of Reddit's listing JSON we read. */
interface RImage { u?: string; gif?: string; mp4?: string; x?: number; y?: number; }
interface RMediaMeta { status?: string; e?: string; m?: string; s?: RImage; p?: RImage[]; }
interface RPreviewImage { url?: string; width?: number; height?: number; }
interface RVideo { fallback_url?: string; hls_url?: string; width?: number; height?: number; duration?: number; is_gif?: boolean; }

export interface RPost {
    id: string;
    title?: string;
    selftext?: string;
    author?: string;
    subreddit?: string;
    created_utc?: number;
    score?: number;
    num_comments?: number;
    upvote_ratio?: number;
    over_18?: boolean;
    spoiler?: boolean;
    permalink?: string;
    url?: string;
    domain?: string;
    is_self?: boolean;
    is_video?: boolean;
    is_gallery?: boolean;
    post_hint?: string;
    link_flair_text?: string | null;
    gallery_data?: { items?: { media_id: string; caption?: string; }[]; };
    media_metadata?: Record<string, RMediaMeta>;
    preview?: {
        images?: { source?: RPreviewImage; resolutions?: RPreviewImage[]; variants?: { mp4?: { source?: RPreviewImage; resolutions?: RPreviewImage[]; }; }; }[];
        reddit_video_preview?: RVideo;
    };
    secure_media?: { reddit_video?: RVideo; } | null;
    media?: { reddit_video?: RVideo; } | null;
    crosspost_parent_list?: RPost[];
    thumbnail?: string;
}

interface RComment {
    id: string;
    author?: string;
    body?: string;
    created_utc?: number;
    score?: number;
    depth?: number;
    stickied?: boolean;
    is_submitter?: boolean;
    collapsed?: boolean;
    replies?: RListing | "";
}

interface RThing { kind: string; data: any; }
interface RListing { kind: "Listing"; data: { children: RThing[]; }; }

const clean = (url: string | undefined) => (url ? decodeEntities(url) : undefined);

function imageVariants(source: RPreviewImage | undefined, resolutions: RPreviewImage[] | undefined): MediaVariant[] {
    const out: MediaVariant[] = [];
    for (const r of [...(resolutions ?? []), ...(source ? [source] : [])]) {
        const url = clean(r.url);
        if (isSafeMediaUrl(url, SAFE)) out.push({ url, width: r.width, height: r.height });
    }
    return out.sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
}

function galleryMedia(post: RPost): Media[] {
    const items = post.gallery_data?.items ?? [];
    const meta = post.media_metadata ?? {};
    const out: Media[] = [];
    for (const item of items) {
        const m = meta[item.media_id];
        if (!m || m.status !== "valid" || !m.s) continue;
        const width = m.s.x ?? 0;
        const height = m.s.y ?? 0;
        if (m.e === "AnimatedImage") {
            const mp4 = clean(m.s.mp4);
            const gif = clean(m.s.gif);
            const url = isSafeMediaUrl(mp4, SAFE) ? mp4 : isSafeMediaUrl(gif, SAFE) ? gif : undefined;
            if (!url) continue;
            const still = (m.p ?? []).map(p => clean(p.u)).filter(u => isSafeMediaUrl(u, SAFE)).pop();
            out.push({
                kind: "gif",
                width,
                height,
                url,
                thumbnail: still,
                variants: [{ url, width, height, contentType: url === mp4 ? "video/mp4" : "image/gif" }],
                alt: item.caption || undefined,
            });
            continue;
        }
        const variants: MediaVariant[] = [];
        for (const p of m.p ?? []) {
            const u = clean(p.u);
            if (isSafeMediaUrl(u, SAFE)) variants.push({ url: u, width: p.x, height: p.y });
        }
        const full = clean(m.s.u);
        if (isSafeMediaUrl(full, SAFE)) variants.push({ url: full, width, height, contentType: m.m });
        if (!variants.length) continue;
        variants.sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
        out.push({
            kind: "photo",
            width,
            height,
            url: variants[variants.length - 1].url,
            thumbnail: variants[0].url,
            variants,
            alt: item.caption || undefined,
        });
    }
    return out;
}

function videoMedia(v: RVideo, still?: string): Media | null {
    const fallback = clean(v.fallback_url);
    if (!isSafeMediaUrl(fallback, SAFE)) return null;
    const hls = clean(v.hls_url);
    return {
        kind: v.is_gif ? "gif" : "video",
        width: v.width ?? 0,
        height: v.height ?? 0,
        url: fallback,
        thumbnail: still,
        variants: [{ url: fallback, width: v.width, height: v.height, contentType: "video/mp4" }],
        durationMs: v.duration ? v.duration * 1000 : undefined,
        // The mp4 fallback has no audio; the HLS playlist does
        hls: isSafeMediaUrl(hls, SAFE) ? hls : undefined,
    };
}

function postMedia(post: RPost): Media[] {
    if (post.is_gallery) return galleryMedia(post);
    const preview = post.preview?.images?.[0];
    const stills = imageVariants(preview?.source, preview?.resolutions);
    const still = stills[Math.min(stills.length - 1, 2)]?.url;
    const video = post.secure_media?.reddit_video ?? post.media?.reddit_video ?? post.preview?.reddit_video_preview;
    if (video) {
        const m = videoMedia(video, still);
        if (m) return [m];
    }
    const direct = clean(post.url);
    // i.redd.it images (and gifs as mp4 previews)
    if (post.post_hint === "image" || (direct && /^https:\/\/i\.redd\.it\//.test(direct))) {
        const gif = preview?.variants?.mp4;
        if (gif?.source && /\.gif(\?|$)/i.test(direct ?? "")) {
            const variants = imageVariants(gif.source, gif.resolutions).map(v => ({ ...v, contentType: "video/mp4" }));
            if (variants.length) {
                const top = variants[variants.length - 1];
                return [{ kind: "gif", width: top.width ?? 0, height: top.height ?? 0, url: top.url, thumbnail: still, variants }];
            }
        }
        if (stills.length) {
            const top = stills[stills.length - 1];
            const full = isSafeMediaUrl(direct, SAFE) ? direct : top.url;
            return [{ kind: "photo", width: top.width ?? 0, height: top.height ?? 0, url: full, thumbnail: stills[0].url, variants: stills }];
        }
    }
    return [];
}

function author(name: string | undefined) {
    const handle = name ?? "[deleted]";
    return { name: handle, handle, url: name && name !== "[deleted]" ? `${REDDIT_ORIGIN}/user/${name}` : undefined };
}

/** Reddit post JSON → Post. Exported for tests. */
export function parsePost(p: RPost): Post {
    if (!p || typeof p.id !== "string") throw new ParseError("Reddit post without id");
    // A crosspost shows the original post as a quote (with its media), like the app
    const source = p.crosspost_parent_list?.[0];
    const media = postMedia(p);
    const external = !source && !p.is_self && !p.is_video && !p.is_gallery && !media.length && p.url && !/reddit\.com|redd\.it/.test(p.domain ?? "")
        ? { url: clean(p.url)!, domain: p.domain, title: undefined, thumbnail: isSafeMediaUrl(clean(p.thumbnail), SAFE) ? clean(p.thumbnail) : undefined }
        : undefined;
    return {
        platform: "reddit",
        id: p.id,
        url: `${REDDIT_ORIGIN}${p.permalink ?? `/comments/${p.id}`}`,
        author: author(p.author),
        title: decodeEntities(p.title ?? ""),
        text: redditMarkdown(p.selftext ?? ""),
        createdAt: p.created_utc ? p.created_utc * 1000 : 0,
        media: source ? [] : media,
        quote: source ? parsePost({ ...source, crosspost_parent_list: undefined }) : undefined,
        stats: { score: p.score, comments: p.num_comments, upvoteRatio: p.upvote_ratio },
        community: p.subreddit,
        flair: p.link_flair_text || undefined,
        nsfw: !!p.over_18,
        spoiler: !!p.spoiler,
        external,
    };
}

function parseComments(things: RThing[] | undefined, depth: number, maxDepth: number): { comments: Comment[]; more: number; } {
    const comments: Comment[] = [];
    let more = 0;
    for (const t of things ?? []) {
        if (t.kind === "more") {
            more += Number(t.data?.count) || 0;
            continue;
        }
        if (t.kind !== "t1") continue;
        const c = t.data as RComment;
        const nested = depth < maxDepth && c.replies && typeof c.replies === "object"
            ? parseComments(c.replies.data?.children, depth + 1, maxDepth)
            : { comments: [], more: 0 };
        comments.push({
            id: c.id,
            author: author(c.author),
            text: c.body ? redditMarkdown(c.body) : linkify("[deleted]", "reddit"),
            createdAt: c.created_utc ? c.created_utc * 1000 : 0,
            score: c.score,
            replies: nested.comments,
            moreReplies: nested.more || undefined,
            depth,
            isOp: c.is_submitter || undefined,
            pinned: c.stickied || undefined,
            collapsed: c.collapsed || undefined,
        });
    }
    return { comments, more };
}

/** The [post listing, comment listing] pair → Thread. Exported for tests. */
export function parseThread(json: unknown, maxDepth = 6): Thread {
    if (!Array.isArray(json) || json.length < 1) throw new ParseError("Reddit thread JSON is not a listing pair");
    const postThing = (json[0] as RListing)?.data?.children?.[0];
    if (postThing?.kind !== "t3") throw new ParseError("Reddit thread without a post");
    const { comments, more } = parseComments((json[1] as RListing | undefined)?.data?.children, 0, maxDepth);
    return { post: parsePost(postThing.data), comments, moreComments: more || undefined };
}

export async function resolveReddit(id: string, http: HttpClient, opts: { commentId?: string; limit?: number; } = {}): Promise<Thread> {
    const path = opts.commentId ? `/comments/${id}/_/${opts.commentId}` : `/comments/${id}`;
    const json = await http.getJson(`${REDDIT_ORIGIN}${path}.json?raw_json=1&limit=${opts.limit ?? 50}&depth=6`);
    if (Array.isArray(json) && !(json[0] as RListing)?.data?.children?.length) throw new NotFoundError();
    return parseThread(json);
}
