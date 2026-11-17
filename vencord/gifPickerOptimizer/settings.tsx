/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { makeRange, OptionType } from "@utils/types";

import { CacheSettings } from "./CacheSettings";
import type { Quality } from "./lowres";
import { loaded, queue, settingsPanels } from "./state";

/** "800", "1.2K", "3K": four digit marker labels are too wide and wrap under the slider */
const shortNumber = (v: number) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}K` : String(v));
/** Slider labels: short markers, and whole numbers instead of "3.00" while dragging */
const sliderLabels = { onMarkerRender: shortNumber, onValueRender: (v: number) => String(Math.round(v)) };

export const settings = definePluginSettings({
    quality: {
        type: OptionType.SELECT,
        description: "Resolution of the previews shown in the GIF picker. The GIF you send is always full resolution.",
        options: [
            { label: "XS (smallest, fastest)", value: "xs" },
            { label: "S", value: "s", default: true },
            { label: "SD", value: "sd" },
            { label: "Original (don't downscale)", value: "original" },
            { label: "Auto (S, or SD on high density screens)", value: "auto" },
        ],
    },
    sequential: {
        type: OptionType.BOOLEAN,
        description: "Load GIFs one after another (left to right, top to bottom) instead of all at once",
        default: true,
        onChange: () => applyQueueSettings(),
    },
    concurrency: {
        // A dropdown, not a slider: an "Auto" marker label is too wide and wraps
        type: OptionType.SELECT,
        description: "How many GIFs may load at the same time when sequential loading is on",
        options: [
            { label: "Auto (2 on slow connections, up to 6 on fast ones)", value: 0, default: true },
            ...makeRange(1, 6, 1).map(n => ({ label: n === 1 ? "1 (strictly one at a time)" : String(n), value: n })),
        ],
        onChange: () => applyQueueSettings(),
    },
    prioritizeVisible: {
        type: OptionType.BOOLEAN,
        description: "Load GIFs that are on screen before ones you scrolled past",
        default: true,
        onChange: () => applyQueueSettings(),
    },
    loadTimeout: {
        type: OptionType.SLIDER,
        description: "Seconds to wait for a slow GIF before moving on to the next one (it keeps loading in the background)",
        markers: [3, 5, 8, 10, 15, 20, 30],
        default: 10,
        stickToMarkers: true,
        componentProps: sliderLabels,
    },
    showProgress: {
        type: OptionType.BOOLEAN,
        description: "Show a loading / progress indicator on GIFs that haven't loaded yet",
        default: true,
    },
    klipyLookup: {
        type: OptionType.BOOLEAN,
        description: "Ask Discord's GIF API for the small Klipy renditions (one extra request per search page). Needed for XS/S on Klipy results.",
        default: true,
    },
    cacheSize: {
        type: OptionType.SLIDER,
        description: "How many loaded GIFs to remember, so they show instantly when you scroll back to them",
        markers: [300, 1000, 3000],
        default: 1000,
        stickToMarkers: true,
        componentProps: sliderLabels,
        onChange: (size: number) => loaded.resize(size),
    },
    stillFavorites: {
        type: OptionType.BOOLEAN,
        description: "Show still images instead of playing GIFs in the favourites tab. Sent GIFs still animate.",
        default: false,
    },
    favoritesOnly: {
        type: OptionType.BOOLEAN,
        description: "Hide Trending GIFs and the other featured categories. The picker's main page keeps search and Favorites.",
        default: false,
    },
    // The panels go last, so they don't sit between the toggles
    favorites: {
        type: OptionType.COMPONENT,
        component: () => <>{settingsPanels.favorites?.()}</>,
    },
    cache: {
        type: OptionType.COMPONENT,
        component: () => <CacheSettings />,
    },
});

/** The preview quality to use. "Auto" is S, or SD on screens with 2 or more device pixels per CSS pixel. */
export function quality(): Quality {
    const q = settings.store.quality as Quality | "auto";
    if (q !== "auto") return q;
    // Result tiles are about 200 CSS px wide (desiredItemWidth: 200): S covers that at 1x, SD at 2x
    return (window.devicePixelRatio || 1) >= 2 ? "sd" : "s";
}

/** Chromium's Network Information API (Electron has it too) */
interface NetworkInformation extends Partial<EventTarget> {
    effectiveType?: string;
    /** Mbit/s, rounded and capped at 10 by Chromium */
    downlink?: number;
    saveData?: boolean;
}

const connection = () => (navigator as Navigator & { connection?: NetworkInformation; }).connection;

/** Calls `cb` when the connection's speed estimate changes. Returns the unsubscribe. */
export function onConnectionChange(cb: () => void) {
    const c = connection();
    c?.addEventListener?.("change", cb);
    return () => c?.removeEventListener?.("change", cb);
}

/** How many GIFs load at once with "Auto": from the connection's speed estimate */
export function autoConcurrency(): number {
    const c = connection();
    if (!c) return 3;
    if (c.saveData) return 2;
    const type = c.effectiveType;
    if (type === "slow-2g" || type === "2g" || type === "3g") return 2;
    const down = typeof c.downlink === "number" ? c.downlink : 0;
    if (type === "4g" && down >= 5) return 6;
    if (type === "4g" && down >= 2) return 4;
    return 3;
}

/**
 * Sets the load queue from the settings. Called on start, when a queue setting
 * changes and when the connection changes (Auto concurrency), not by every tile.
 */
export function applyQueueSettings() {
    const { sequential, concurrency, prioritizeVisible } = settings.store;
    queue.concurrency = sequential ? loadConcurrency(concurrency) : 64;
    queue.prioritizeVisible = prioritizeVisible;
    queue.kick();
}

/** How many GIFs may load at the same time: the setting, or `autoConcurrency()` when it's Auto (0) */
export function loadConcurrency(setting: number | undefined = settings.store.concurrency): number {
    const n = Math.round(setting ?? 0);
    return n >= 1 ? n : autoConcurrency();
}
