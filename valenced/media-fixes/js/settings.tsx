/** @jsxRuntime classic */
/** @jsx valenced.react.React.createElement */
/** @jsxFrag valenced.react.React.Fragment */
/*
 * The settings page. Everything lives in the native part: this page reads its
 * status every 2 seconds and changes settings through the bridge (native.ts).
 * (The classic JSX pragma: Valenced evaluates the script before React exists,
 * so nothing may read React at module level.)
 */

import Page from "@valenced/components/Page";
import { Design } from "@valenced/discord/design";
import { useEffect, useState } from "react";
import { ScrollView } from "react-native";

import type { NativeStatus, SettingKey } from "./native";
import { forgetDecoderFailures, nativeStatus, setSetting, stopAllMedia } from "./native";

const SETTINGS: { key: SettingKey; label: string; subLabel: string; }[] = [
    {
        key: "decoderFix",
        label: "Fix black videos",
        subLabel: "When your phone's hardware decoder can't play a video (often AV1, HEVC or very high resolution ones), use Android's software decoder instead of playing only the sound. Decoders that failed are remembered.",
    },
    {
        key: "backgroundGuard",
        label: "No playing in the background",
        subLabel: "Pause Discord's videos and voice messages when you leave Discord, and never let one start by itself while Discord isn't on screen.",
    },
    {
        key: "oneAtATime",
        label: "One video with sound at a time",
        subLabel: "Starting a video with sound pauses any other one that's playing with sound (muted and GIF-like videos aren't affected).",
    },
    {
        key: "toasts",
        label: "Show messages",
        subLabel: "A short message when a video switches to software decoding, or can't be shown on this phone.",
    },
];

/** Re-renders every 2 seconds. Returns a function that re-renders now. */
function useTicker() {
    const [, setTick] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setTick(n => n + 1), 2000);
        return () => clearInterval(t);
    }, []);
    return () => setTick(n => n + 1);
}

function Unavailable() {
    const { TableRow, TableRowGroup } = Design;
    return (
        <TableRowGroup title="Not available">
            <TableRow
                label="The native part isn't loaded"
                subLabel="Both fixes are Android code. This needs Valenced on Android with native plugins; restart Discord after installing."
            />
        </TableRowGroup>
    );
}

export default function MediaFixesSettings() {
    const { Stack, TableRow, TableRowGroup, TableSwitchRow } = Design;
    const refresh = useTicker();
    const [showRecent, setShowRecent] = useState(false);
    const [lastStop, setLastStop] = useState<string | null>(null);
    const status: NativeStatus | null = nativeStatus();

    return (
        <Page>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 48 }}>
                <Stack spacing={24}>
                    {status == null ? <Unavailable /> : (
                        <>
                            <TableRowGroup title="Fixes">
                                {SETTINGS.map(s => (
                                    <TableSwitchRow
                                        key={s.key}
                                        label={s.label}
                                        subLabel={s.subLabel}
                                        value={status.settings[s.key]}
                                        onValueChange={(value: boolean) => {
                                            setSetting(s.key, value);
                                            refresh();
                                        }}
                                    />
                                ))}
                            </TableRowGroup>

                            <TableRowGroup title="Playing now">
                                <TableRow
                                    label="Stop all media"
                                    subLabel={lastStop ?? `Pauses every video and voice message Discord is playing, also ones you can't see. ${status.playing} playing now.`}
                                    onPress={() => {
                                        const n = stopAllMedia();
                                        setLastStop(n === 0 ? "Nothing was playing." : `Paused ${n}.`);
                                        refresh();
                                    }}
                                />
                            </TableRowGroup>

                            <TableRowGroup
                                title="Decoders"
                                description="Hardware decoders that failed on this phone. For those videos (at that size or larger) the software decoder is used."
                            >
                                {status.learned.length === 0
                                    ? <TableRow label="None so far" />
                                    : status.learned.map(l => <TableRow key={l} label={l} />)}
                                {status.learned.length > 0
                                    ? (
                                        <TableRow
                                            label="Forget them"
                                            subLabel="Try the hardware decoders again (after a system update, for example)."
                                            variant="danger"
                                            onPress={() => {
                                                forgetDecoderFailures();
                                                refresh();
                                            }}
                                        />
                                    )
                                    : null}
                            </TableRowGroup>

                            <TableRowGroup
                                title="Status"
                                description={status.waitingForRestart
                                    ? "Restart Discord to start the fixes."
                                    : `Version ${status.version}. Found by searching Discord's code; a part that isn't found leaves Discord's own behaviour.`}
                            >
                                {status.parts.map(p => (
                                    <TableRow
                                        key={p.name}
                                        label={p.name}
                                        subLabel={p.problem == null ? "Working" : `Not working: ${p.problem}`}
                                    />
                                ))}
                                <TableRow
                                    label="Recent events"
                                    subLabel={status.recent.length === 0
                                        ? "Nothing yet"
                                        : showRecent ? "Tap to hide" : `${status.recent.length}, newest: ${status.recent[0]}`}
                                    onPress={() => setShowRecent(v => !v)}
                                />
                                {showRecent ? status.recent.map((r, i) => <TableRow key={`${i}:${r}`} label={r} />) : null}
                            </TableRowGroup>
                        </>
                    )}
                </Stack>
            </ScrollView>
        </Page>
    );
}
