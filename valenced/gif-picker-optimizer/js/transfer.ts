/*
 * GIFs+ — Discord's GIF favourites, and exporting / importing them between accounts.
 * Shared between the Vencord and Valenced builds (keep both copies in sync).
 */

/** A favourite as Discord saves it (frecency settings, `favoriteGifs.gifs[url]`) */
export interface FavoriteEntry {
    src: string;
    format?: number;
    width?: number;
    height?: number;
    order?: number;
}

/** Favourites by page URL (the URL that's sent) */
export type FavoriteMap = Record<string, FavoriteEntry>;

export type ImportMode = "merge" | "overwrite";

/** Discord refuses favourites larger than this (the FavoriteGIFs protobuf, in bytes) */
export const FAVORITES_MAX_BYTES = 762_880;
/** GIFType.IMAGE in Discord's frecency protobuf */
const GIF_TYPE_IMAGE = 1;

const EXPORT_FORMAT = "gifs-plus";
const EXPORT_VERSION = 1;

/** Discord's favourites, as each build reaches them */
export interface FavoritesBackend {
    /** Current favourites, or undefined while they aren't loaded */
    read(): FavoriteMap | undefined;
    /**
     * Changes favourites (saved and synced by Discord). `fn` gets the favourites as
     * they are when Discord applies the update (a favourite that synced in the
     * meantime is in there). Return false from `fn` to cancel, like Discord's own
     * add favourite does. Resolves after `fn` ran: true when the change was applied.
     */
    update(fn: (gifs: FavoriteMap) => boolean | void): Promise<boolean>;
    /** Exact protobuf size of `gifs` in bytes, when the build can measure it */
    bytes?(gifs: FavoriteMap): number | undefined;
}

/** A protobuf-ts message type (only what's used here) */
interface ProtoType {
    fields?: { name?: string; localName?: string; kind?: string; T?: () => unknown; }[];
    create?(value?: object): object;
    toBinary?(message: object): { length: number; };
}

/**
 * Size of `gifs` as Discord encodes it (`FavoriteGIFs.toBinary(...).length`, the
 * check Discord's add favourite does), found through the frecency settings'
 * `ProtoClass`. Undefined when the proto can't be found or encoding fails.
 */
export function protoBytes(frecencyProto: unknown, gifs: FavoriteMap): number | undefined {
    try {
        const field = (frecencyProto as ProtoType | undefined)?.fields?.find(f => f?.localName === "favoriteGifs" || f?.name === "favorite_gifs");
        const type = field?.kind === "message" ? field.T?.() as ProtoType | undefined : undefined;
        if (typeof type?.toBinary !== "function" || typeof type.create !== "function") return undefined;
        const n = type.toBinary(type.create({ gifs })).length;
        return typeof n === "number" && n >= 0 ? n : undefined;
    } catch {
        return undefined;
    }
}

/** Size of `gifs` in bytes: exact when the backend can measure it, else estimated */
export function favoritesBytes(backend: Pick<FavoritesBackend, "bytes">, gifs: FavoriteMap) {
    let exact: number | undefined;
    try {
        exact = backend.bytes?.(gifs);
    } catch { }
    return typeof exact === "number" && exact >= 0 ? exact : estimateBytes(gifs);
}

/** A Discord attachment URL without its expiring signature (ex, is, hm) */
function withoutSignature(url: string) {
    const q = url.indexOf("?");
    if (q === -1) return url;
    const kept = url.slice(q + 1).split("&").filter(p => p && !/^(ex|is|hm)=/.test(p));
    return kept.length ? `${url.slice(0, q)}?${kept.join("&")}` : url.slice(0, q);
}

/** The key `url` is saved under in favourites (Discord drops attachment signatures) */
export function findKey(gifs: FavoriteMap, url: string): string | undefined {
    if (url in gifs) return url;
    const plain = withoutSignature(url);
    if (plain in gifs) return plain;
    return Object.keys(gifs).find(k => withoutSignature(k) === plain);
}

export function nextOrder(gifs: FavoriteMap) {
    let max = 0;
    for (const entry of Object.values(gifs)) {
        if ((entry?.order ?? 0) > max) max = entry.order!;
    }
    return max + 1;
}

/** Rough protobuf size of the favourites (a bit over), when the real size can't be measured */
export function estimateBytes(gifs: FavoriteMap) {
    let n = 0;
    for (const [url, entry] of Object.entries(gifs)) n += url.length + (entry?.src?.length ?? 0) + 20;
    return n;
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

const isHttpUrl = (v: unknown): v is string => typeof v === "string" && /^(https?:)?\/\//i.test(v);
const optionalNumber = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);

/** Reads an exported file. Throws an Error with a readable message when it isn't one. */
export function parseExport(text: string): ExportFile {
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
    for (const g of data.gifs) {
        if (!isHttpUrl(g?.url) || !isHttpUrl(g?.src)) continue;
        gifs.push({ url: g.url, src: g.src, width: optionalNumber(g.width), height: optionalNumber(g.height), format: optionalNumber(g.format) });
    }
    return { format: EXPORT_FORMAT, version: EXPORT_VERSION, gifs };
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
    // Keys without their signature, so each GIF is checked in O(1) (what `findKey` matches)
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
}

/**
 * Imports an export into favourites. The import is applied inside Discord's update,
 * to the favourites as they are then, so a favourite that syncs in between isn't
 * lost. Rejects with a readable message on failure; nothing is changed then.
 */
export async function importFavorites(backend: FavoritesBackend, text: string, mode: ImportMode): Promise<ImportResult> {
    // Thrown before anything is touched
    const file = parseExport(text);
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
        out.result = { added, total: Object.keys(gifs).length };
    });
    if (out.tooBig) throw new Error("That's more GIFs than Discord allows in favourites. Nothing was imported.");
    if (!applied || !out.result) throw new Error("Discord didn't apply the import. Nothing was imported.");
    return out.result;
}
