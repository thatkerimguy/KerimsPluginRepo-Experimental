/*
 * Cache figures and reset, shown in settings through `cacheControl`.
 */

import type { CacheNumbers } from "./settingsText";
import { apiPreviews, failed, loaded, runtime, seen } from "./state";

export function cacheNumbers(): CacheNumbers {
    const klipy = runtime.klipy?.stats() ?? { saved: 0, recent: 0, bytes: 0 };
    const tenor = runtime.tenorPages?.stats() ?? { saved: 0, bytes: 0 };
    return {
        loaded: loaded.size,
        loadedMax: loaded.max,
        seen: seen.size,
        seenMax: seen.max,
        klipySaved: klipy.saved,
        klipyRecent: klipy.recent,
        tenorSaved: tenor.saved,
        searchPreviews: apiPreviews.size,
        failed: failed.size,
        memoryBytes: loaded.approxBytes() + seen.approxBytes() + apiPreviews.approxBytes() + failed.approxBytes() + klipy.bytes + tenor.bytes,
    };
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
}
