/*
 * Resolved posts, kept in an LRU with two ages: "fresh" (shown as is) and
 * "usable" (shown at once, then refreshed in the background, so stats update
 * without the card ever waiting). Loads for one key run once at a time.
 */

export interface CacheEntry<V> {
    value: V;
    /** Unix ms when the value was stored. */
    at: number;
}

export interface CachePolicy {
    /** Up to this age (ms) a value is fresh: no refresh. */
    freshFor: number;
    /** Up to this age (ms) a value is still shown while a refresh runs; older ones are dropped. */
    usableFor: number;
}

export interface CacheResult<V> {
    value: V;
    /** False when this is a stale value and a refresh was started. */
    fresh: boolean;
}

export class SwrCache<V> {
    private readonly map = new Map<string, CacheEntry<V>>();
    private readonly loading = new Map<string, Promise<V>>();
    private readonly max: number;
    private readonly policy: CachePolicy;
    private readonly now: () => number;
    /** Called after every change (for batched persisting). */
    onChange?: () => void;

    constructor(max: number, policy: CachePolicy, now: () => number = Date.now) {
        this.max = max;
        this.policy = policy;
        this.now = now;
    }

    get size() {
        return this.map.size;
    }

    /** The stored value if still usable, without starting anything. */
    peek(key: string): CacheResult<V> | undefined {
        const e = this.map.get(key);
        if (!e) return undefined;
        const age = this.now() - e.at;
        if (age > this.policy.usableFor) {
            this.map.delete(key);
            return undefined;
        }
        return { value: e.value, fresh: age <= this.policy.freshFor };
    }

    set(key: string, value: V, at = this.now()) {
        this.map.delete(key);
        this.map.set(key, { value, at });
        while (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
        this.onChange?.();
    }

    delete(key: string) {
        if (this.map.delete(key)) this.onChange?.();
    }

    clear() {
        this.map.clear();
        this.onChange?.();
    }

    /** Loads `key` (once, however many callers ask at the same time) and stores the result. */
    load(key: string, loader: () => Promise<V>): Promise<V> {
        const running = this.loading.get(key);
        if (running) return running;
        const p = loader()
            .then(v => {
                this.set(key, v);
                return v;
            })
            .finally(() => this.loading.delete(key));
        this.loading.set(key, p);
        return p;
    }

    /**
     * The value for `key`: a fresh one at once; a stale one at once plus a background refresh
     * (`onRefresh` gets the new value); nothing stored → waits for the load.
     */
    async get(key: string, loader: () => Promise<V>, onRefresh?: (v: V) => void): Promise<CacheResult<V>> {
        const hit = this.peek(key);
        if (hit) {
            // Refresh stale entries quietly; a failed refresh keeps the old value
            if (!hit.fresh) this.load(key, loader).then(v => onRefresh?.(v), () => { });
            this.touch(key);
            return hit;
        }
        return { value: await this.load(key, loader), fresh: true };
    }

    private touch(key: string) {
        const e = this.map.get(key);
        if (!e) return;
        this.map.delete(key);
        this.map.set(key, e);
    }

    /** Entries, oldest first, for saving. */
    entries(): [string, CacheEntry<V>][] {
        return [...this.map.entries()];
    }

    /** Restores saved entries under the ones already in memory (memory wins), dropping unusable ones. */
    restore(saved: [string, CacheEntry<V>][]) {
        const now = this.now();
        const current = [...this.map.entries()];
        this.map.clear();
        for (const [k, e] of saved) {
            if (e && typeof e.at === "number" && now - e.at <= this.policy.usableFor) this.map.set(k, e);
        }
        for (const [k, e] of current) {
            this.map.delete(k);
            this.map.set(k, e);
        }
        while (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
    }
}
