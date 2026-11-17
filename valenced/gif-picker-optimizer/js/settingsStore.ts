import type { JsonStorage } from "@valenced/json-storage";
import { useEffect, useState } from "react";

import type { Quality } from "./lowres";
import type { CacheNumbers } from "./settingsText";

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
    /** Render tiles about three rows past the screen edge instead of Discord's one (viewport.tsx) */
    viewportBuffer: boolean;
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
    viewportBuffer: true,
};

/** Set by the plugin while it runs, so settings can show its cache and reset it */
export const cacheControl: {
    stats?: () => CacheNumbers;
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

/**
 * Whether the saved settings were read. Valenced reads the file in the background
 * after start, and until then the settings are the defaults: right after Discord
 * starts, Favourites only (say) would read as off.
 */
export function settingsLoaded() {
    return !!storage?.loaded;
}

/** Reads the saved settings (once), then calls `then`. Errors count as read: the defaults stay. */
export function whenSettingsLoaded(then: () => void) {
    const s = storage;
    if (!s || s.loaded) return then();
    Promise.resolve(s.get()).then(then, then);
}

/** `settingsLoaded()` in a component: re-renders once the saved settings were read */
export function useSettingsLoaded(): boolean {
    const [loaded, setLoaded] = useState(settingsLoaded);
    useEffect(() => {
        if (loaded) return;
        let live = true;
        whenSettingsLoaded(() => {
            if (live) setLoaded(true);
        });
        return () => {
            live = false;
        };
    }, [loaded]);
    return loaded;
}

/** Current settings in a component, re-rendering when they change */
export function useSettings(): Settings {
    return { ...DefaultSettings, ...hookStorage?.use() };
}
