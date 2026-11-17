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
import { apiPreviews, cl, failed, KLIPY_STORE_KEY, loaded, runtime, seen } from "./state";
import { FRAME_BUDGET_BYTES, frames } from "./stillFrames";

function cacheStats() {
    const klipy = runtime.klipy?.stats() ?? { saved: 0, recent: 0, bytes: 0 };
    const memory = loaded.approxBytes() + seen.approxBytes() + apiPreviews.approxBytes() + failed.approxBytes() + klipy.bytes + frames.weight
        + (runtime.precache?.approxBytes() ?? 0);
    return [
        { label: "Loaded GIFs remembered", value: `${loaded.size} of ${loaded.max}` },
        { label: "Loaded GIFs saved for next time", value: `${seen.size} of ${seen.max}` },
        { label: "Precached GIFs", value: String(runtime.precache?.size ?? 0) },
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
    frames.clear();
    runtime.precache?.clear();
    if (runtime.klipy) runtime.klipy.clear();
    else void DataStore.del(KLIPY_STORE_KEY);
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
                Forgets loaded GIFs, previews, still frames, precached GIFs and the saved Klipy lookups. Discord's own image cache isn't touched.
            </Paragraph>
        </section>
    );
}
