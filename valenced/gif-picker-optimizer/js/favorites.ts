/*
 * Discord's GIF favourites (frecency user settings), for export / import, plus
 * downloading GIFs for precaching.
 */

import { getJsonStorage, pluginStoragePathFor } from "@valenced/json-storage";
import { Image } from "react-native";

import { normalizeUrl } from "./lowres";
import type { PrecacheOptions } from "./precache";
import type { GifItem } from "./state";
import { PLUGIN_ID, runtime } from "./state";
import type { FavoriteMap, FavoritesBackend } from "./transfer";
import { protoBytes } from "./transfer";

/** UserSettingsDelay.INFREQUENT_USER_ACTION: save right away, like the favourite button */
const SAVE_DELAY = 0;
const DOWNLOAD_TIMEOUT_MS = 20_000;

export const favoritesBackend: FavoritesBackend = {
    read: () => runtime.frecency?.getCurrentValue()?.favoriteGifs?.gifs as FavoriteMap | undefined,
    async update(fn) {
        const { frecency } = runtime;
        if (!frecency) {
            runtime.logger?.warn?.("Discord's favourites aren't loaded yet, nothing was changed");
            return false;
        }
        let applied = false;
        // updateAsync calls the updater with a copy of the current favourites and
        // resolves after it ran (Discord's desktop code; assumed the same on mobile)
        await frecency.updateAsync("favoriteGifs", (favorites: { gifs?: FavoriteMap; }) => {
            favorites.gifs ??= {};
            // Returning false cancels the update
            if (fn(favorites.gifs) === false) return false;
            applied = true;
        }, SAVE_DELAY);
        return applied;
    },
    // FavoriteGIFs.toBinary(...).length, the check Discord's add favourite does
    bytes: gifs => protoBytes(runtime.frecency?.ProtoClass, gifs),
};

function jsonFile<T extends object>(file: string, fallback: T) {
    return getJsonStorage<T>(pluginStoragePathFor(PLUGIN_ID, file), { default: fallback });
}

const GIPHY_PAGE = /(https?:\/\/)(?!media(?:\d+)?\.)(?:[^.]+\.)*giphy\.com/;
const GIPHY_ID = /-(?:.(?!-))+$/;

/**
 * The URL Discord mobile shows for a favourite (`transformFavoriteGifUrl` in
 * GIFPickerUtils): Giphy and Tenor pages become their GIF, proxied files get
 * `animated=true`. Precaching uses it so it downloads what the favourites tab shows.
 */
function shownSrc(src: string, url: string) {
    const plain = normalizeUrl(src);
    if (/^https:\/\/images-ext-\d+\.discordapp\.net\/external\//.test(plain)) {
        if (/[?&]animated=true(&|$)/.test(plain)) return plain;
        return `${plain}${plain.includes("?") ? "&" : "?"}animated=true`;
    }
    if (GIPHY_PAGE.test(url)) {
        const id = GIPHY_ID.exec(url)?.[0]?.slice(1);
        if (id) return `https://media.giphy.com/media/${id}/giphy.gif`;
    }
    if (/tenor\.com/.test(url)) return `${url}.gif`;
    return plain;
}

let lastItems: { map: FavoriteMap | undefined; count: number; items: GifItem[]; } | null = null;

/**
 * Favourites as picker items (like the favourites tab), newest first. The same
 * array is returned until favourites change, so lists derived from it can be memoized.
 */
export function favoriteItems(map: FavoriteMap | undefined = favoritesBackend.read()): GifItem[] {
    // Discord replaces the object when favourites change; the count also catches an in-place change
    const count = map ? Object.keys(map).length : 0;
    if (lastItems && lastItems.map === map && lastItems.count === count) return lastItems.items;
    const items = Object.entries(map ?? {})
        .filter(([, entry]) => entry?.src)
        .map(([url, entry]) => ({ ...entry, url, src: shownSrc(entry.src, url) }) as GifItem)
        .sort((a, b) => (b.order ?? 0) - (a.order ?? 0));
    lastItems = { map, count, items };
    return items;
}

/** Downloads `url` into the native image cache. Resolves whether it worked. */
function download(url: string): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>(resolve => {
        timer = setTimeout(() => resolve(false), DOWNLOAD_TIMEOUT_MS);
    });
    const fetched = Image.prefetch(url).then(ok => ok !== false, () => false);
    return Promise.race([fetched, timeout]).finally(() => clearTimeout(timer));
}

const precacheFile = jsonFile<{ urls: string[]; }>("precache.json", { urls: [] });
export const precacheOptions: PrecacheOptions = {
    fetch: download,
    load: async () => (await precacheFile.get())?.urls,
    save: urls => void precacheFile.set({ urls }, true),
};
