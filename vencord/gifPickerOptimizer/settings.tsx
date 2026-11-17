/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { makeRange, OptionType } from "@utils/types";
import { Alerts } from "@webpack/common";

import { CacheSettings, PatchesSettings } from "./CacheSettings";
import type { Quality } from "./lowres";
import { SettingsHeader } from "./SettingsHeader";
import { QUALITY_CHOICES, RESTORE_DEFAULTS_CONFIRM, SECTIONS, type SectionText, TEXT } from "./settingsText";
import { cl, loadedThisSession, queue, settingsPanels } from "./state";

/** "800", "1.2K", "3K": four digit marker labels are too wide and wrap under the slider */
const shortNumber = (v: number) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}K` : String(v));
/** Slider labels: short markers, and whole numbers instead of "3.00" while dragging */
const sliderLabels = { onMarkerRender: shortNumber, onValueRender: (v: number) => String(Math.round(v)) };

/** A section heading in the settings list */
const header = ({ title, description }: SectionText, first?: boolean) => ({
    type: OptionType.COMPONENT as const,
    component: () => <SettingsHeader title={title} description={description} first={first} />,
});

/** The options that only matter when GIFs load one by one */
const notSequential = () => !isSequential();

export const settings = definePluginSettings({
    previewsHeader: header(SECTIONS.previews, true),
    quality: {
        type: OptionType.SELECT,
        displayName: TEXT.quality.title,
        // Read on each render, so it says what Auto picks on this screen
        get description() {
            return isAutoQuality() ? `${TEXT.quality.description} Auto is using ${quality().toUpperCase()} on this screen.` : TEXT.quality.description;
        },
        options: QUALITY_CHOICES.map(c => ({ label: `${c.label}: ${c.short}`, value: c.value, default: c.value === "s" })),
    },
    klipyLookup: {
        type: OptionType.BOOLEAN,
        displayName: TEXT.klipyLookup.title,
        description: TEXT.klipyLookup.description,
        default: true,
    },
    stillFavorites: {
        type: OptionType.BOOLEAN,
        displayName: TEXT.stillFavorites.title,
        description: TEXT.stillFavorites.description,
        default: false,
    },

    loadingHeader: header(SECTIONS.loading),
    sequential: {
        type: OptionType.BOOLEAN,
        displayName: TEXT.sequential.title,
        description: TEXT.sequential.description,
        default: true,
        onChange: () => applyQueueSettings(),
    },
    concurrency: {
        // A dropdown, not a slider: an "Auto" marker label is too wide and wraps
        type: OptionType.SELECT,
        displayName: TEXT.concurrency.title,
        // Read on each render, so it says what Auto picks on this connection
        get description() {
            return isAutoConcurrency()
                ? `${TEXT.concurrency.description} Auto is using ${autoConcurrency()} on this connection (2 on slow ones, up to 6 on fast ones).`
                : TEXT.concurrency.description;
        },
        options: [
            { label: "Auto: from your connection's speed", value: 0, default: true },
            ...makeRange(1, 6, 1).map(n => ({ label: n === 1 ? "1: strictly one by one" : String(n), value: n })),
        ],
        hidden: notSequential,
        onChange: () => applyQueueSettings(),
    },
    prioritizeVisible: {
        type: OptionType.BOOLEAN,
        displayName: TEXT.prioritizeVisible.title,
        description: TEXT.prioritizeVisible.description,
        default: true,
        hidden: notSequential,
        onChange: () => applyQueueSettings(),
    },
    loadTimeout: {
        type: OptionType.SLIDER,
        displayName: `${TEXT.loadTimeout.title} (seconds)`,
        description: TEXT.loadTimeout.description,
        markers: [3, 5, 8, 10, 15, 20, 30],
        default: 10,
        stickToMarkers: true,
        componentProps: sliderLabels,
        hidden: notSequential,
    },
    showProgress: {
        type: OptionType.BOOLEAN,
        displayName: TEXT.showProgress.title,
        description: TEXT.showProgress.description,
        default: true,
    },

    pickerHeader: header(SECTIONS.picker),
    favoritesOnly: {
        type: OptionType.BOOLEAN,
        displayName: TEXT.favoritesOnly.title,
        description: TEXT.favoritesOnly.description,
        default: false,
    },

    // Panels that use the settings themselves (index.tsx fills settingsPanels in, to avoid an import cycle)
    favorites: {
        type: OptionType.COMPONENT,
        component: () => <>{settingsPanels.favorites?.()}</>,
    },

    statusHeader: header(SECTIONS.status),
    patches: {
        type: OptionType.COMPONENT,
        component: () => <PatchesSettings />,
    },
    cacheSize: {
        type: OptionType.SLIDER,
        displayName: TEXT.cacheSize.title,
        description: TEXT.cacheSize.description,
        markers: [300, 1000, 3000],
        default: 1000,
        stickToMarkers: true,
        componentProps: sliderLabels,
        onChange: (size: number) => loadedThisSession.resize(size),
    },
    cache: {
        type: OptionType.COMPONENT,
        component: () => <CacheSettings />,
    },
    restoreDefaults: {
        type: OptionType.COMPONENT,
        component: () => <RestoreDefaults />,
    },
});

/**
 * Puts every setting back to its default (the `default` of each option, or the
 * dropdown option marked default). Their onChange listeners apply the change.
 */
export function restoreDefaultSettings() {
    const store = settings.store as Record<string, unknown>;
    for (const [key, def] of Object.entries(settings.def) as [string, { type: OptionType; default?: unknown; options?: { value: unknown; default?: boolean; }[]; }][]) {
        if (def.type === OptionType.COMPONENT) continue;
        const value = "default" in def ? def.default : def.options?.find(o => o.default)?.value;
        if (value !== undefined) store[key] = value;
    }
}

/** The button at the end of the settings */
function RestoreDefaults() {
    return (
        <section className={cl("settings-section")}>
            <div className={cl("actions")}>
                <Button
                    variant="secondary"
                    size="small"
                    onClick={() => Alerts.show({
                        ...RESTORE_DEFAULTS_CONFIRM,
                        cancelText: "Cancel",
                        onConfirm: restoreDefaultSettings,
                    })}
                >
                    {TEXT.restoreDefaults.title}
                </Button>
                <Paragraph className={cl("muted")}>{TEXT.restoreDefaults.description}</Paragraph>
            </div>
        </section>
    );
}

function isAutoQuality(): boolean {
    return settings.store.quality === "auto";
}

function isAutoConcurrency(): boolean {
    return !((settings.store.concurrency ?? 0) >= 1);
}

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
