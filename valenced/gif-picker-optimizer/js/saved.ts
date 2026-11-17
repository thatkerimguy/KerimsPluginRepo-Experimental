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

/** Where a list is saved: [url, when (ms)] from oldest to newest use */
export interface UrlListStore {
    load(): Promise<[string, number][] | undefined>;
    save(entries: [string, number][]): void;
}

const SAVE_DELAY_MS = 2000;
/** A use refreshes a saved entry's time only when it's at least this old, so scrolling doesn't keep saving */
const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;

/** A set of URLs, each with when it was last used. Entries expire after `maxAgeMs`. */
export class SavedUrlSet {
    private urls: LruCache<string, number>;
    private store: UrlListStore | undefined;
    private saveTimer: ReturnType<typeof setTimeout> | undefined;
    /** Saving replaces the saved list, so it waits until the list was read */
    private loadDone = true;
    private dirty = false;
    /** Bumped by `attach`, `detach` and `clear`, so a load that finishes later is ignored */
    private generation = 0;
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
        this.store = store;
        this.loadDone = false;
        const generation = ++this.generation;
        let loading: Promise<[string, number][] | undefined>;
        try {
            loading = Promise.resolve(store.load());
        } catch {
            loading = Promise.resolve(undefined);
        }
        loading.then(entries => {
            if (generation !== this.generation || !Array.isArray(entries)) return;
            const cutoff = this.now() - this.maxAgeMs;
            const saved = entries.filter(e => Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "number" && e[1] >= cutoff);
            if (!saved.length) return;
            // Saved entries are older than this session's: put them first (least recently used)
            const current = [...this.urls.entries()];
            this.urls.clear();
            for (const [url, at] of saved) this.urls.set(url, at);
            for (const [url, at] of current) this.urls.set(url, at);
            this.version++;
        }, () => { }).finally(() => {
            if (generation !== this.generation) return;
            this.loadDone = true;
            if (this.dirty) this.scheduleSave();
        });
    }

    /** Saves anything pending and stops saving (the URLs stay known in memory) */
    detach() {
        this.flush();
        this.generation++;
        this.store = undefined;
        this.loadDone = true;
        this.dirty = false;
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
        if (at == null || now - at >= REFRESH_AFTER_MS) this.scheduleSave();
    }

    delete(url: string) {
        if (!this.urls.delete(url)) return false;
        this.version++;
        this.scheduleSave();
        return true;
    }

    /** Forgets every URL, also the saved ones */
    clear() {
        this.generation++;
        this.loadDone = true;
        this.urls.clear();
        this.version++;
        this.dirty = true;
        this.flush();
    }

    approxBytes() {
        return this.urls.approxBytes();
    }

    /** Saves anything pending right away (call when the plugin stops) */
    flush() {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = undefined;
        if (!this.store || !this.loadDone || !this.dirty) return;
        this.dirty = false;
        try {
            this.store.save([...this.urls.entries()]);
        } catch { }
    }

    private scheduleSave() {
        this.dirty = true;
        if (!this.store || this.saveTimer || !this.loadDone) return;
        this.saveTimer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
    }
}
