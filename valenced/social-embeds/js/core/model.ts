/*
 * The normalized post model every resolver produces and every card renders.
 * Platform-free: no React, no React Native, no Vencord imports (shared with
 * vencord/socialEmbeds/core by .github/scripts/sync-social-core.mjs).
 */

export type Platform = "x" | "reddit" | "tiktok" | "instagram";

/** A link found in a message, before anything is fetched. */
export interface PostRef {
    platform: Platform;
    /** Post id (X status id, Reddit base36 id, TikTok video id, Instagram shortcode). Empty while `shortLink` is set. */
    id: string;
    /** The link as written in the message. */
    url: string;
    /** Canonical link on the platform's own site (used for "Open in app"). */
    canonicalUrl: string;
    /** Set for share / short links (vm.tiktok.com, reddit /s/ links) that must be resolved first by following the redirect. */
    shortLink?: boolean;
    /** Reddit: a comment the link points at. */
    commentId?: string;
    /** The link was inside a spoiler (||…||). */
    spoiler?: boolean;
}

/** Inline text with styles and entities, rendered by both UIs as plain text runs (never as HTML). */
export type RichText = Segment[];

export type Segment =
    | { type: "text"; text: string; bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean; }
    | { type: "link"; text: string; url: string; }
    | { type: "mention"; text: string; url: string; }
    | { type: "hashtag"; text: string; url: string; }
    | { type: "break"; };

export interface MediaVariant {
    url: string;
    width?: number;
    height?: number;
    /** Video only, bits per second. */
    bitrate?: number;
    /** MIME type when known (video/mp4, application/x-mpegURL, image/jpeg, …). */
    contentType?: string;
}

export interface Media {
    kind: "photo" | "video" | "gif";
    /** Full-size width and height in pixels (0 when unknown). */
    width: number;
    height: number;
    /** Best full-size URL (photo: original; video: highest quality mp4). */
    url: string;
    /** Still image for videos and gifs (and a small photo version when the platform has one). */
    thumbnail?: string;
    /** Every size the platform offers, smallest first. */
    variants: MediaVariant[];
    alt?: string;
    durationMs?: number;
    /** HLS playlist with audio (Reddit videos, whose mp4 fallback has no sound). */
    hls?: string;
    /** False when only a still is known and the video must play on the platform (TikTok without a direct file). */
    playable?: boolean;
}

export interface Author {
    name: string;
    /** @handle, u/name, or the Instagram / TikTok username, without the prefix. */
    handle: string;
    avatar?: string;
    url?: string;
    verified?: boolean;
}

export interface PollOption {
    label: string;
    votes: number;
    /** 0–100. */
    percent: number;
}

export interface Poll {
    options: PollOption[];
    totalVotes: number;
    /** Unix ms. */
    endsAt?: number;
    ended: boolean;
}

export interface Stats {
    replies?: number;
    reposts?: number;
    likes?: number;
    views?: number;
    bookmarks?: number;
    /** Reddit score (upvotes minus downvotes). */
    score?: number;
    /** Reddit / TikTok / Instagram comment count. */
    comments?: number;
    /** Reddit, 0–1. */
    upvoteRatio?: number;
}

export interface ExternalLink {
    url: string;
    title?: string;
    domain?: string;
    thumbnail?: string;
}

export interface Post {
    platform: Platform;
    id: string;
    /** Canonical post URL. */
    url: string;
    author: Author;
    /** Reddit post title. */
    title?: string;
    text: RichText;
    /** Unix ms (0 when unknown). */
    createdAt: number;
    media: Media[];
    quote?: Post;
    poll?: Poll;
    stats: Stats;
    /** Reddit subreddit ("r/…" without the prefix). */
    community?: string;
    flair?: string;
    nsfw: boolean;
    spoiler: boolean;
    replyingTo?: string;
    /** Link posts (Reddit link, X card). */
    external?: ExternalLink;
}

export interface Comment {
    id: string;
    author: Author;
    text: RichText;
    createdAt: number;
    score?: number;
    likes?: number;
    replies: Comment[];
    /** Replies that weren't loaded (Reddit "more" stubs). */
    moreReplies?: number;
    depth: number;
    isOp?: boolean;
    pinned?: boolean;
    collapsed?: boolean;
}

export interface Thread {
    post: Post;
    /** Loaded top-level comments / replies, when the source includes them. */
    comments?: Comment[];
    /** Top-level comments that weren't loaded. */
    moreComments?: number;
}
