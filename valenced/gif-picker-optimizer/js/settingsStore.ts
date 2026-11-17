import type { JsonStorage } from "@valenced/json-storage";

import type { Quality } from "./lowres";

export interface Settings {
    quality: Quality;
    sequential: boolean;
    concurrency: number;
    loadTimeout: number;
    showProgress: boolean;
    klipyLookup: boolean;
    /** How many loaded GIF URLs to remember, so they show instantly when scrolled back to */
    cacheSize: number;
    /** Show still (not animated) previews in the favourites tab */
    stillFavorites: boolean;
    /** Switch to the GIF tab first and build the picker a moment later */
    fastTabSwitch: boolean;
    /** When not searching, show favourites instead of Trending and the other featured categories */
    favoritesOnly: boolean;
}

// `unloadOffscreen` and `offscreenBuffer` (before 1.6.0) may still be in saved settings. They're ignored.
export const DefaultSettings: Settings = {
    // Discord mobile already asks for tinywebp, so S needs no extra request for Klipy
    // GIFs. XS would add a nanowebp request per search and show about 90 px previews
    // on tiles about 540 device px wide.
    quality: "s",
    sequential: true,
    concurrency: 3,
    loadTimeout: 10,
    showProgress: true,
    klipyLookup: true,
    cacheSize: 1000,
    stillFavorites: false,
    fastTabSwitch: true,
    favoritesOnly: false,
};

/** One line of cache stats in settings */
export interface CacheStat {
    label: string;
    value: string;
}

/** Set by the plugin while it runs, so settings can show stats and reset the caches */
export const cacheControl: {
    stats?: () => CacheStat[];
    reset?: () => void;
} = {};

let storage: JsonStorage<Settings> | undefined;
/**
 * The storage components subscribe to. Kept after the plugin stops, so a
 * component that re-renders then still calls the same hook (React requires the
 * same hooks on every render). It's only unset before the first start, when no
 * patched component can be mounted yet.
 */
let hookStorage: JsonStorage<Settings> | undefined;

export function setStorage(s: JsonStorage<Settings> | undefined) {
    storage = s;
    if (s) hookStorage = s;
}

/** Current settings, outside of React */
export function getSettings(): Settings {
    return { ...DefaultSettings, ...(storage?.cache as Partial<Settings> | undefined) };
}

/** Current settings in a component, re-rendering when they change */
export function useSettings(): Settings {
    return { ...DefaultSettings, ...hookStorage?.use() };
}
