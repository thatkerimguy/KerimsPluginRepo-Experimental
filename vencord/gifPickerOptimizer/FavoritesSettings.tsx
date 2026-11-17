/*
 * The Favourites section of the plugin's settings: precache favourites, and
 * export / import them.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { chooseFile, saveFile } from "@utils/web";
import { Alerts, showToast } from "@webpack/common";

import { favoriteItems, favoritesBackend } from "./favorites";
import { usePrecacheUpdates } from "./hooks";
import { PrecacheButton, precacheStats } from "./precacheUi";
import { cl, runtime } from "./state";
import { exportFavorites, importFavorites, type ImportMode, importSummary, otherSitesWarning, type ParsedExport, parseExport } from "./transfer";

async function readJsonFile(): Promise<string | null> {
    if (IS_DISCORD_DESKTOP) {
        const [file] = await DiscordNative.fileManager.openFiles({
            filters: [
                { name: "GIFs+ export", extensions: ["json"] },
                { name: "all", extensions: ["*"] },
            ],
        });
        return file ? new TextDecoder().decode(file.data) : null;
    }
    const file = await chooseFile("application/json");
    return file ? file.text() : null;
}

function saveJson(json: string, filename: string) {
    const data = new TextEncoder().encode(json);
    if (IS_DISCORD_DESKTOP) DiscordNative.fileManager.saveWithDialog(data, filename);
    else saveFile(new File([data], filename, { type: "application/json" }));
}

function exportToFile() {
    const json = exportFavorites(favoritesBackend);
    if (json) saveJson(json, `gifs-plus-favorites-${new Date().toISOString().slice(0, 10)}.json`);
}

async function importFromFile(mode: ImportMode) {
    const text = await readJsonFile().catch(() => null);
    if (text == null) return;

    const fail = (e: unknown) => showToast({ text: e instanceof Error ? e.message : String(e), variant: "critical" });
    let file: ParsedExport;
    try {
        file = parseExport(text);
    } catch (e) {
        return fail(e);
    }

    const run = async () => {
        try {
            showToast({ text: importSummary(await importFavorites(favoritesBackend, file, mode)), variant: "success" });
        } catch (e) {
            fail(e);
        }
    };

    const warnings = [
        mode === "overwrite" && "Your favourite GIFs will be replaced with the ones in the file. Favourites that aren't in the file are removed from this account. This can't be undone, so export your favourites first if you might want them back.",
        otherSitesWarning(file),
    ].filter(Boolean);
    if (!warnings.length) return run();
    Alerts.show({
        title: mode === "overwrite" ? "Replace your favourites?" : "Import GIFs from other sites?",
        body: warnings.join("\n\n"),
        confirmText: mode === "overwrite" ? "Replace" : "Import",
        cancelText: "Cancel",
        onConfirm: () => void run(),
    });
}

export function FavoritesSettings() {
    usePrecacheUpdates();
    if (!runtime.precache) {
        return <Paragraph className={cl("muted")}>Enable the plugin to precache, export or import favourites.</Paragraph>;
    }

    const favorites = favoriteItems();

    return (
        <section className={cl("settings-section")}>
            <Heading>Favourites</Heading>
            <div className={cl("favorites-row")}>
                <Paragraph className={cl("muted")}>{precacheStats(favorites)}</Paragraph>
                <PrecacheButton label="Favorites" items={favorites} />
            </div>
            <Paragraph className={cl("muted")}>
                Precaching downloads the previews of all your favourites now, so the Favorites tab shows them at once.
                Export saves your favourites to a file, to keep or move to another account. Merge adds the file's GIFs
                to your favourites; replace swaps your favourites for the file's.
            </Paragraph>
            <div className={cl("actions")}>
                <Button size="small" variant="secondary" disabled={!favorites.length} onClick={exportToFile}>Export favourites</Button>
                <Button size="small" variant="secondary" onClick={() => void importFromFile("merge")}>Import and merge</Button>
                <Button size="small" variant="dangerSecondary" onClick={() => void importFromFile("overwrite")}>Import and replace</Button>
            </div>
        </section>
    );
}
