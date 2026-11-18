/*
 * The placeholder an island takes in Discord's row data: an image embed whose
 * URL is a marker on the reserved .invalid domain (never downloads). The native
 * part recognises the marker when the chat's image view receives it and puts the
 * island's React surface there.
 *
 * Shared format with the Kotlin side (MarkerHook.kt): keep both in sync.
 */

import type { IslandEmbed } from "./api";

export const MARKER_PREFIX = "https://chat-islands.invalid/i/";

export interface Marker {
    key: string;
    /** Width and height in density-independent pixels. */
    width: number;
    height: number;
}

export function encodeMarker({ key, width, height }: Marker): string {
    return `${MARKER_PREFIX}${encodeURIComponent(key)}?w=${Math.round(width)}&h=${Math.round(height)}`;
}

/**
 * Reads a marker back. Tolerates parameters Discord's image helpers add and the order they
 * write them in (getSrcWithWidthAndHeight re-serialises the query: …&format=png&width=…).
 */
export function decodeMarker(url: string | null | undefined): Marker | null {
    if (!url || !url.startsWith(MARKER_PREFIX)) return null;
    const m = /^([^?#/]+)\?([^#]*)/.exec(url.slice(MARKER_PREFIX.length));
    if (!m) return null;
    const w = /(?:^|&)w=(\d+)(?:&|$)/.exec(m[2]);
    const h = /(?:^|&)h=(\d+)(?:&|$)/.exec(m[2]);
    if (!w || !h) return null;
    try {
        return { key: decodeURIComponent(m[1]), width: Number(w[1]), height: Number(h[1]) };
    } catch {
        return null;
    }
}

/**
 * The embed record that holds an island's place: an image embed (drawn as a bare image,
 * no card frame) sized like the island.
 *
 * The marker goes in `image`, not `thumbnail`: Discord's native embed view (352.6, ds.e.z /
 * toMediaSource) shows inline media for an Image embed from `image` only, and draws a
 * `thumbnail` in a separate small view (an empty card when only the thumbnail is set: seen on
 * the device). transformEmbeds passes `image` on while "Show embeds and link previews" media
 * inlining is on.
 */
export function placeholderEmbed(marker: Marker): IslandEmbed {
    const url = encodeMarker(marker);
    // Native parses this as com.discord.chat.bridge.embed.EmbedMedia: url, width, height and
    // srcIsAnimated are required (352.6, n7/s.java); a missing one breaks the whole row
    // ("Something went wrong here"). Discord's own records carry srcIsAnimated.
    const media = { url, proxyURL: url, width: Math.round(marker.width), height: Math.round(marker.height), srcIsAnimated: false };
    return {
        id: `chat-island:${marker.key}`,
        type: "image",
        url,
        thumbnail: undefined,
        image: media,
        rawTitle: undefined,
        rawDescription: undefined,
        fields: [],
    };
}
