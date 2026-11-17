/** @jsxRuntime classic */
/** @jsx valenced.react.React.createElement */
/** @jsxFrag valenced.react.React.Fragment */
import Page from "@valenced/components/Page";
import { Design } from "@valenced/discord/design";
import { useEffect, useState } from "react";
import { ScrollView } from "react-native";

import type { PluginSettingsComponent } from "@valenced/plugins/types";
import type { ComponentProps } from "react";

import { FavoritesSection } from "./favoritesSettings";
import type { Quality } from "./lowres";
import type { Settings } from "./settingsStore";
import { cacheControl, DefaultSettings } from "./settingsStore";

const qualities: { value: Quality; label: string; subLabel: string; }[] = [
    { value: "xs", label: "XS", subLabel: "Smallest previews (blurry on most phones). One extra request per search." },
    { value: "s", label: "S", subLabel: "Small previews, what Discord mobile shows for Klipy. Recommended." },
    { value: "sd", label: "SD", subLabel: "Medium previews" },
    { value: "original", label: "Original", subLabel: "Don't downscale previews" },
];

const concurrencies = [1, 2, 3, 4, 6];
const timeouts = [5, 10, 20, 30];
const cacheSizes = [
    { value: 300, label: "300 GIFs" },
    { value: 1000, label: "1000 GIFs" },
    { value: 3000, label: "3000 GIFs" },
];

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings; }>>;

/** Cache stats (refreshed every 2 seconds while open) and a reset button */
function CacheSection() {
    // Read on render: Discord's design module isn't loaded when the script is evaluated (lazy.ts)
    const { TableRow, TableRowGroup } = Design;
    const [, setTick] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setTick(n => n + 1), 2000);
        return () => clearInterval(t);
    }, []);

    const stats = cacheControl.stats?.();
    const reset = cacheControl.reset;

    return (
        <TableRowGroup title="Cache">
            {stats
                ? stats.map(s => <TableRow key={s.label} label={s.label} subLabel={s.value} />)
                : <TableRow label="Enable the plugin to see its cache" />}
            <TableRow
                label="Reset cache"
                subLabel="Forgets loaded GIFs, previews, precached GIFs and the saved Klipy and Tenor lookups. Discord's own image cache isn't touched."
                variant="danger"
                disabled={!reset}
                onPress={() => {
                    reset?.();
                    setTick(n => n + 1);
                }}
            />
        </TableRowGroup>
    );
}

export default function SettingsComponent({ api: { jsonStorage: storage } }: Props) {
    const { Stack, TableRadioGroup, TableRadioRow, TableRowGroup, TableSwitchRow } = Design;
    const s: Settings = { ...DefaultSettings, ...storage.use() };
    const update = (patch: Partial<Settings>) => storage.set(patch);

    return (
        <Page>
            {/* Page doesn't scroll by itself, and these settings are taller than the screen */}
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 48 }}>
                <Stack spacing={24}>
                    <TableRadioGroup
                        title="Preview quality (sent GIFs are always full resolution)"
                        defaultValue={s.quality}
                        onChange={(quality: Quality) => update({ quality })}
                    >
                        {qualities.map(q => (
                            <TableRadioRow key={q.value} label={q.label} subLabel={q.subLabel} value={q.value} />
                        ))}
                    </TableRadioGroup>

                    <TableRowGroup title="Loading">
                        <TableSwitchRow
                            label="Sequential loading"
                            subLabel="Load GIFs one after another, left to right and top to bottom"
                            value={s.sequential}
                            onValueChange={(sequential: boolean) => update({ sequential })}
                        />
                        <TableSwitchRow
                            label="Show loading progress"
                            subLabel="Show an indicator on GIFs that haven't loaded yet"
                            value={s.showProgress}
                            onValueChange={(showProgress: boolean) => update({ showProgress })}
                        />
                        <TableSwitchRow
                            label="Small Klipy previews"
                            subLabel="Ask Discord's GIF API for the smaller Klipy files (one extra request per search page)"
                            value={s.klipyLookup}
                            onValueChange={(klipyLookup: boolean) => update({ klipyLookup })}
                        />
                    </TableRowGroup>

                    <TableRowGroup title="Performance">
                        <TableSwitchRow
                            label="Still previews in favourites"
                            subLabel="Show a still image instead of a playing GIF in the favourites tab (Tenor, Giphy, Twitter and Discord links). Sent GIFs still animate."
                            value={s.stillFavorites}
                            onValueChange={(stillFavorites: boolean) => update({ stillFavorites })}
                        />
                        <TableSwitchRow
                            label="Favourites only"
                            subLabel="Hide Trending GIFs and the other featured categories. The GIF tab's main page keeps search and the Favorites category."
                            value={s.favoritesOnly}
                            onValueChange={(favoritesOnly: boolean) => update({ favoritesOnly })}
                        />
                        <TableSwitchRow
                            label="Faster GIF tab switch"
                            subLabel="Switch to the GIF tab right away and build the picker a moment later, instead of freezing until it's ready"
                            value={s.fastTabSwitch}
                            onValueChange={(fastTabSwitch: boolean) => update({ fastTabSwitch })}
                        />
                    </TableRowGroup>

                    <TableRadioGroup
                        title="Remember loaded GIFs"
                        defaultValue={String(s.cacheSize)}
                        onChange={(v: string) => update({ cacheSize: Number(v) })}
                    >
                        {cacheSizes.map(c => (
                            <TableRadioRow key={c.value} label={c.label} value={String(c.value)} />
                        ))}
                    </TableRadioGroup>

                    <TableRadioGroup
                        title="GIFs loading at the same time"
                        defaultValue={String(s.concurrency)}
                        onChange={(v: string) => update({ concurrency: Number(v) })}
                    >
                        {concurrencies.map(c => (
                            <TableRadioRow key={c} label={String(c)} value={String(c)} />
                        ))}
                    </TableRadioGroup>

                    <TableRadioGroup
                        title="Move on from a slow GIF after"
                        defaultValue={String(s.loadTimeout)}
                        onChange={(v: string) => update({ loadTimeout: Number(v) })}
                    >
                        {timeouts.map(t => (
                            <TableRadioRow key={t} label={`${t} seconds`} value={String(t)} />
                        ))}
                    </TableRadioGroup>

                    <FavoritesSection />

                    <CacheSection />
                </Stack>
            </ScrollView>
        </Page>
    );
}
