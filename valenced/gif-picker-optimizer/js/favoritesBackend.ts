/*
 * GIFs+ — Discord's GIF favourites (saved and synced through its frecency settings),
 * and how big they are (Discord refuses favourites over FAVORITES_MAX_BYTES).
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

/** Discord refuses favourites larger than this (the FavoriteGIFs protobuf, in bytes) */
export const FAVORITES_MAX_BYTES = 762_880;
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

/** Discord's frecency settings actions (favourites are saved and synced through these) */
export interface FrecencyActions {
    getCurrentValue?(): { favoriteGifs?: { gifs?: FavoriteMap; }; } | undefined;
    updateAsync?(key: "favoriteGifs", updater: (value: { gifs?: FavoriteMap; }) => unknown, delay: number): Promise<unknown>;
    /** The FrecencyUserSettings protobuf type (for the exact favourites size) */
    ProtoClass?: unknown;
}

/** UserSettingsDelay.INFREQUENT_USER_ACTION: save right away, like the favourite button */
const SAVE_DELAY = 0;

/**
 * Discord's favourites through its frecency settings actions (found differently
 * by each build). `onMissing` is told when they can't be reached yet.
 */
export function createFavoritesBackend(actions: () => FrecencyActions | undefined, onMissing?: () => void): FavoritesBackend {
    return {
        read: () => actions()?.getCurrentValue?.()?.favoriteGifs?.gifs,
        async update(fn) {
            const frecency = actions();
            if (typeof frecency?.updateAsync !== "function") {
                onMissing?.();
                return false;
            }
            let applied = false;
            // updateAsync awaits loading, then calls the updater with a copy of the current
            // favourites, and resolves after it ran (checked in Discord's desktop code, 2026-11;
            // assumed the same on mobile)
            await frecency.updateAsync("favoriteGifs", favorites => {
                favorites.gifs ??= {};
                // Returning false cancels the update
                if (fn(favorites.gifs) === false) return false;
                applied = true;
            }, SAVE_DELAY);
            return applied;
        },
        // FavoriteGIFs.toBinary(...).length, the check Discord's add favourite does
        bytes: gifs => protoBytes(actions()?.ProtoClass, gifs),
    };
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

/** Rough protobuf size of the favourites (a bit over), when the real size can't be measured */
export function estimateBytes(gifs: FavoriteMap) {
    let n = 0;
    for (const [url, entry] of Object.entries(gifs)) n += url.length + (entry?.src?.length ?? 0) + 20;
    return n;
}
