/*
 * GIFs+ — the words in the settings, so the desktop and mobile settings read the same.
 * Shared between the Vencord and Valenced builds (keep both copies in sync).
 */

import { formatBytes } from "./cache";
import type { Quality } from "./lowres";

export interface SectionText {
    title: string;
    description?: string;
}

export const SECTIONS = {
    previews: { title: "Previews", description: "Smaller versions of the GIFs in the picker. The GIF you send is always the full size one." },
    loading: { title: "Loading", description: "How GIFs take turns to load." },
    picker: { title: "GIF picker" },
    favorites: { title: "Favourites", description: "Move your favourites to another account: export them on one, import them on the other." },
    status: { title: "Status and cache", description: "Whether the plugin works with this version of Discord, and what it remembers." },
} satisfies Record<string, SectionText>;

export interface SettingText {
    title: string;
    description: string;
}

export const TEXT = {
    quality: { title: "Preview size", description: "S suits most screens." },
    klipyLookup: { title: "Small Klipy previews", description: "Klipy is Discord's GIF source. Its small versions need one extra request per search page." },
    stillFavorites: { title: "Still favourites", description: "Show favourites as still images. Sent GIFs still animate." },
    sequential: { title: "Load one by one", description: "Load GIFs in reading order, a few at a time, instead of all at once." },
    concurrency: { title: "GIFs at the same time", description: "More is faster on a good connection." },
    prioritizeVisible: { title: "On-screen GIFs first", description: "Load the GIFs you can see before ones you scrolled past." },
    loadTimeout: { title: "Skip slow GIFs after", description: "Then the next GIF starts. The slow one keeps loading in the background." },
    showProgress: { title: "Loading indicators", description: "A dot, spinner or progress line on GIFs that haven't loaded yet." },
    favoritesOnly: { title: "Favourites only", description: "Hide Trending and the featured categories on the picker's main page. Search and Favorites stay." },
    fastTabSwitch: { title: "Faster GIF tab switch", description: "Open the GIF tab at once and build the picker right after, instead of freezing." },
    cacheSize: { title: "Remembered GIFs", description: "Loaded GIFs that show at once when you scroll back to them." },
    restoreDefaults: { title: "Restore default settings", description: "Puts every setting above back to how it was when you installed the plugin. Your favourites and the cache aren't touched." },
    resetCache: { title: "Reset cache", description: "Forgets loaded GIFs, previews and lookups. Discord's own image cache isn't touched." },
} satisfies Record<string, SettingText>;

export interface QualityChoice {
    value: Quality | "auto";
    label: string;
    /** A few words, for a dropdown */
    short: string;
    /** A sentence, for a list row */
    detail: string;
}

/** Preview sizes. "auto" is desktop only (it needs the screen's pixel density). */
export const QUALITY_CHOICES: QualityChoice[] = [
    { value: "xs", label: "XS", short: "about 100 px, fastest", detail: "About 100 px wide. Smallest and fastest, but blurry on large or sharp screens." },
    { value: "s", label: "S", short: "about 200 px, recommended", detail: "About 200 px wide. Sharp enough for most screens. Recommended." },
    { value: "sd", label: "SD", short: "about 400 px", detail: "About 400 px wide. For sharp, high density screens." },
    { value: "auto", label: "Auto", short: "S, or SD on high density screens", detail: "S, or SD on high density screens." },
    { value: "original", label: "Original", short: "no previews", detail: "No previews: every GIF loads at full size." },
];

export const RESTORE_DEFAULTS_CONFIRM = {
    title: "Restore default settings?",
    body: "Every GIFs+ setting goes back to its default. Your favourites and the cache aren't touched.",
    confirmText: "Restore",
};

/** What each build knows about its caches, for the stats in settings */
export interface CacheNumbers {
    loaded: number;
    loadedMax: number;
    seen: number;
    seenMax: number;
    klipySaved: number;
    klipyRecent: number;
    /** Mobile only */
    tenorSaved?: number;
    searchPreviews: number;
    failed: number;
    /** Desktop only (still favourites captured locally) */
    frames?: { count: number; bytes: number; budget: number; };
    memoryBytes: number;
}

export interface StatRow {
    label: string;
    value: string;
}

/** The cache details, one row each */
export function cacheStatRows(n: CacheNumbers): StatRow[] {
    const rows: StatRow[] = [
        { label: "Loaded this session", value: `${n.loaded} of ${n.loadedMax}` },
        { label: "Remembered across restarts (two weeks)", value: `${n.seen} of ${n.seenMax}` },
        { label: "Klipy favourites looked up", value: `${n.klipySaved}, plus ${n.klipyRecent} from recent searches` },
    ];
    if (n.tenorSaved != null) rows.push({ label: "Tenor favourites looked up", value: String(n.tenorSaved) });
    rows.push(
        { label: "Small search previews", value: String(n.searchPreviews) },
        { label: "Previews that failed (kept a week)", value: String(n.failed) },
    );
    if (n.frames) rows.push({ label: "Still frames", value: `${n.frames.count} (${formatBytes(n.frames.bytes)} of ${formatBytes(n.frames.budget)})` });
    rows.push({ label: "Memory used", value: `About ${formatBytes(n.memoryBytes)}` });
    return rows;
}

/** "About 1.2 MB in memory · 340 GIFs loaded this session" */
export function cacheSummary(n: CacheNumbers) {
    return `About ${formatBytes(n.memoryBytes)} in memory · ${n.loaded} GIF${n.loaded === 1 ? "" : "s"} loaded this session`;
}
