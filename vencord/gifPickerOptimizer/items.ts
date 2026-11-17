/*
 * GIFs+ — the GIF items Discord's picker shows, and how to tell favourites apart.
 * Shared between the Vencord and Valenced builds (keep both copies in sync).
 *
 * The plugin never changes these objects (see "never touch the data" in CLAUDE.md).
 */

import type { GifRef } from "./lowResPages";

export interface GifItem extends GifRef {
    src: string;
    /** The GIF version of a video result (picker items) */
    gifSrc?: string;
    /** Same, as Discord's GIF API names it */
    gif_src?: string;
    format?: number;
    width?: number;
    height?: number;
    /** Only favourites have this (their position in the favourites list) */
    order?: number;
}

/** Favourites come from the frecency settings: they have an `order` and no `id` */
export function isFavoriteItem(item: GifItem) {
    return typeof item.order === "number" && item.id == null;
}

/** Whether a tile is in the favourites tab: the list says so, or the item has a favourite's shape */
export function isFavoritesTile(resultType: unknown, item: GifItem) {
    if (typeof resultType === "string" && /favou?rite/i.test(resultType)) return true;
    return isFavoriteItem(item);
}
