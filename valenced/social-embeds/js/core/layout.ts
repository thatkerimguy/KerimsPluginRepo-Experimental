/*
 * How a post's media is arranged, the way each app does it: X shows up to four
 * in a grid; Reddit, Instagram and TikTok photo posts swipe; five or more always
 * swipe. Cells are fractions of the box, so both UIs and the height estimate
 * share one answer.
 */

import { aspectOf } from "./media";
import type { Media, Platform } from "./model";

export interface Cell {
    /** Index into post.media. */
    index: number;
    /** Position and size as fractions (0–1) of the media box. */
    x: number;
    y: number;
    w: number;
    h: number;
}

export type MediaLayout =
    | { kind: "none"; }
    | { kind: "single"; aspect: number; }
    | { kind: "grid"; aspect: number; cells: Cell[]; }
    | { kind: "carousel"; aspect: number; count: number; };

/** Width / height limits, like the apps: no taller than 4:5, no wider than 1.91:1. */
export const MIN_ASPECT = 0.8;
export const MAX_ASPECT = 1.91;
const GRID_ASPECT = 16 / 9;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function mediaLayout(media: readonly Media[], platform: Platform, minAspect = MIN_ASPECT): MediaLayout {
    const n = media.length;
    if (!n) return { kind: "none" };
    if (n === 1) return { kind: "single", aspect: clamp(aspectOf(media[0]), minAspect, MAX_ASPECT) };
    if (platform !== "x" || n > 4) {
        // The carousel takes the first item's shape (as Instagram does); the rest are fitted inside it
        return { kind: "carousel", aspect: clamp(aspectOf(media[0]), minAspect, MAX_ASPECT), count: n };
    }
    const half = 0.5;
    const cells: Cell[] =
        n === 2 ? [
            { index: 0, x: 0, y: 0, w: half, h: 1 },
            { index: 1, x: half, y: 0, w: half, h: 1 },
        ] : n === 3 ? [
            { index: 0, x: 0, y: 0, w: half, h: 1 },
            { index: 1, x: half, y: 0, w: half, h: half },
            { index: 2, x: half, y: half, w: half, h: half },
        ] : [
            { index: 0, x: 0, y: 0, w: half, h: half },
            { index: 1, x: half, y: 0, w: half, h: half },
            { index: 2, x: 0, y: half, w: half, h: half },
            { index: 3, x: half, y: half, w: half, h: half },
        ];
    return { kind: "grid", aspect: GRID_ASPECT, cells };
}

/** Height of the media box at `width` (0 for no media). */
export function mediaHeight(layout: MediaLayout, width: number): number {
    return layout.kind === "none" ? 0 : Math.round(width / layout.aspect);
}
