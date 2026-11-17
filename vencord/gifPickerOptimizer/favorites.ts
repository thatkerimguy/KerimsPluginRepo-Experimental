/*
 * Discord's GIF favourites (frecency user settings), for export / import.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { UserSettingsActionCreators } from "@webpack/common";

import { createFavoritesBackend, type FavoriteMap } from "./favoritesBackend";
import type { GifItem } from "./types";

export const favoritesBackend = createFavoritesBackend(() => UserSettingsActionCreators.FrecencyUserSettingsActionCreators);

let lastItems: { map: FavoriteMap | undefined; count: number; items: GifItem[]; } | null = null;

/**
 * Favourites as picker items (like Discord's favourites list), newest first. The
 * same array is returned until favourites change, so lists derived from it can be memoized.
 */
export function favoriteItems(map: FavoriteMap | undefined = favoritesBackend.read()): GifItem[] {
    // Discord replaces the object when favourites change; the count also catches an in-place change
    const count = map ? Object.keys(map).length : 0;
    if (lastItems && lastItems.map === map && lastItems.count === count) return lastItems.items;
    const items = Object.entries(map ?? {})
        .filter(([, entry]) => entry?.src)
        .map(([url, entry]) => ({ ...entry, url }))
        .sort((a, b) => (b.order ?? 0) - (a.order ?? 0));
    lastItems = { map, count, items };
    return items;
}
