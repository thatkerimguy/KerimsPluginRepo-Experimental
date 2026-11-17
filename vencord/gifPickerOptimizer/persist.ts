/*
 * GIFs+ — saving in-memory data that survives a restart.
 * Shared between the Vencord and Valenced builds (keep both copies in sync).
 *
 * Every saved cache (seen / failed URLs, precached URLs, Klipy and Tenor lookups)
 * works the same way: load the saved copy once and merge it under what's known
 * already, save a while after a change, and never save before the saved copy was
 * read, because a save replaces it. `Persisted` does that for each of them.
 */

export interface PersistOptions<T> {
    /** Reads the saved copy (undefined when there is none) */
    load(): Promise<T | undefined> | T | undefined;
    /** Replaces the saved copy */
    save(value: T): void;
    /** Merges a loaded copy into memory. Not called for a load that `reset()` made stale. */
    apply(saved: T): void;
    /** What to save now */
    snapshot(): T;
    onError?(e: unknown): void;
    /** How long after a change to save (default 2 s) */
    delayMs?: number;
}

const SAVE_DELAY_MS = 2000;

export class Persisted<T> {
    /** Settles once the saved copy was read (or failed to) */
    readonly ready: Promise<void>;
    private loadDone = false;
    private dirty = false;
    private saveTimer: ReturnType<typeof setTimeout> | undefined;
    /** Bumped by `reset()` and `close()`, so a load that finishes afterwards doesn't bring old entries back */
    private generation = 0;
    private closed = false;

    constructor(private opts: PersistOptions<T>) {
        const { generation } = this;
        let loading: Promise<T | undefined>;
        try {
            loading = Promise.resolve(opts.load());
        } catch (e) {
            loading = Promise.reject(e);
        }
        this.ready = loading.then(saved => {
            if (generation === this.generation && saved != null) opts.apply(saved);
        }).catch(e => opts.onError?.(e)).finally(() => {
            this.loadDone = true;
            if (this.dirty) this.changed();
        });
    }

    /** Whether the saved copy was read */
    get isLoaded() {
        return this.loadDone;
    }

    /** Something changed: save soon (once the saved copy was read) */
    changed() {
        if (this.closed) return;
        this.dirty = true;
        if (this.saveTimer || !this.loadDone) return;
        this.saveTimer = setTimeout(() => this.flush(), this.opts.delayMs ?? SAVE_DELAY_MS);
    }

    /** Saves anything pending right away (call when the plugin stops) */
    flush() {
        clearTimeout(this.saveTimer);
        this.saveTimer = undefined;
        if (!this.loadDone || !this.dirty) return;
        this.dirty = false;
        try {
            this.opts.save(this.opts.snapshot());
        } catch (e) {
            this.opts.onError?.(e);
        }
    }

    /** Saves anything pending and stops: later changes and a load still in flight are ignored */
    close() {
        this.flush();
        this.generation++;
        this.closed = true;
        this.dirty = false;
    }

    /**
     * The data was cleared in memory: ignore a load still in flight and save
     * the (empty) snapshot now, replacing the saved copy.
     */
    reset() {
        this.generation++;
        this.loadDone = true;
        this.dirty = true;
        this.flush();
    }
}
