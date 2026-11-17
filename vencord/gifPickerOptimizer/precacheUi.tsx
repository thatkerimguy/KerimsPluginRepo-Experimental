/*
 * The precache button (Favorites page header and settings) and its stats.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";

import { patchWorks } from "./diagnostics";
import { usePrecacheUpdates } from "./hooks";
import { favoriteUrls, precacheUrl } from "./previews";
import { cl, runtime } from "./state";
import type { GifItem } from "./types";

/** Starts or cancels precaching `items` */
export function PrecacheButton({ label, items }: { label: string; items: GifItem[]; }) {
    usePrecacheUpdates();
    const { precache } = runtime;
    if (!precache || !items.length) return null;

    const { progress: running } = precache;
    if (running) {
        return (
            <Button size="small" variant="secondary" className={cl("precache")} onClick={() => precache.cancel()}>
                {running.label === label ? `Precaching ${running.done}/${running.total}… Stop` : "Stop precaching"}
            </Button>
        );
    }

    const cached = precache.count(favoriteUrls(items));
    return (
        <Button
            size="small"
            variant="secondary"
            className={cl("precache")}
            disabled={cached >= items.length}
            onClick={() => void precache.start(label, items.map(item => () => precacheUrl(item)))}
        >
            {cached >= items.length ? "All precached" : "Precache"}
        </Button>
    );
}

/** "12 GIFs, 8 precached" */
export function precacheStats(items: GifItem[]) {
    const cached = runtime.precache?.count(favoriteUrls(items)) ?? 0;
    return `${items.length} GIF${items.length === 1 ? "" : "s"}, ${cached} precached`;
}

/** Precache button in the Favorites page header (called from a patch) */
export function renderPrecacheButton(label: string, favorites: GifItem[] | undefined) {
    patchWorks("favoritesHeader");
    return <PrecacheButton label={label} items={favorites ?? []} />;
}
