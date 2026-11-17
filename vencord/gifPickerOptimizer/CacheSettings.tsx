/*
 * The "Status and cache" part of the plugin's settings: patch status, cache stats, reset.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { ExpandableSection } from "@components/ExpandableCard";
import { Paragraph } from "@components/Paragraph";
import { useEffect, useState } from "@webpack/common";

import { cacheNumbers, resetCaches } from "./cacheStats";
import { describePatch, PATCHES_NOTE, patchStatuses, summarizePatches } from "./diagnostics";
import { cacheStatRows, cacheSummary, type StatRow, TEXT } from "./settingsText";
import { cl } from "./state";

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
