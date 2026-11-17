/** @jsxRuntime classic */
/** @jsx valenced.react.React.createElement */
/** @jsxFrag valenced.react.React.Fragment */
/*
 * The settings page: Previews, Loading, GIF picker, Favourites, Status and cache,
 * then Restore default settings. The words come from settingsText.ts (shared).
 * Options with several values are one row showing the current value; tapping it
 * lists the values right under it (one list open at a time).
 */

import Page from "@valenced/components/Page";
import { Design } from "@valenced/discord/design";
import { useEffect, useState } from "react";
import { ScrollView } from "react-native";

import type { PluginSettingsComponent } from "@valenced/plugins/types";
import type { ComponentProps, ReactElement } from "react";

import { describePatch, PATCHES_NOTE, patchStatuses, summarizePatches } from "./diagnostics";
import { FavoritesSection } from "./favoritesSettings";
import { openConfirmAlert } from "./favoritesUi";
import type { Quality } from "./lowres";
import type { Settings } from "./settingsStore";
import { cacheControl, DefaultSettings } from "./settingsStore";
import { cacheStatRows, cacheSummary, QUALITY_CHOICES, RESTORE_DEFAULTS_CONFIRM, SECTIONS, TEXT } from "./settingsText";
import { applyQueueSettings } from "./state";

interface Choice<T> {
    value: T;
    label: string;
    detail?: string;
}

/** Preview sizes ("auto" needs the screen's pixel density, which only the desktop build uses) */
const QUALITIES: Choice<Quality>[] = QUALITY_CHOICES
    .filter(c => c.value !== "auto")
    .map(c => ({ value: c.value as Quality, label: c.label, detail: c.detail }));
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
    const statuses = patchStatuses();
    const numbers = cacheControl.stats?.();
    const choice = { open, setOpen };
    const restoreDefaults = () => openConfirmAlert({
        ...RESTORE_DEFAULTS_CONFIRM,
        onConfirm: () => {
            storage.set({ ...DefaultSettings });
            applyQueueSettings(DefaultSettings);
            setOpen(null);
        },
    });

    return (
        <Page>
            {/* Page doesn't scroll by itself, and these settings are taller than the screen */}
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 48 }}>
                <Stack spacing={24}>
                    <TableRowGroup title={SECTIONS.previews.title} description={SECTIONS.previews.description}>
                        {choiceRows({
                            ...choice,
                            id: "quality",
                            label: TEXT.quality.title,
                            subLabel: QUALITIES.find(q => q.value === s.quality)?.detail ?? TEXT.quality.description,
                            value: s.quality,
                            choices: QUALITIES,
                            onChange: quality => update({ quality }),
                        })}
                        <TableSwitchRow
                            label={TEXT.klipyLookup.title}
                            subLabel={TEXT.klipyLookup.description}
                            value={s.klipyLookup}
                            onValueChange={(klipyLookup: boolean) => update({ klipyLookup })}
                        />
                        <TableSwitchRow
                            label={TEXT.stillFavorites.title}
                            subLabel={`${TEXT.stillFavorites.description} Works for Tenor, Giphy, Twitter and Discord links.`}
                            value={s.stillFavorites}
                            onValueChange={(stillFavorites: boolean) => update({ stillFavorites })}
                        />
                    </TableRowGroup>

                    <TableRowGroup title={SECTIONS.loading.title} description={SECTIONS.loading.description}>
                        <TableSwitchRow
                            label={TEXT.sequential.title}
                            subLabel={TEXT.sequential.description}
                            value={s.sequential}
                            onValueChange={(sequential: boolean) => update({ sequential })}
                        />
                        {s.sequential ? choiceRows({
                            ...choice,
                            id: "concurrency",
                            label: TEXT.concurrency.title,
                            subLabel: TEXT.concurrency.description,
                            value: s.concurrency,
                            choices: CONCURRENCIES,
                            onChange: concurrency => update({ concurrency }),
                        }) : null}
                        {s.sequential ? choiceRows({
                            ...choice,
                            id: "loadTimeout",
                            label: TEXT.loadTimeout.title,
                            subLabel: TEXT.loadTimeout.description,
                            value: s.loadTimeout,
                            choices: TIMEOUTS,
                            onChange: loadTimeout => update({ loadTimeout }),
                        }) : null}
                        <TableSwitchRow
                            label={TEXT.showProgress.title}
                            subLabel={TEXT.showProgress.description}
                            value={s.showProgress}
                            onValueChange={(showProgress: boolean) => update({ showProgress })}
                        />
                    </TableRowGroup>

                    <TableRowGroup title={SECTIONS.picker.title}>
                        <TableSwitchRow
                            label={TEXT.favoritesOnly.title}
                            subLabel={TEXT.favoritesOnly.description}
                            value={s.favoritesOnly}
                            onValueChange={(favoritesOnly: boolean) => update({ favoritesOnly })}
                        />
                        <TableSwitchRow
                            label={TEXT.fastTabSwitch.title}
                            subLabel={TEXT.fastTabSwitch.description}
                            value={s.fastTabSwitch}
                            onValueChange={(fastTabSwitch: boolean) => update({ fastTabSwitch })}
                        />
                    </TableRowGroup>

                    <FavoritesSection />

                    <TableRowGroup title={SECTIONS.status.title} description={SECTIONS.status.description}>
                        <TableRow
                            label="Patches"
                            subLabel={summarizePatches(statuses)}
                            arrow={running && !showPatches}
                            disabled={!running}
                            onPress={() => setShowPatches(v => !v)}
                        />
                        {showPatches ? statuses.map(p => <TableRow key={p.label} label={p.label} subLabel={describePatch(p)} />) : null}
                        {showPatches ? <TableRow key="patches-note" label="About patches" subLabel={PATCHES_NOTE} /> : null}
                        {choiceRows({
                            ...choice,
                            id: "cacheSize",
                            label: TEXT.cacheSize.title,
                            subLabel: TEXT.cacheSize.description,
                            value: s.cacheSize,
                            choices: CACHE_SIZES,
                            onChange: cacheSize => update({ cacheSize }),
                        })}
                        <TableRow
                            label="Cache"
                            subLabel={numbers ? cacheSummary(numbers) : "Enable the plugin to see its cache"}
                            arrow={running && !showCache}
                            disabled={!running}
                            onPress={() => setShowCache(v => !v)}
                        />
                        {showCache && numbers ? cacheStatRows(numbers).map(st => (
                            <TableRow key={st.label} label={st.label} subLabel={st.value} />
                        )) : null}
                        <TableRow
                            label={TEXT.resetCache.title}
                            subLabel={TEXT.resetCache.description}
                            variant="danger"
                            disabled={!cacheControl.reset}
                            onPress={() => {
                                cacheControl.reset?.();
                                refresh();
                            }}
                        />
                    </TableRowGroup>

                    <TableRowGroup>
                        <TableRow
                            label={TEXT.restoreDefaults.title}
                            subLabel={TEXT.restoreDefaults.description}
                            onPress={restoreDefaults}
                        />
                    </TableRowGroup>
                </Stack>
            </ScrollView>
        </Page>
    );
}
