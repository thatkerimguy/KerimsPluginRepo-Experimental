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

import { formatBytes } from "./cache";
import { describePatch, patchStatuses } from "./diagnostics";
import { apiPreviews, cl, failed, FAILED_STORE_KEY, KLIPY_STORE_KEY, loaded, runtime, seen, SEEN_STORE_KEY } from "./state";
import { FRAME_BUDGET_BYTES, frames } from "./stillFrames";

function cacheStats() {
    const klipy = runtime.klipy?.stats() ?? { saved: 0, recent: 0, bytes: 0 };
    const memory = loaded.approxBytes() + seen.approxBytes() + apiPreviews.approxBytes() + failed.approxBytes() + klipy.bytes + frames.weight;
    return [
        { label: "Loaded GIFs remembered", value: `${loaded.size} of ${loaded.max}` },
        { label: "Loaded GIFs saved for next time", value: `${seen.size} of ${seen.max}` },
        { label: "Klipy favourite lookups (saved)", value: `${klipy.saved}, plus ${klipy.recent} recent search results` },
        { label: "Search result previews", value: String(apiPreviews.size) },
        { label: "Previews that failed (saved for a week)", value: String(failed.size) },
        { label: "Still frames", value: `${frames.size} (${formatBytes(frames.weight)} of ${formatBytes(FRAME_BUDGET_BYTES)})` },
        { label: "Memory used", value: `About ${formatBytes(memory)}` },
    ];
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

function StatsTable({ rows }: { rows: { label: string; value: string; }[]; }) {
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

/** "All 3 working" / "2 working, 1 not seen yet" */
function patchesSummary() {
    const all = patchStatuses();
    if (!all.length) return "Enable the plugin to see its patches";
    const count = (state: string) => all.filter(p => p.state === state).length;
    const [working, waiting, failedCount] = [count("ok"), count("waiting"), count("failed")];
    if (working === all.length) return `All ${working} patches working`;
    return [working && `${working} working`, waiting && `${waiting} not seen yet`, failedCount && `${failedCount} failed`].filter(Boolean).join(", ");
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
                    <Paragraph className={cl("muted")}>
                        One that stays "not seen yet" after you do what it says (or a Vencord patch warning in the console) means Discord changed its code: that part works like normal Discord.
                    </Paragraph>
                </>
            )}>
                <Paragraph weight="medium">{patchesSummary()}</Paragraph>
            </ExpandableSection>
        </section>
    );
}

/** What the plugin remembers, and the reset button */
export function CacheSettings() {
    const refresh = useTicker();
    const stats = cacheStats();
    const memory = stats.find(r => r.label === "Memory used")?.value ?? "";
    const remembered = stats.find(r => r.label === "Loaded GIFs remembered")?.value ?? "";

    return (
        <section className={cl("settings-section")}>
            <ExpandableSection renderContent={() => <StatsTable rows={stats.filter(r => r.label !== "Memory used")} />}>
                <Paragraph weight="medium">{memory} in memory · {remembered} loaded GIFs remembered</Paragraph>
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
                    Reset cache
                </Button>
                <Paragraph className={cl("muted")}>Forgets loaded GIFs, previews, still frames and Klipy lookups. Discord's own image cache isn't touched.</Paragraph>
            </div>
        </section>
    );
}
