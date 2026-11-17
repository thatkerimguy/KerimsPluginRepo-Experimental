/*
 * Cache stats and reset, shown in settings through `cacheControl`.
 */

import { formatBytes } from "./cache";
import type { CacheStat } from "./settingsStore";
import { apiPreviews, failed, loaded, runtime, seen } from "./state";

export function cacheStats(): CacheStat[] {
    const klipy = runtime.klipy?.stats() ?? { saved: 0, recent: 0, bytes: 0 };
    const tenor = runtime.tenorPages?.stats() ?? { saved: 0, bytes: 0 };
    const precached = runtime.precache?.size ?? 0;
    const memory = loaded.approxBytes() + seen.approxBytes() + apiPreviews.approxBytes() + failed.approxBytes() + klipy.bytes + tenor.bytes
        + (runtime.precache?.approxBytes() ?? 0);
    return [
        { label: "Loaded GIFs remembered", value: `${loaded.size} of ${loaded.max}` },
        { label: "Loaded GIFs saved for next time", value: `${seen.size} of ${seen.max}` },
        { label: "Precached GIFs", value: String(precached) },
        { label: "Klipy favourite lookups (saved)", value: `${klipy.saved}, plus ${klipy.recent} recent search results` },
        { label: "Tenor favourites resolved (saved)", value: String(tenor.saved) },
        { label: "Search result previews", value: String(apiPreviews.size) },
        { label: "Previews that failed (saved for a week)", value: String(failed.size) },
        { label: "Memory used", value: `About ${formatBytes(memory)}` },
    ];
}

/** Clears every cache, also the saved lists and lookups. Tiles look things up again. */
export function resetCaches() {
    loaded.clear();
    seen.clear();
    failed.clear();
    apiPreviews.clear();
    // Its finished requests would otherwise count as "previews already there" for 5 minutes
    runtime.lowRes?.clear();
    runtime.klipy?.clear();
    runtime.tenorPages?.clear();
    runtime.precache?.clear();
}
