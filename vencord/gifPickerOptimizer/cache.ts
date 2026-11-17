/*
 * GIFs+ — caches.
 * Shared between the Vencord and Valenced builds (keep both copies in sync).
 *
 * Discord unmounts tiles that scroll away. When they scroll back, these caches
 * let them show again at once: a URL that finished loading before skips the load
 * queue and is served from the HTTP / native image cache instead of downloading again.
 */

/**
 * Least recently used map. `get` and `set` both count as a use.
 *
 * `max` limits the number of entries, or, when `weigh` is given, their total
 * weight (for example bytes). The newest entry is always kept, even if it alone
 * is over the limit.
 */
export class LruCache<K, V> {
    private map = new Map<K, V>();
    private total = 0;

    constructor(
        public max: number,
        private onEvict?: (key: K, value: V) => void,
        private weigh?: (value: V) => number,
    ) { }

    get size() {
        return this.map.size;
    }

    /** Total weight of the entries (their count without `weigh`) */
    get weight() {
        return this.weigh ? this.total : this.map.size;
    }

    has(key: K) {
        return this.map.has(key);
    }

    get(key: K): V | undefined {
        if (!this.map.has(key)) return undefined;
        const value = this.map.get(key)!;
        this.map.delete(key);
        this.map.set(key, value);
        return value;
    }

    set(key: K, value: V) {
        if (this.map.has(key)) {
            const old = this.map.get(key)!;
            this.map.delete(key);
            this.total -= this.weightOf(old);
            if (old !== value) this.onEvict?.(key, old);
        }
        this.map.set(key, value);
        this.total += this.weightOf(value);
        this.trim();
    }

    delete(key: K) {
        if (!this.map.has(key)) return false;
        const value = this.map.get(key)!;
        this.map.delete(key);
        this.total -= this.weightOf(value);
        this.onEvict?.(key, value);
        return true;
    }

    /** Entries from oldest to newest use. Doesn't count as a use. */
    entries() {
        return this.map.entries();
    }

    /** Rough memory used by the keys and values (for the cache stats in settings) */
    approxBytes() {
        let n = 0;
        for (const [k, v] of this.map) n += approxSize(k) + approxSize(v) + ENTRY_OVERHEAD_BYTES;
        return n;
    }

    /** Changes the limit, evicting the oldest entries if needed */
    resize(max: number) {
        this.max = max;
        this.trim();
    }

    clear() {
        const entries = [...this.map];
        this.map.clear();
        this.total = 0;
        for (const [k, v] of entries) this.onEvict?.(k, v);
    }

    private weightOf(value: V) {
        return this.weigh ? Math.max(0, this.weigh(value) || 0) : 1;
    }

    private trim() {
        const max = Math.max(0, this.max | 0);
        while (this.map.size > 1 && this.weight > max) {
            const [key, value] = this.map.entries().next().value as [K, V];
            this.map.delete(key);
            this.total -= this.weightOf(value);
            this.onEvict?.(key, value);
        }
    }
}

/**
 * Per-entry overhead of a Map entry with two small heap objects, measured in
 * Bun with realistic GIF URLs (about 200 bytes besides the strings themselves).
 */
const ENTRY_OVERHEAD_BYTES = 200;

/** Rough size of a cached key or value. Strings of URLs are 1 byte per character. */
export function approxSize(v: unknown): number {
    if (typeof v === "string") return v.length;
    if (typeof v === "number") return 8;
    return 0;
}

/** "12 KB", "3.4 MB" */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * URLs that finished loading, with when they did (ms). Remembering them lets a
 * tile that comes back on screen skip the queue. Bounded, so huge favourite
 * libraries don't grow it forever. Values are plain numbers to keep entries small.
 */
export class LoadedCache extends LruCache<string, number> {
    mark(url: string) {
        this.set(url, Date.now());
    }

    /** Whether `url` loaded before. Counts as a use, keeping it cached longer. */
    hit(url: string | null | undefined) {
        return url != null && this.get(url) != null;
    }
}
