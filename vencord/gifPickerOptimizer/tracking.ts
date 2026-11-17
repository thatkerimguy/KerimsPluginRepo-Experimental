/*
 * GIFs+ — the load queue and what the plugin remembers about GIFs (loaded this
 * session, seen in earlier ones, failed previews), with the helpers tiles use.
 * Shared between the Vencord and Valenced builds (keep both copies in sync).
 */

import { LoadedCache } from "./cache";
import { ApiPreviewCache } from "./lowResPages";
import { LoadQueue, type Ticket } from "./queue";
import { SavedUrlSet } from "./saved";
import type { TileEnv } from "./tileLoader";
import { FAILED_MAX, FAILED_MAX_AGE_MS, SEEN_MAX, SEEN_MAX_AGE_MS } from "./tuning";

export interface TrackingOptions {
    /** How many loaded URLs `loadedThisSession` remembers at first (the cache size setting) */
    loadedSize: number;
    /** Other saved caches to save with the lists in `flushSaved` (Klipy, Tenor) */
    savedCaches(): ({ flush(): void; } | undefined)[];
    onError(message: string, e: unknown): void;
    /** A tile will load `url` soon (desktop: preconnect to its host) */
    warmUp?(url: string): void;
}

export function createTracking(o: TrackingOptions) {
    const queue = new LoadQueue();
    /** URLs that finished loading. Scrolled-back tiles with a cached URL skip the queue. */
    const loadedThisSession = new LoadedCache(o.loadedSize);
    /**
     * GIFs that finished loading, saved across restarts. After a restart their tiles
     * go first in the queue without a spinner, since the files are probably still in
     * the HTTP / native image cache.
     */
    const seen = new SavedUrlSet(SEEN_MAX, SEEN_MAX_AGE_MS);
    /** Preview URLs that failed, saved for a week so they aren't tried again after a restart */
    const failed = new SavedUrlSet(FAILED_MAX, FAILED_MAX_AGE_MS);
    /** Low resolution URLs for search and trending results, from Discord's GIF API */
    const apiPreviews = new ApiPreviewCache();
    /** Tickets that were cancelled; a lookup that finishes later must not start them */
    const dropped = new WeakSet<Ticket>();

    /** Whether `url` loaded recently, so its tile shows it at once without a turn in the queue */
    const isLoadedThisSession = (url: string | null | undefined) => loadedThisSession.hit(url);

    /** Remembers that `url` finished loading (this session, and saved for later ones) */
    const markLoaded = (url: string) => {
        loadedThisSession.mark(url);
        seen.add(url);
        // It works again
        failed.delete(url);
    };

    /** Forgets `url` everywhere after it failed to load */
    const forgetLoaded = (url: string) => {
        loadedThisSession.delete(url);
        seen.delete(url);
    };

    /**
     * Whether `url` loaded in an earlier session. Its tile goes first in the queue
     * without a spinner, but still takes a turn: the browser (or Fresco) may have
     * evicted it from its cache since.
     */
    const isSeenBefore = (url: string | null | undefined) => seen.has(url);

    const drop = (ticket: Ticket | null) => {
        if (!ticket) return;
        dropped.add(ticket);
        queue.cancel(ticket);
    };
    const isDropped = (ticket: Ticket) => dropped.has(ticket);

    /** What the shared tile loader (tileLoader.ts) works with */
    const tileEnv: TileEnv = {
        queue,
        isLoadedThisSession,
        isSeenBefore,
        markLoaded,
        markFailed(url) {
            failed.add(url);
            forgetLoaded(url);
        },
        forgetLoaded,
        failedBefore: url => failed.has(url),
        warmUp: o.warmUp,
        drop,
        isDropped,
        onError: o.onError,
    };

    /** Saves anything pending in the saved lists right away (Discord closing or in the background) */
    const flushSaved = () => {
        seen.flush();
        failed.flush();
        for (const cache of o.savedCaches()) cache?.flush();
    };

    return {
        queue, loadedThisSession, seen, failed, apiPreviews,
        isLoadedThisSession, isSeenBefore, markLoaded, forgetLoaded, drop, isDropped, tileEnv, flushSaved,
    };
}
