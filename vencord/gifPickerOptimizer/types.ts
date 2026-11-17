/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ComponentType, MouseEvent, ReactNode } from "react";

import type { GifRef } from "./cache";

export interface GifItem extends GifRef {
    src: string;
    /** The GIF version of a video result (picker items) */
    gifSrc?: string;
    /** Same, as Discord's GIF API names it */
    gif_src?: string;
    width?: number;
    height?: number;
    /** Only favourites have this (their position in the favourites list) */
    order?: number;
}

export interface TileCoords {
    top?: number;
    left?: number;
    width: number;
    height: number;
    [k: string]: any;
}

/** Props of Discord's GIF tile, plus what the patch adds (`Result`, `resultType`) */
export interface ResultProps {
    /** Discord's own tile component */
    Result: ComponentType<any>;
    /** The results list's type, e.g. favourites or search */
    resultType?: unknown;
    item: GifItem;
    index: number;
    src: string;
    format?: number;
    coords: TileCoords;
    onClick?(item: GifItem, index: number, opts: { shiftKey: boolean; }): void;
    onContextMenu?(e: MouseEvent, item: GifItem): void;
    renderExtras?(item: GifItem): ReactNode;
    [k: string]: any;
}

/** GIFType.VIDEO in Discord's frecency protobuf */
export const GIF_TYPE_VIDEO = 2;
