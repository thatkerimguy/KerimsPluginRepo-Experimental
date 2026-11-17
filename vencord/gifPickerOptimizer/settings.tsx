/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { makeRange, OptionType } from "@utils/types";

import { CacheSettings, PatchesSettings } from "./CacheSettings";
import type { Quality } from "./lowres";
import { SettingsHeader } from "./SettingsHeader";
import { loaded, queue, settingsPanels } from "./state";

/** "800", "1.2K", "3K": four digit marker labels are too wide and wrap under the slider */
const shortNumber = (v: number) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}K` : String(v));
/** Slider labels: short markers, and whole numbers instead of "3.00" while dragging */
const sliderLabels = { onMarkerRender: shortNumber, onValueRender: (v: number) => String(Math.round(v)) };

/** A section heading in the settings list */
const header = (title: string, description?: string, first?: boolean) => ({
    type: OptionType.COMPONENT as const,
    component: () => <SettingsHeader title={title} description={description} first={first} />,
});

/** The options that only matter when GIFs load one by one */
const notSequential = () => !isSequential();

export const settings = definePluginSettings({
    previewsHeader: header("Previews", "Smaller versions of the GIFs in the picker. The GIF you send is always the full size one.", true),
    quality: {
        type: OptionType.SELECT,
        displayName: "Preview size",
        description: "S suits most screens. Auto picks S, or SD on high density screens.",
        options: [
            { label: "XS: smallest and fastest", value: "xs" },
            { label: "S: small (recommended)", value: "s", default: true },
            { label: "SD: medium", value: "sd" },
            { label: "Auto: S, or SD on high density screens", value: "auto" },
            { label: "Original: no previews, every GIF at full size", value: "original" },
        ],
    },
    klipyLookup: {
        type: OptionType.BOOLEAN,
        displayName: "Small Klipy previews",
        description: "Klipy is Discord's GIF source. Its small versions need one extra request per search page.",
        default: true,
    },
    stillFavorites: {
        type: OptionType.BOOLEAN,
        displayName: "Still favourites",
        description: "Show favourites as still images. Sent GIFs still animate.",
        default: false,
    },

    loadingHeader: header("Loading"),
    sequential: {
        type: OptionType.BOOLEAN,
        displayName: "Load one by one",
        description: "Load GIFs in reading order, a few at a time, instead of all at once.",
        default: true,
        onChange: () => applyQueueSettings(),
    },
    concurrency: {
        // A dropdown, not a slider: an "Auto" marker label is too wide and wraps
        type: OptionType.SELECT,
        displayName: "GIFs at the same time",
        description: "Auto uses 2 on slow connections and up to 6 on fast ones.",
        options: [
            { label: "Auto", value: 0, default: true },
            ...makeRange(1, 6, 1).map(n => ({ label: n === 1 ? "1 (strictly one by one)" : String(n), value: n })),
        ],
        hidden: notSequential,
        onChange: () => applyQueueSettings(),
    },
    prioritizeVisible: {
        type: OptionType.BOOLEAN,
        displayName: "On-screen GIFs first",
        description: "Load the GIFs you can see before ones you scrolled past.",
        default: true,
        hidden: notSequential,
        onChange: () => applyQueueSettings(),
    },
    loadTimeout: {
        type: OptionType.SLIDER,
        displayName: "Skip slow GIFs after (seconds)",
        description: "Then the next GIF starts. The slow one keeps loading in the background.",
        markers: [3, 5, 8, 10, 15, 20, 30],
        default: 10,
        stickToMarkers: true,
        componentProps: sliderLabels,
        hidden: notSequential,
    },
    showProgress: {
        type: OptionType.BOOLEAN,
        displayName: "Loading indicators",
        description: "A dot, spinner or progress line on GIFs that haven't loaded yet.",
        default: true,
    },

    pickerHeader: header("GIF picker"),
    favoritesOnly: {
        type: OptionType.BOOLEAN,
        displayName: "Favourites only",
        description: "Hide Trending and the featured categories on the picker's main page. Search and Favorites stay.",
        default: false,
    },

    // Panels that use the settings themselves (index.tsx fills settingsPanels in, to avoid an import cycle)
    favorites: {
        type: OptionType.COMPONENT,
        component: () => <>{settingsPanels.favorites?.()}</>,
    },

    advancedHeader: header("Status and cache"),
    patches: {
        type: OptionType.COMPONENT,
        component: () => <PatchesSettings />,
    },
    cacheSize: {
        type: OptionType.SLIDER,
        displayName: "Remembered GIFs",
        description: "Loaded GIFs that show at once when you scroll back to them.",
        markers: [300, 1000, 3000],
        default: 1000,
        stickToMarkers: true,
        componentProps: sliderLabels,
        onChange: (size: number) => loaded.resize(size),
    },
    cache: {
        type: OptionType.COMPONENT,
        component: () => <CacheSettings />,
    },
});

/** Whether GIFs load one by one (a function, so the settings above can refer to it before `settings` exists) */
function isSequential(): boolean {
    return settings.store.sequential;
}

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
