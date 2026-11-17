/** @jsxRuntime classic */
/** @jsx valenced.react.React.createElement */
/** @jsxFrag valenced.react.React.Fragment */
/*
 * Small pieces shared by the picker and settings: the precache button and
 * its stats, toasts and the confirm alert.
 */

import { AlertActionCreators, ToastActionCreators } from "@valenced/discord/actions";
import { Design } from "@valenced/discord/design";
import * as React from "react";

import { usePrecacheUpdates as usePrecacheUpdatesWith } from "./precache";
import { favoriteUrls, precacheUrl } from "./previews";
import type { GifItem } from "./state";
import { runtime } from "./state";

/** Re-renders when precaching progresses */
export function usePrecacheUpdates() {
    // React itself, not `{ useState, ... }`: the build rewrites React names even as object keys
    usePrecacheUpdatesWith(React, runtime.precache);
}

/** "12 GIFs, 8 precached" */
export function precacheStats(items: GifItem[]) {
    const cached = runtime.precache?.count(favoriteUrls(items)) ?? 0;
    return `${items.length} GIF${items.length === 1 ? "" : "s"}, ${cached} precached`;
}

export function toast(text: string) {
    ToastActionCreators.open("GIFS_PLUS", { text });
}

/** Starts or stops precaching `items` */
export function PrecacheButton({ label, items }: { label: string; items: GifItem[]; }) {
    usePrecacheUpdates();
    // Read on render: Discord's design module isn't loaded when the script is evaluated (lazy.ts)
    const { Button } = Design;
    const { precache } = runtime;
    if (!precache || !items.length) return null;

    const { progress: running } = precache;
    if (running) {
        return (
            <Button
                size="sm"
                variant="secondary"
                text={running.label === label ? `${running.done}/${running.total} · Stop` : "Stop"}
                onPress={() => precache.cancel()}
            />
        );
    }

    const cached = precache.count(favoriteUrls(items));
    const all = cached >= items.length;
    return (
        <Button
            size="sm"
            variant="secondary"
            text={all ? "All precached" : "Precache"}
            disabled={all}
            onPress={() => void precache.start(label, items.map(item => () => precacheUrl(item)))}
        />
    );
}

export function openConfirmAlert(options: { title: string; body: string; confirmText: string; destructive?: boolean; onConfirm(): void; }) {
    const { AlertActionButton, AlertModal } = Design;
    AlertActionCreators.openAlert("gifs-plus-confirm", (
        <AlertModal
            title={options.title}
            content={options.body}
            actions={
                <>
                    <AlertActionButton
                        text={options.confirmText}
                        variant={options.destructive ? "destructive" : "primary"}
                        onPress={options.onConfirm}
                    />
                    <AlertActionButton text="Cancel" variant="secondary" />
                </>
            }
        />
    ));
}
