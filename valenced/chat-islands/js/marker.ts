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

/** Reads a marker back. Tolerates parameters Discord's image helpers append (…&format=webp). */
export function decodeMarker(url: string | null | undefined): Marker | null {
    if (!url || !url.startsWith(MARKER_PREFIX)) return null;
    const m = /^([^?#/]+)\?(?:.*&)?w=(\d+)&h=(\d+)/.exec(url.slice(MARKER_PREFIX.length));
    if (!m) return null;
    try {
        return { key: decodeURIComponent(m[1]), width: Number(m[2]), height: Number(m[3]) };
    } catch {
        return null;
    }
}

/**
 * The embed record that holds an island's place: an image embed (drawn as a bare image,
 * no card frame) sized like the island.
 */
export function placeholderEmbed(marker: Marker): IslandEmbed {
    const url = encodeMarker(marker);
    const media = { url, proxyURL: url, width: Math.round(marker.width), height: Math.round(marker.height) };
    return {
        id: `chat-island:${marker.key}`,
        type: "image",
        url,
        thumbnail: media,
        image: undefined,
        rawTitle: undefined,
        rawDescription: undefined,
        fields: [],
    };
}
