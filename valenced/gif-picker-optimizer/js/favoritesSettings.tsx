/** @jsxRuntime classic */
/** @jsx valenced.react.React.createElement */
/** @jsxFrag valenced.react.React.Fragment */
/*
 * The Favourites settings section: export / import
 * them between accounts (through the clipboard).
 */

import { Design } from "@valenced/discord/design";
import { Clipboard } from "@valenced/externals/react-native-clipboard";
import { Share } from "react-native";

import { openConfirmAlert, toast } from "./alerts";
import { favoritesBackend } from "./favorites";
import { SECTIONS } from "./settingsText";
import { runtime } from "./state";
import type { ImportMode, ParsedExport } from "./transfer";
import { exportFavorites, importFavorites, importSummary, otherSitesWarning, parseExport } from "./transfer";

const plural = (n: number) => `${n} GIF${n === 1 ? "" : "s"}`;

/** Copies an export to the clipboard and offers to share it */
async function exportToClipboard() {
    const json = exportFavorites(favoritesBackend);
    if (!json) {
        toast("Your favourites haven't loaded yet. Open the GIF picker once and try again.");
        return;
    }
    Clipboard.setString(json);
    toast(`Copied ${plural(Object.keys(favoritesBackend.read() ?? {}).length)} to the clipboard`);
    try {
        await Share.share({ message: json, title: "GIFs+ favourites" });
    } catch { }
}

async function importFromClipboard(mode: ImportMode) {
    let text = "";
    try {
        text = await Clipboard.getString();
    } catch { }
    if (!text.trim()) {
        toast("Copy a GIFs+ export first, then import it.");
        return;
    }
    const fail = (e: unknown) => toast(e instanceof Error ? e.message : "Couldn't import that.");
    let file: ParsedExport;
    try {
        file = parseExport(text);
    } catch (e) {
        fail(e);
        return;
    }
    const run = async () => {
        try {
            toast(importSummary(await importFavorites(favoritesBackend, file, mode)));
        } catch (e) {
            fail(e);
        }
    };
    const warnings = [
        mode === "overwrite" && "Your favourite GIFs on this account are replaced with the ones in the export. This syncs to your other devices.",
        otherSitesWarning(file),
    ].filter(Boolean);
    if (!warnings.length) {
        await run();
        return;
    }
    openConfirmAlert({
        title: mode === "overwrite" ? "Replace your favourites?" : "Import GIFs from other sites?",
        body: warnings.join("\n\n"),
        confirmText: mode === "overwrite" ? "Replace" : "Import",
        destructive: mode === "overwrite",
        onConfirm: () => void run(),
    });
}

export function FavoritesSection() {
    // Read on render: Discord's design module isn't loaded when the script is evaluated (lazy.ts)
    const { TableRow, TableRowGroup } = Design;
    // Discord's favourites are found a moment after the plugin starts
    const ready = !!runtime.frecency;
    const count = Object.keys(favoritesBackend.read() ?? {}).length;

    return (
        <TableRowGroup title={SECTIONS.favorites.title} description={SECTIONS.favorites.description}>
            <TableRow
                label="Export favourites"
                subLabel={ready ? `Copies all ${plural(count)} to the clipboard` : "Enable the plugin, then open the GIF picker once"}
                disabled={!ready}
                onPress={() => void exportToClipboard()}
            />
            <TableRow
                label="Import and merge"
                subLabel="Adds the GIFs from the clipboard to your favourites"
                disabled={!ready}
                onPress={() => void importFromClipboard("merge")}
            />
            <TableRow
                label="Import and replace"
                subLabel="Replaces your favourites with the ones from the clipboard"
                variant="danger"
                disabled={!ready}
                onPress={() => void importFromClipboard("overwrite")}
            />
        </TableRowGroup>
    );
}
