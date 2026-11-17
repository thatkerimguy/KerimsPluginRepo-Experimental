/*
 * The "Status and cache" part of the plugin's settings: patch status, cache stats, reset.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Button } from "@components/Button";
import { ExpandableSection } from "@components/ExpandableCard";
import { Paragraph } from "@components/Paragraph";
import { useEffect, useState } from "@webpack/common";

import { describePatch, PATCHES_NOTE, patchStatuses, summarizePatches } from "./diagnostics";
import { type CacheNumbers, cacheStatRows, cacheSummary, type StatRow, TEXT } from "./settingsText";
import { apiPreviews, cl, failed, FAILED_STORE_KEY, KLIPY_STORE_KEY, loaded, runtime, seen, SEEN_STORE_KEY } from "./state";
import { FRAME_BUDGET_BYTES, frames } from "./stillFrames";

function cacheNumbers(): CacheNumbers {
    const klipy = runtime.klipy?.stats() ?? { saved: 0, recent: 0, bytes: 0 };
    return {
        loaded: loaded.size,
        loadedMax: loaded.max,
        seen: seen.size,
        seenMax: seen.max,
        klipySaved: klipy.saved,
        klipyRecent: klipy.recent,
        searchPreviews: apiPreviews.size,
        failed: failed.size,
        frames: { count: frames.size, bytes: frames.weight, budget: FRAME_BUDGET_BYTES },
        memoryBytes: loaded.approxBytes() + seen.approxBytes() + apiPreviews.approxBytes() + failed.approxBytes() + klipy.bytes + frames.weight,
    };
}

/** Clears every cache, also the saved lists and Klipy lookups. Tiles look things up again. */
function resetCaches() {
    loaded.clear();
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

/** Re-renders every 2 seconds while the settings are open (live stats). Returns a function that re-renders now. */
function useTicker() {
    const [, setTick] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => setTick(n => n + 1), 2000);
        return () => clearInterval(timer);
    }, []);
    return () => setTick(n => n + 1);
}

function StatsTable({ rows }: { rows: StatRow[]; }) {
    return (
        <table className={cl("stats")}>
            <tbody>
                {rows.map(r => (
                    <tr key={r.label}>
                        <td><Paragraph>{r.label}</Paragraph></td>
                        <td><Paragraph>{r.value}</Paragraph></td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

/** Whether the plugin's hooks into Discord work */
export function PatchesSettings() {
    useTicker();
    const statuses = patchStatuses();
    return (
        <section className={cl("settings-section")}>
            <ExpandableSection renderContent={() => (
                <>
                    <StatsTable rows={statuses.map(p => ({ label: p.label, value: describePatch(p) }))} />
                    <Paragraph className={cl("muted")}>{PATCHES_NOTE}</Paragraph>
                </>
            )}>
                <Paragraph weight="medium">Patches: {summarizePatches(statuses)}</Paragraph>
            </ExpandableSection>
        </section>
    );
}

/** What the plugin remembers, and the reset button */
export function CacheSettings() {
    const refresh = useTicker();
    const numbers = cacheNumbers();

    return (
        <section className={cl("settings-section")}>
            <ExpandableSection renderContent={() => <StatsTable rows={cacheStatRows(numbers)} />}>
                <Paragraph weight="medium">{cacheSummary(numbers)}</Paragraph>
            </ExpandableSection>
            <div className={cl("actions")}>
                <Button
                    variant="dangerSecondary"
                    size="small"
                    onClick={() => {
                        resetCaches();
                        refresh();
                    }}
                >
                    {TEXT.resetCache.title}
                </Button>
                <Paragraph className={cl("muted")}>{TEXT.resetCache.description}</Paragraph>
            </div>
        </section>
    );
}
