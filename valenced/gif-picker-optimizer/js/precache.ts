/*
 * GIFs+ — precaching favourites.
 * Shared between the Vencord and Valenced builds (keep both copies in sync).
 *
 * Downloads the previews the picker would show into the HTTP / native image
 * cache ahead of time. Downloaded URLs are remembered (and saved), and their
 * tiles go first in the load queue without a spinner. They still take a turn:
 * the browser (or Fresco on mobile) may have evicted them since, and then they
 * download like any other GIF instead of all at once.
 */

import { LruCache } from "./cache";

/** A GIF to precache: resolves the URL its tile shows (some need a lookup first) */
export type PrecacheJob = () => Promise<string | null> | string | null;

export interface PrecacheProgress {
    /** What's being precached, e.g. "Favorites" */
    label: string;
    done: number;
    failed: number;
    total: number;
}

export interface PrecacheOptions {
    /** Downloads `url`. Resolves whether it worked. */
    fetch(url: string): Promise<boolean>;
    load(): Promise<string[] | undefined>;
    save(urls: string[]): void;
}

const MAX_ENTRIES = 20_000;
const CONCURRENCY = 3;
const SAVE_DELAY_MS = 2000;
/** Progress updates are sent at most this often (one per GIF re-rendered every listener) */
const NOTIFY_INTERVAL_MS = 250;

export class Precacher {
    /** Precached URL -> when (0 for ones loaded from the saved list) */
    private urls = new LruCache<string, number>(MAX_ENTRIES);
    private listeners = new Set<() => void>();
    private current: { cancelled: boolean; } | null = null;
    private saveTimer: ReturnType<typeof setTimeout> | undefined;
    private notifyTimer: ReturnType<typeof setTimeout> | undefined;
    /** Saving replaces the saved list, so it waits until the list was read */
    private loadDone = false;
    private dirty = false;
    /** Bumped by `clear()`, so a load that finishes afterwards doesn't bring old entries back */
    private generation = 0;
    /** The run in progress, if any */
    progress: PrecacheProgress | null = null;
    /** Bumped whenever the set of precached URLs changes */
    version = 0;

    constructor(private opts: PrecacheOptions) {
        const { generation } = this;
        opts.load().then(urls => {
            if (generation !== this.generation) return;
            for (const url of urls ?? []) {
                if (typeof url === "string" && !this.urls.has(url)) this.urls.set(url, 0);
            }
            this.version++;
            this.notify();
        }, () => { }).finally(() => {
            this.loadDone = true;
            if (this.dirty) this.scheduleSave();
        });
    }

    get size() {
        return this.urls.size;
    }

    has(url: string | null | undefined) {
        return url != null && this.urls.has(url);
    }

    /** How many of `urls` are precached */
    count(urls: (string | null | undefined)[]) {
        let n = 0;
        for (const url of urls) if (this.has(url)) n++;
        return n;
    }

    subscribe(listener: () => void) {
        this.listeners.add(listener);
        return () => void this.listeners.delete(listener);
    }

    /** Precaches `jobs`, a few at a time. A run already in progress is cancelled. */
    async start(label: string, jobs: PrecacheJob[]): Promise<PrecacheProgress> {
        this.cancel();
        const run = { cancelled: false };
        const progress: PrecacheProgress = { label, done: 0, failed: 0, total: jobs.length };
        this.current = run;
        this.progress = progress;
        this.notify();

        let next = 0;
        const worker = async () => {
            while (!run.cancelled && next < jobs.length) {
                const job = jobs[next++];
                let ok = false;
                try {
                    const url = await job();
                    ok = !!url && (this.urls.has(url) || await this.opts.fetch(url));
                    if (ok && url) this.mark(url);
                } catch { }
                if (run.cancelled) return;
                progress.done++;
                if (!ok) progress.failed++;
                this.notifySoon();
            }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));

        if (this.current === run) {
            this.current = null;
            this.progress = null;
            this.notify();
        }
        return progress;
    }

    cancel() {
        if (!this.current) return;
        this.current.cancelled = true;
        this.current = null;
        this.progress = null;
        this.notify();
    }

    mark(url: string) {
        if (!this.urls.has(url)) this.version++;
        this.urls.set(url, Date.now());
        this.scheduleSave();
    }

    /** A precached URL that didn't load after all (gone, or its preview fails) */
    forget(url: string) {
        if (!this.urls.delete(url)) return;
        this.version++;
        this.scheduleSave();
    }

    approxBytes() {
        return this.urls.approxBytes();
    }

    /** Forgets every precached URL, also the saved ones */
    clear() {
        this.generation++;
        this.loadDone = true;
        this.cancel();
        this.urls.clear();
        this.version++;
        this.dirty = true;
        this.flush();
        this.notify();
    }

    /** Saves anything pending right away (call when the plugin stops) */
    flush() {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = undefined;
        if (!this.loadDone || !this.dirty) return;
        this.dirty = false;
        try {
            this.opts.save([...this.urls.entries()].map(([url]) => url));
        } catch { }
    }

    /** Stops a run in progress and saves. The precacher can't be used afterwards. */
    stop() {
        this.cancel();
        this.flush();
        clearTimeout(this.notifyTimer);
        this.notifyTimer = undefined;
        this.listeners.clear();
    }

    private scheduleSave() {
        this.dirty = true;
        if (this.saveTimer || !this.loadDone) return;
        this.saveTimer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
    }

    /** Tells listeners now (and drops a pending throttled update) */
    private notify() {
        clearTimeout(this.notifyTimer);
        this.notifyTimer = undefined;
        for (const listener of [...this.listeners]) listener();
    }

    /** Tells listeners within NOTIFY_INTERVAL_MS, at most once per interval */
    private notifySoon() {
        if (this.notifyTimer) return;
        this.notifyTimer = setTimeout(() => this.notify(), NOTIFY_INTERVAL_MS);
    }
}
