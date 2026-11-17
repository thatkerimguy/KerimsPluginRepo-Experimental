/*
 * Cache stats and the reset button in the plugin's settings.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
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

export function CacheSettings() {
    const [, setTick] = useState(0);
    const refresh = () => setTick(n => n + 1);

    useEffect(() => {
        const timer = setInterval(refresh, 2000);
        return () => clearInterval(timer);
    }, []);

    return (
        <section className={cl("cache")}>
            <Heading>Cache</Heading>
            <table className={cl("cache-stats")}>
                <tbody>
                    {cacheStats().map(s => (
                        <tr key={s.label}>
                            <td><Paragraph>{s.label}</Paragraph></td>
                            <td><Paragraph>{s.value}</Paragraph></td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <Heading>Patches</Heading>
            <table className={cl("cache-stats")}>
                <tbody>
                    {patchStatuses().map(p => (
                        <tr key={p.label}>
                            <td><Paragraph>{p.label}</Paragraph></td>
                            <td><Paragraph>{describePatch(p)}</Paragraph></td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <Paragraph className={cl("cache-note")}>
                A patch that stays "not seen yet" after doing what it says (or a Vencord patch warning in the console) means Discord changed its code: that part falls back to Discord's own behaviour.
            </Paragraph>
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
            <Paragraph className={cl("cache-note")}>
                Forgets loaded GIFs, previews, still frames and the saved Klipy lookups. Discord's own image cache isn't touched.
            </Paragraph>
        </section>
    );
}
