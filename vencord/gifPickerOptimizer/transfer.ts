/*
 * GIFs+ — exporting favourites to a file and importing them, also on another account.
 * Shared between the Vencord and Valenced builds (keep both copies in sync).
 */

import { FAVORITES_MAX_BYTES, type FavoriteMap, type FavoritesBackend, favoritesBytes } from "./favoritesBackend";

export type ImportMode = "merge" | "overwrite";

/** GIFType.IMAGE in Discord's frecency protobuf */
const GIF_TYPE_IMAGE = 1;

const EXPORT_FORMAT = "gifs-plus";
const EXPORT_VERSION = 1;

/** A Discord attachment URL without its expiring signature (ex, is, hm) */
function withoutSignature(url: string) {
    const q = url.indexOf("?");
    if (q === -1) return url;
    const kept = url.slice(q + 1).split("&").filter(p => p && !/^(ex|is|hm)=/.test(p));
    return kept.length ? `${url.slice(0, q)}?${kept.join("&")}` : url.slice(0, q);
}

export function nextOrder(gifs: FavoriteMap) {
    let max = 0;
    for (const entry of Object.values(gifs)) {
        if ((entry?.order ?? 0) > max) max = entry.order!;
    }
    return max + 1;
}

export interface ExportedGif {
    url: string;
    src: string;
    width?: number;
    height?: number;
    format?: number;
}

export interface ExportFile {
    format: typeof EXPORT_FORMAT;
    version: typeof EXPORT_VERSION;
    /** Newest first */
    gifs: ExportedGif[];
}

/** All favourites, newest first */
export function buildExport(favorites: FavoriteMap): ExportFile {
    const gifs = Object.entries(favorites)
        .filter(([, entry]) => entry?.src)
        .sort((a, b) => (b[1].order ?? 0) - (a[1].order ?? 0))
        .map(([url, entry]): ExportedGif => ({ url, src: entry.src, width: entry.width, height: entry.height, format: entry.format }));
    return { format: EXPORT_FORMAT, version: EXPORT_VERSION, gifs };
}

/** An export as readable JSON: one GIF per line, so big exports stay easy to read and edit */
export function formatExport(file: ExportFile): string {
    const gifs = file.gifs.length ? `[\n${file.gifs.map(g => `    ${JSON.stringify(g)}`).join(",\n")}\n  ]` : "[]";
    return [
        "{",
        `  "format": ${JSON.stringify(file.format)},`,
        `  "version": ${JSON.stringify(file.version)},`,
        `  "gifs": ${gifs}`,
        "}",
        "",
    ].join("\n");
}

/** https (or protocol relative, which is https in Discord) only: plain http would load or send unencrypted */
const isHttpsUrl = (v: unknown): v is string => typeof v === "string" && /^(https:)?\/\/[^/?#\s]+/i.test(v);
/** Largest value Discord's protobuf takes for a size (uint32) */
const MAX_SIZE = 0xffff_ffff;
const optionalSize = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), MAX_SIZE) : undefined);
/** GIFType: 1 image, 2 video. Anything else would fail Discord's protobuf encoding. */
const optionalFormat = (v: unknown) => (v === 1 || v === 2 ? v : undefined);

/**
 * Sites Discord's own favourites come from (the GIF pickers, Discord's CDN and
 * proxies, and the usual embed hosts). Any other site in an import is shown to
 * the user before importing: a file from someone else could hold tiles that load
 * from a tracking host, or send a different link than the GIF they show.
 */
const KNOWN_SITES = /(^|\.)(discord\.com|discordapp\.com|discordapp\.net|tenor\.com|tenor\.co|giphy\.com|klipy\.com|twimg\.com|twitter\.com|x\.com|fxtwitter\.com|vxtwitter\.com|fixupx\.com|imgur\.com)$/i;

/** The host of an https URL, lowercased ("" when there is none) */
export function urlHost(url: string) {
    return /^(?:https:)?\/\/([^/?#:\s]+)/i.exec(url)?.[1]?.toLowerCase() ?? "";
}

/** An export read from text, with what the import should show the user first */
export interface ParsedExport extends ExportFile {
    /** Entries left out: not https, or not a GIF at all */
    skipped: number;
    /** Sites outside KNOWN_SITES that GIFs load from or link to, most used first */
    otherSites: string[];
}

/** Reads an exported file. Throws an Error with a readable message when it isn't one. */
export function parseExport(text: string): ParsedExport {
    let data: any;
    try {
        // trim() also drops the byte order mark some editors and clipboards add
        data = JSON.parse(text.trim());
    } catch {
        throw new Error("That isn't a GIFs+ export (not valid JSON).");
    }
    if (data?.format !== EXPORT_FORMAT || !Array.isArray(data.gifs)) {
        throw new Error("That isn't a GIFs+ export.");
    }
    if (data.version !== EXPORT_VERSION) {
        throw new Error("This export was made by a newer version of GIFs+. Update the plugin first.");
    }
    const gifs: ExportedGif[] = [];
    const other = new Map<string, number>();
    let skipped = 0;
    for (const g of data.gifs) {
        if (!isHttpsUrl(g?.url) || !isHttpsUrl(g?.src)) {
            skipped++;
            continue;
        }
        gifs.push({ url: g.url, src: g.src, width: optionalSize(g.width), height: optionalSize(g.height), format: optionalFormat(g.format) });
        for (const host of new Set([urlHost(g.url), urlHost(g.src)])) {
            if (!KNOWN_SITES.test(host)) other.set(host, (other.get(host) ?? 0) + 1);
        }
    }
    const otherSites = [...other].sort((a, b) => b[1] - a[1]).map(([host]) => host);
    return { format: EXPORT_FORMAT, version: EXPORT_VERSION, gifs, skipped, otherSites };
}

/**
 * The warning to confirm before importing GIFs from other sites, or null when
 * every GIF comes from a known one.
 */
export function otherSitesWarning(file: ParsedExport): string | null {
    const { otherSites } = file;
    if (!otherSites.length) return null;
    const shown = otherSites.slice(0, 5).join(", ");
    const more = otherSites.length > 5 ? ` and ${otherSites.length - 5} more` : "";
    return `Some GIFs in this file load from or link to other sites: ${shown}${more}. `
        + "A file from someone else could use that to see when you open the GIF picker, or to send a different link than the GIF shows. "
        + "Only import files you made yourself or trust.";
}

/**
 * Adds an export's GIFs to `gifs` (merge), or replaces them with it (overwrite).
 * GIFs that are already favourites keep their place. Returns how many were added.
 */
export function applyImport(gifs: FavoriteMap, file: ExportFile, mode: ImportMode) {
    if (mode === "overwrite") {
        for (const key of Object.keys(gifs)) delete gifs[key];
    }
    let order = nextOrder(gifs);
    let added = 0;
    // Keys without their signature (Discord drops attachment signatures), so each GIF is checked in O(1)
    const known = new Set(Object.keys(gifs).map(withoutSignature));
    // Oldest first, so the newest gets the highest order and is shown first
    for (const g of [...file.gifs].reverse()) {
        const plain = withoutSignature(g.url);
        if (known.has(plain)) continue;
        known.add(plain);
        gifs[g.url] = {
            src: g.src,
            format: g.format ?? GIF_TYPE_IMAGE,
            width: g.width ?? 0,
            height: g.height ?? 0,
            order: order++,
        };
        added++;
    }
    return added;
}

/** All favourites as export JSON, or null while they aren't loaded */
export function exportFavorites(backend: FavoritesBackend): string | null {
    const favorites = backend.read();
    return favorites ? formatExport(buildExport(favorites)) : null;
}

export interface ImportResult {
    /** GIFs that weren't favourites yet */
    added: number;
    /** Favourites after the import */
    total: number;
    /** Entries in the file that were left out (not https, not a GIF) */
    skipped: number;
}

/** "Imported 3 new GIFs (1 skipped). 120 favourites now." */
export function importSummary({ added, total, skipped }: ImportResult) {
    const gifs = (n: number) => `${n} GIF${n === 1 ? "" : "s"}`;
    return `Imported ${gifs(added)}${skipped ? ` (${skipped} skipped)` : ""}. ${gifs(total)} in favourites now.`;
}

/**
 * Imports a parsed export into favourites (parse it with `parseExport` first and
 * confirm `otherSitesWarning`). The import is applied inside Discord's update,
 * to the favourites as they are then, so a favourite that syncs in between isn't
 * lost. Rejects with a readable message on failure; nothing is changed then.
 */
export async function importFavorites(backend: FavoritesBackend, file: ParsedExport, mode: ImportMode): Promise<ImportResult> {
    if (!backend.read()) throw new Error("Your favourites haven't loaded yet. Open the GIF picker once and try again.");

    // Set by the update callback (an object, so TypeScript doesn't narrow it away)
    const out: { result?: ImportResult; tooBig: boolean; } = { tooBig: false };
    const applied = await backend.update(gifs => {
        out.result = undefined;
        out.tooBig = false;
        const added = applyImport(gifs, file, mode);
        if (favoritesBytes(backend, gifs) > FAVORITES_MAX_BYTES) {
            // Cancels the update, like Discord's add favourite over the limit
            out.tooBig = true;
            return false;
        }
        out.result = { added, total: Object.keys(gifs).length, skipped: file.skipped };
    });
    if (out.tooBig) throw new Error("That's more GIFs than Discord allows in favourites. Nothing was imported.");
    if (!applied || !out.result) throw new Error("Discord didn't apply the import. Nothing was imported.");
    return out.result;
}
