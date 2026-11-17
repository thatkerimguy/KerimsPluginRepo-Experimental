/*
 * Discord's GIF favourites (frecency user settings), for export / import, plus
 * downloading GIFs for precaching.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { UserSettingsActionCreators } from "@webpack/common";

import { isVideoUrl } from "./lowres";
import type { PrecacheOptions } from "./precache";
import { PRECACHE_STORE_KEY } from "./state";
import { type FavoriteMap, type FavoritesBackend, protoBytes } from "./transfer";
import type { GifItem } from "./types";

/** UserSettingsDelay.INFREQUENT_USER_ACTION: save right away, like the star button */
const SAVE_DELAY = 0;
const DOWNLOAD_TIMEOUT_MS = 20_000;

const frecency = () => UserSettingsActionCreators.FrecencyUserSettingsActionCreators;

export const favoritesBackend: FavoritesBackend = {
    read: () => frecency()?.getCurrentValue?.()?.favoriteGifs?.gifs,
    async update(fn) {
        const actions = frecency();
        if (typeof actions?.updateAsync !== "function") return false;
        let applied = false;
        // updateAsync awaits loading, then calls the updater with a copy of the current
        // favourites, and resolves after it ran (checked in Discord's code, 2026-11)
        await actions.updateAsync("favoriteGifs", (favorites: { gifs?: FavoriteMap; }) => {
            favorites.gifs ??= {};
            // Returning false cancels the update
            if (fn(favorites.gifs) === false) return false;
            applied = true;
        }, SAVE_DELAY);
        return applied;
    },
    // FavoriteGIFs.toBinary(...).length, the check Discord's add favourite does
    bytes: gifs => protoBytes(frecency()?.ProtoClass, gifs),
};

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

/**
 * Starts downloading `url` the way the picker loads it, and calls `done` once
 * it loaded or failed. Returns a function that detaches the element.
 */
function startDownload(url: string, done: (ok: boolean) => void): () => void {
    if (isVideoUrl(url)) {
        const video = document.createElement("video");
        video.muted = true;
        video.preload = "auto";
        video.oncanplaythrough = () => done(true);
        video.onerror = () => done(false);
        video.src = url;
        return () => {
            video.oncanplaythrough = video.onerror = null;
            video.removeAttribute("src");
            video.load();
        };
    }
    const img = new Image();
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = url;
    return () => void (img.onload = img.onerror = null);
}

/** Downloads `url` into the browser cache. Resolves whether it worked. */
function download(url: string): Promise<boolean> {
    return new Promise(resolve => {
        let finished = false;
        const finish = (ok: boolean) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            detach();
            resolve(ok);
        };
        // Load events always come later, so `timer` and `detach` are set by then
        const detach = startDownload(url, finish);
        const timer = setTimeout(() => finish(false), DOWNLOAD_TIMEOUT_MS);
    });
}

export const precacheOptions: PrecacheOptions = {
    fetch: download,
    load: () => DataStore.get<string[]>(PRECACHE_STORE_KEY),
    save: urls => void DataStore.set(PRECACHE_STORE_KEY, urls),
};
