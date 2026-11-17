/** @jsxRuntime classic */
/** @jsx valenced.react.React.createElement */
/** @jsxFrag valenced.react.React.Fragment */
/*
 * The settings page: Previews, Loading, GIF picker, Favourites, Patches, Cache.
 * Options with several values are one row showing the current value; tapping it
 * lists the values right under it (one list open at a time).
 */

import Page from "@valenced/components/Page";
import { Design } from "@valenced/discord/design";
import { useEffect, useState } from "react";
import { ScrollView } from "react-native";

import type { PluginSettingsComponent } from "@valenced/plugins/types";
import type { ComponentProps, ReactElement } from "react";

import { FavoritesSection } from "./favoritesSettings";
import type { Quality } from "./lowres";
import type { CacheStat, Settings } from "./settingsStore";
import { cacheControl, DefaultSettings } from "./settingsStore";

interface Choice<T> {
    value: T;
    label: string;
    detail?: string;
}

const QUALITIES: Choice<Quality>[] = [
    { value: "xs", label: "XS", detail: "Smallest and fastest, but blurry on most phones. One extra request per search." },
    { value: "s", label: "S", detail: "Small. What Discord already loads for Klipy, so no extra request. Recommended." },
    { value: "sd", label: "SD", detail: "Medium, sharper on large screens." },
    { value: "original", label: "Original", detail: "No previews: every GIF loads at full size." },
];
const CONCURRENCIES: Choice<number>[] = [1, 2, 3, 4, 6].map(n => ({
    value: n,
    label: `${n} at a time`,
    detail: n === 1 ? "Strictly one by one" : n === DefaultSettings.concurrency ? "Default" : undefined,
}));
const TIMEOUTS: Choice<number>[] = [5, 10, 20, 30].map(s => ({
    value: s,
    label: `${s} seconds`,
    detail: s === DefaultSettings.loadTimeout ? "Default" : undefined,
}));
const CACHE_SIZES: Choice<number>[] = [300, 1000, 3000].map(n => ({
    value: n,
    label: `${n} GIFs`,
    detail: n === DefaultSettings.cacheSize ? "Default" : undefined,
}));

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings; }>>;

/** Re-renders every 2 seconds (live stats). Returns a function that re-renders now. */
function useTicker() {
    const [, setTick] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setTick(n => n + 1), 2000);
        return () => clearInterval(t);
    }, []);
    return () => setTick(n => n + 1);
}

/**
 * Rows for a setting with several values: the row with the current value, and the
 * values under it while it's open. Plain rows, not a fragment, so the group draws
 * its rounded corners and dividers around each of them.
 */
function choiceRows<T>(o: {
    id: string;
    label: string;
    subLabel: string;
    value: T;
    choices: Choice<T>[];
    open: string | null;
    setOpen(id: string | null): void;
    onChange(value: T): void;
}): ReactElement[] {
    // Read on render: Discord's design module isn't loaded when the script is evaluated (lazy.ts)
    const { TableRow, Text } = Design;
    const current = o.choices.find(c => c.value === o.value);
    const isOpen = o.open === o.id;
    const rows = [
        <TableRow
            key={o.id}
            label={o.label}
            subLabel={o.subLabel}
            trailing={<TableRow.TrailingText text={current?.label ?? String(o.value)} />}
            arrow={!isOpen}
            onPress={() => o.setOpen(isOpen ? null : o.id)}
        />,
    ];
    if (!isOpen) return rows;
    for (const c of o.choices) {
        rows.push(
            <TableRow
                key={`${o.id}:${String(c.value)}`}
                label={c.label}
                subLabel={c.detail}
                trailing={c.value === o.value ? <Text variant="text-md/semibold" color="text-strong">✓</Text> : undefined}
                onPress={() => {
                    o.onChange(c.value);
                    o.setOpen(null);
                }}
            />,
        );
    }
    return rows;
}

/** "All 5 working" / "3 working, 2 not seen yet" */
function patchesSummary(patches: CacheStat[]) {
    const working = patches.filter(p => p.value === "Working").length;
    const failed = patches.filter(p => p.value.startsWith("Failed")).length;
    const waiting = patches.length - working - failed;
    if (working === patches.length) return `All ${working} working`;
    return [working && `${working} working`, waiting && `${waiting} not seen yet`, failed && `${failed} failed`].filter(Boolean).join(", ");
}

export default function SettingsComponent({ api: { jsonStorage: storage } }: Props) {
    const { Stack, TableRow, TableRowGroup, TableSwitchRow } = Design;
    const s: Settings = { ...DefaultSettings, ...storage.use() };
    const update = (patch: Partial<Settings>) => storage.set(patch);
    /** Which multi-value setting lists its values */
    const [open, setOpen] = useState<string | null>(null);
    const [showPatches, setShowPatches] = useState(false);
    const [showCache, setShowCache] = useState(false);
    const refresh = useTicker();

    const running = !!cacheControl.stats;
    const patches = cacheControl.patches?.() ?? [];
    const stats = cacheControl.stats?.() ?? [];
    const memory = stats.find(st => st.label === "Memory used")?.value.replace(/^About /, "");
    const remembered = stats.find(st => st.label === "Loaded GIFs remembered")?.value;
    const choice = { open, setOpen };

    return (
        <Page>
            {/* Page doesn't scroll by itself, and these settings are taller than the screen */}
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 48 }}>
                <Stack spacing={24}>
                    <TableRowGroup title="Previews" description="Smaller versions of the GIFs in the picker. The GIF you send is always the full size one.">
                        {choiceRows({
                            ...choice,
                            id: "quality",
                            label: "Preview size",
                            subLabel: QUALITIES.find(q => q.value === s.quality)?.detail ?? "",
                            value: s.quality,
                            choices: QUALITIES,
                            onChange: quality => update({ quality }),
                        })}
                        <TableSwitchRow
                            label="Small Klipy previews"
                            subLabel="Klipy is Discord's GIF source. Its small versions need one extra request per search page."
                            value={s.klipyLookup}
                            onValueChange={(klipyLookup: boolean) => update({ klipyLookup })}
                        />
                        <TableSwitchRow
                            label="Still favourites"
                            subLabel="Show favourites as still images (Tenor, Giphy, Twitter and Discord links). Sent GIFs still animate."
                            value={s.stillFavorites}
                            onValueChange={(stillFavorites: boolean) => update({ stillFavorites })}
                        />
                    </TableRowGroup>

                    <TableRowGroup title="Loading">
                        <TableSwitchRow
                            label="Load one by one"
                            subLabel="Load GIFs in reading order, a few at a time, instead of all at once"
                            value={s.sequential}
                            onValueChange={(sequential: boolean) => update({ sequential })}
                        />
                        {s.sequential ? choiceRows({
                            ...choice,
                            id: "concurrency",
                            label: "GIFs at the same time",
                            subLabel: "More is faster on a good connection",
                            value: s.concurrency,
                            choices: CONCURRENCIES,
                            onChange: concurrency => update({ concurrency }),
                        }) : null}
                        {s.sequential ? choiceRows({
                            ...choice,
                            id: "loadTimeout",
                            label: "Skip slow GIFs after",
                            subLabel: "Then the next one starts; the slow one keeps loading",
                            value: s.loadTimeout,
                            choices: TIMEOUTS,
                            onChange: loadTimeout => update({ loadTimeout }),
                        }) : null}
                        <TableSwitchRow
                            label="Loading indicators"
                            subLabel="A dot, spinner or progress line on GIFs that haven't loaded yet"
                            value={s.showProgress}
                            onValueChange={(showProgress: boolean) => update({ showProgress })}
                        />
                    </TableRowGroup>

                    <TableRowGroup title="GIF picker">
                        <TableSwitchRow
                            label="Favourites only"
                            subLabel="Hide Trending and the featured categories. Search and Favorites stay."
                            value={s.favoritesOnly}
                            onValueChange={(favoritesOnly: boolean) => update({ favoritesOnly })}
                        />
                        <TableSwitchRow
                            label="Faster GIF tab switch"
                            subLabel="Open the GIF tab at once and build the picker right after, instead of freezing"
                            value={s.fastTabSwitch}
                            onValueChange={(fastTabSwitch: boolean) => update({ fastTabSwitch })}
                        />
                    </TableRowGroup>

                    <FavoritesSection />

                    <TableRowGroup
                        title="Patches"
                        description="Whether the plugin's hooks into Discord work. One that stays “not seen yet” after you do what it says means Discord changed its code, and that part works like normal Discord."
                    >
                        <TableRow
                            label={running ? patchesSummary(patches) : "Enable the plugin to see its patches"}
                            arrow={running && !showPatches}
                            disabled={!running}
                            onPress={() => setShowPatches(v => !v)}
                        />
                        {showPatches ? patches.map(p => <TableRow key={p.label} label={p.label} subLabel={p.value} />) : null}
                    </TableRowGroup>

                    <TableRowGroup title="Cache" description="What the plugin remembers about GIFs. Discord's own image cache isn't part of it.">
                        {choiceRows({
                            ...choice,
                            id: "cacheSize",
                            label: "Remembered GIFs",
                            subLabel: "Loaded GIFs that show at once when you scroll back",
                            value: s.cacheSize,
                            choices: CACHE_SIZES,
                            onChange: cacheSize => update({ cacheSize }),
                        })}
                        <TableRow
                            label={running ? `About ${memory ?? "0 B"} in memory` : "Enable the plugin to see its cache"}
                            subLabel={running ? `${remembered ?? "0"} loaded GIFs remembered` : undefined}
                            arrow={running && !showCache}
                            disabled={!running}
                            onPress={() => setShowCache(v => !v)}
                        />
                        {showCache ? stats.filter(st => st.label !== "Memory used").map(st => (
                            <TableRow key={st.label} label={st.label} subLabel={st.value} />
                        )) : null}
                        <TableRow
                            label="Reset cache"
                            subLabel="Forgets loaded GIFs, previews and the saved Klipy and Tenor lookups"
                            variant="danger"
                            disabled={!cacheControl.reset}
                            onPress={() => {
                                cacheControl.reset?.();
                                refresh();
                            }}
                        />
                    </TableRowGroup>
                </Stack>
            </ScrollView>
        </Page>
    );
}
