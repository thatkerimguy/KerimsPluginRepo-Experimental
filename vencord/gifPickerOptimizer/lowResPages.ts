/*
 * GIFs+ — small previews for search and trending pages.
 * Shared between the Vencord and Valenced builds (keep both copies in sync).
 *
 * Klipy (Discord's GIF source) names every size differently, so a small URL can't
 * be worked out from the full one. Instead the same results page is asked for again
 * in a small media_format, at the same time as Discord's own request, and the small
 * URLs are kept by GIF (ApiPreviewCache). Tiles of those results wait for it (the
 * queue's `hold()`), at most LOW_RES_WAIT_MS.
 */

import { LruCache } from "./cache";
import { isKlipyUrl, lowResMediaFormat, normalizeUrl, type Quality } from "./lowres";
import { LOW_RES_REUSE_MS, LOW_RES_WAIT_MS } from "./tuning";

/** The fields that identify a GIF in Discord's GIF API results */
export interface GifRef {
    id?: string;
    url?: string;
}

/**
 * Low resolution URLs from Discord's GIF API, by quality and the GIF's id or
 * page URL. Only the current results page needs them: 1200 entries is about
 * 12 pages, since each result is stored under both keys.
 */
export class ApiPreviewCache {
    private cache = new LruCache<string, string>(1200);

    get size() {
        return this.cache.size;
    }

    has(quality: string, item: GifRef) {
        return this.cache.has(`${quality}:${item.id}`) || this.cache.has(`${quality}:${item.url}`);
    }

    get(quality: string, item: GifRef) {
        return this.cache.get(`${quality}:${item.id}`) ?? this.cache.get(`${quality}:${item.url}`);
    }

    /** Stores the results of a request made with a low resolution media_format */
    store(quality: string, results: (GifRef & { src?: string; })[]) {
        for (const r of results) {
            if (!r?.src) continue;
            const low = normalizeUrl(r.src);
            if (r.id != null) this.cache.set(`${quality}:${r.id}`, low);
            if (r.url != null) this.cache.set(`${quality}:${r.url}`, low);
        }
    }

    approxBytes() {
        return this.cache.approxBytes();
    }

    clear() {
        this.cache.clear();
    }
}

/** One low resolution request for a search or trending page */
export interface LowResRequest {
    /** The search query, or undefined for trending */
    query?: string;
    /** media_format to ask for */
    format: string;
    /** Same limit as Discord's request */
    limit?: number;
}

export interface LowResPrefetchOptions {
    /** media_format to ask for now, or null when no extra request is needed (quality, settings) */
    format(): string | null;
    /** Sends the request and stores its results. Rejects on failure. */
    request(req: LowResRequest): Promise<void>;
    onError?(e: unknown, req: LowResRequest): void;
    /** Discord debounces search requests by this much (250 ms) */
    debounceMs?: number;
}

interface PrefetchEntry {
    promise: Promise<void>;
    startedAt: number;
    settled: boolean;
    ok: boolean;
}

const MAX_PREFETCH_ENTRIES = 8;

/**
 * Starts the low resolution request for a search or trending page at the same
 * time as Discord's own request, instead of after Discord's results arrived.
 * When the results arrive, `pending()` says what's still in flight, so the load
 * queue only waits for that.
 */
export class LowResPrefetcher {
    private entries = new Map<string, PrefetchEntry>();
    private timer: ReturnType<typeof setTimeout> | undefined;

    constructor(private opts: LowResPrefetchOptions) { }

    private static key(query: string | undefined, format: string) {
        return query == null ? `trending|${format}` : `search|${format}|${query}`;
    }

    /**
     * Discord's search action was called. Discord sends its request 250 ms after
     * the last call (debounced) unless `immediate`, so this does the same. An empty
     * query only resets the picker; like Discord, it doesn't cancel a pending search.
     */
    search(query: string, limit?: number, immediate = false) {
        if (!query) return;
        clearTimeout(this.timer);
        this.timer = undefined;
        if (immediate) {
            this.start(query, limit);
            return;
        }
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.start(query, limit);
        }, this.opts.debounceMs ?? 250);
    }

    /** The media_format to ask for now, or null (also when working it out throws) */
    private currentFormat(): string | null {
        try {
            return this.opts.format();
        } catch {
            return null;
        }
    }

    /** Discord's request for `query` (undefined: trending) is starting now */
    start(query: string | undefined, limit?: number) {
        const format = this.currentFormat();
        if (!format) return;

        const key = LowResPrefetcher.key(query, format);
        const existing = this.entries.get(key);
        if (existing && (!existing.settled || (existing.ok && Date.now() - existing.startedAt < LOW_RES_REUSE_MS))) return;

        const req: LowResRequest = { query, format, limit };
        const entry: PrefetchEntry = { promise: Promise.resolve(), startedAt: Date.now(), settled: false, ok: false };
        let run: Promise<void>;
        try {
            run = Promise.resolve(this.opts.request(req));
        } catch (e) {
            run = Promise.reject(e);
        }
        entry.promise = run.then(
            () => {
                entry.ok = true;
            },
            e => this.opts.onError?.(e, req),
        ).finally(() => {
            entry.settled = true;
        });

        this.entries.delete(key);
        this.entries.set(key, entry);
        while (this.entries.size > MAX_PREFETCH_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
    }

    /**
     * Discord's results for `query` (undefined: trending) arrived. Returns the
     * request started for them: `wait` resolves once it settled (undefined when it
     * already has), `runningMs` is how long it has been running. Null when none was
     * started, or it failed: then the caller asks on its own (the old way).
     */
    pending(query: string | undefined): { wait?: Promise<void>; runningMs: number; } | null {
        const format = this.currentFormat();
        if (!format) return null;
        const entry = this.entries.get(LowResPrefetcher.key(query, format));
        if (!entry || (entry.settled && !entry.ok)) return null;
        return { wait: entry.settled ? undefined : entry.promise, runningMs: Date.now() - entry.startedAt };
    }

    clear() {
        clearTimeout(this.timer);
        this.timer = undefined;
        this.entries.clear();
    }
}

/** What each build gives `LowResPages`: its settings, Discord's API and the load queue */
export interface LowResPagesOptions {
    quality(): Quality;
    /** Small search / trending previews are wanted (setting) and Discord's API can be reached */
    enabled(): boolean;
    /** The media_format Discord's picker asks for */
    selectedFormat(): string;
    locale(): string | undefined;
    /** GET on Discord's API. Resolves the response body. */
    get(url: string, query: Record<string, unknown>): Promise<unknown>;
    previews: ApiPreviewCache;
    /** Holds the load queue's Klipy search tiles for up to `ms`. Returns the release. */
    hold(ms: number): () => void;
    warn(message: string, e: unknown): void;
}

/**
 * Small previews for search and trending results. Klipy URLs can't be rewritten,
 * so the same page is asked for again in a small media_format, normally at the
 * same time as Discord's own request (`search` / `started`, from patches).
 */
export class LowResPages {
    private prefetcher: LowResPrefetcher;

    constructor(private o: LowResPagesOptions) {
        this.prefetcher = new LowResPrefetcher({
            format: () => this.format(),
            request: req => this.request(req),
            onError: (e, req) => o.warn(`Couldn't fetch low resolution Klipy previews (media_format=${req.format})`, e),
        });
    }

    /** media_format for small previews, or null when no extra request is needed */
    format(): string | null {
        const q = this.o.quality();
        if (q === "original" || !this.o.enabled()) return null;
        return lowResMediaFormat(this.o.selectedFormat(), q);
    }

    /** Asks for a search or trending page in a small media_format and keeps the URLs */
    private async request({ query, format, limit }: LowResRequest) {
        const q = this.o.quality();
        const isSearch = typeof query === "string";
        const lang = this.o.locale();
        const body = await this.o.get(isSearch ? "/gifs/search" : "/gifs/trending-gifs", {
            ...(isSearch ? { q: query } : {}),
            media_format: format,
            ...(lang ? { locale: lang } : {}),
            ...(limit != null ? { limit } : {}),
        });
        this.o.previews.store(q, Array.isArray(body) ? body : []);
    }

    /** Discord's search action was called (Discord debounces it 250 ms unless `immediate`) */
    search(query: string, limit?: number, immediate = false) {
        this.prefetcher.search(query, limit, immediate);
    }

    /** Discord's search (query) or trending (undefined) request starts now */
    started(query: string | undefined, limit?: number) {
        this.prefetcher.start(query, limit);
    }

    /**
     * Discord's results for a page arrived. The small request normally started
     * with Discord's, so the queue only waits for what's still in flight. If it
     * wasn't started (a patch didn't apply), it's sent now and the queue waits.
     */
    async arrived(event: { query?: string; items?: (GifRef & { src?: string; })[]; }) {
        const format = this.format();
        if (!format) return;
        const q = this.o.quality();
        const items = event.items ?? [];
        if (!items.some(i => i?.src && isKlipyUrl(i.src) && !this.o.previews.has(q, i))) return;

        const query = typeof event.query === "string" ? event.query : undefined;
        const early = this.prefetcher.pending(query);
        if (early) {
            const left = LOW_RES_WAIT_MS - early.runningMs;
            if (early.wait && left > 0) early.wait.finally(this.o.hold(left));
            return;
        }

        // Hold the Klipy tiles so they don't start loading the full size file meanwhile
        const release = this.o.hold(LOW_RES_WAIT_MS);
        try {
            await this.request({ query, format, limit: items.length });
        } catch (e) {
            this.o.warn(`Couldn't fetch low resolution Klipy previews (media_format=${format})`, e);
        } finally {
            release();
        }
    }

    clear() {
        this.prefetcher.clear();
    }
}
