/*
 * Cache figures for the settings, and clearing every cache (the reset button,
 * settings and version changes).
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";

import type { CacheNumbers } from "./settingsText";
import { apiPreviews, failed, FAILED_STORE_KEY, KLIPY_STORE_KEY, loadedThisSession, runtime, seen, SEEN_STORE_KEY } from "./state";
import { FRAME_BUDGET_BYTES, frames } from "./stillFrames";

export function cacheNumbers(): CacheNumbers {
    const klipy = runtime.klipy?.stats() ?? { saved: 0, recent: 0, bytes: 0 };
    return {
        loaded: loadedThisSession.size,
        loadedMax: loadedThisSession.max,
        seen: seen.size,
        seenMax: seen.max,
        klipySaved: klipy.saved,
        klipyRecent: klipy.recent,
        searchPreviews: apiPreviews.size,
        failed: failed.size,
        frames: { count: frames.size, bytes: frames.weight, budget: FRAME_BUDGET_BYTES },
        memoryBytes: loadedThisSession.approxBytes() + seen.approxBytes() + apiPreviews.approxBytes() + failed.approxBytes() + klipy.bytes + frames.weight,
    };
}

/** Clears every cache, also the saved lists and Klipy lookups. Tiles look things up again. */
export function resetCaches() {
    loadedThisSession.clear();
    seen.clear();
    failed.clear();
    apiPreviews.clear();
    // Its finished requests would otherwise count as "previews already there" for 5 minutes
    runtime.lowRes?.clear();
    frames.clear();
    if (runtime.klipy) {
        // Running: clearing also saves the empty list (seen and failed did above)
        runtime.klipy.clear();
    } else {
        // Stopped: nothing is attached to the saved lists, so delete them directly
        for (const key of [KLIPY_STORE_KEY, SEEN_STORE_KEY, FAILED_STORE_KEY]) void DataStore.del(key);
    }
}
