/*
 * GIFs+ — URL lists that are kept across Discord restarts.
 * Shared between the Vencord and Valenced builds (keep both copies in sync).
 *
 * The GIF files themselves stay in Discord's HTTP / native image cache, which
 * is on disk and survives a restart. What the plugin knew about them used to
 * be memory only, so after a restart every GIF waited in the load queue (with
 * a spinner) again, and broken previews were tried again. These lists are saved:
 *
 * - `seen`: GIFs that finished loading. Their tiles go first in the queue
 *   without a spinner, but still take a turn, because the cache may have
 *   evicted them since (it isn't readable from a page).
 * - `failed`: previews that didn't load, so they aren't tried again for a while.
 */

import { LruCache } from "./cache";
import { Persisted } from "./persist";

/** Where a list is saved: [url, when (ms)] from oldest to newest use */
export interface UrlListStore {
    load(): Promise<[string, number][] | undefined>;
    save(entries: [string, number][]): void;
}

/** A use refreshes a saved entry's time only when it's at least this old, so scrolling doesn't keep saving */
const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;

/** A set of URLs, each with when it was last used. Entries expire after `maxAgeMs`. */
export class SavedUrlSet {
    private urls: LruCache<string, number>;
    private saved: Persisted<[string, number][]> | undefined;
    /** Bumped when a URL is added, removed or the set is cleared (for memoized results that depend on it) */
    version = 0;

    constructor(max: number, private maxAgeMs: number, private now: () => number = Date.now) {
        this.urls = new LruCache(max);
    }

    get size() {
        return this.urls.size;
    }

    get max() {
        return this.urls.max;
    }

    /** Loads the saved list (merged under what's already known this session) and saves changes from now on */
    attach(store: UrlListStore) {
        this.detach();
        this.saved = new Persisted({
            load: () => store.load(),
            save: entries => store.save(entries),
            apply: entries => this.merge(entries),
            snapshot: () => [...this.urls.entries()],
        });
    }

    /** Saves anything pending and stops saving (the URLs stay known in memory) */
    detach() {
        this.saved?.close();
        this.saved = undefined;
    }

    has(url: string | null | undefined) {
        if (url == null) return false;
        const at = this.urls.get(url);
        if (at == null) return false;
        if (this.now() - at > this.maxAgeMs) {
            this.delete(url);
            return false;
        }
        return true;
    }

    add(url: string) {
        const now = this.now();
        const at = this.urls.get(url);
        if (at == null) this.version++;
        this.urls.set(url, now);
        if (at == null || now - at >= REFRESH_AFTER_MS) this.saved?.changed();
    }

    delete(url: string) {
        if (!this.urls.delete(url)) return false;
        this.version++;
        this.saved?.changed();
        return true;
    }

    /** Forgets every URL, also the saved ones */
    clear() {
        this.urls.clear();
        this.version++;
        this.saved?.reset();
    }

    approxBytes() {
        return this.urls.approxBytes();
    }

    /** Saves anything pending right away (call when the plugin stops) */
    flush() {
        this.saved?.flush();
    }

    /** Saved entries are older than this session's: they go first (least recently used) */
    private merge(entries: unknown) {
        if (!Array.isArray(entries)) return;
        const cutoff = this.now() - this.maxAgeMs;
        const saved = entries.filter((e): e is [string, number] =>
            Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "number" && e[1] >= cutoff);
        if (!saved.length) return;
        const current = [...this.urls.entries()];
        this.urls.clear();
        for (const [url, at] of saved) this.urls.set(url, at);
        for (const [url, at] of current) this.urls.set(url, at);
        this.version++;
    }
}
