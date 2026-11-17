/*
 * Discord mobile shows Tenor favourites as `<tenor page URL>.gif`, which redirects
 * to the full size GIF. The saved favourite's src normally holds the media URL
 * already (`tenorMediaFromSrc` in previews.ts), so this is only the fallback when
 * it doesn't: following the redirect once (HEAD, cached and saved) gives the
 * media URL, and from that Tenor's small renditions.
 */

import { LruCache } from "./cache";
import { wait } from "./klipy";
import { isTenorMediaUrl, normalizeUrl } from "./lowres";
import { Persisted } from "./persist";
import { runtime } from "./state";

const MAX_ENTRIES = 5000;
const MAX_FAILED_ENTRIES = 500;
const REQUEST_TIMEOUT_MS = 8000;
/** A failed lookup is tried again after this long */
const RETRY_AFTER_MS = 5 * 60_000;

interface TenorStore {
    load(): Promise<Record<string, string> | undefined>;
    save(entries: Record<string, string>): void;
}

export class TenorPageResolver {
    /** Bumped whenever a page is resolved or the cache is cleared (for memoized URL lists) */
    version = 0;
    /** page URL -> media URL, or "" when the redirect didn't lead to a Tenor media URL */
    private cache = new LruCache<string, string>(MAX_ENTRIES);
    private pending = new Map<string, Promise<void>>();
    /** page URL -> when its lookup last failed (network error, timeout or error response). Not saved. */
    private failedAt = new LruCache<string, number>(MAX_FAILED_ENTRIES);
    private saved: Persisted<Record<string, string>>;

    constructor(store?: TenorStore) {
        this.saved = new Persisted({
            load: () => store?.load(),
            save: entries => store?.save(entries),
            apply: entries => {
                if (typeof entries !== "object") return;
                for (const [k, v] of Object.entries(entries)) {
                    if (typeof v === "string" && !this.cache.has(k)) this.cache.set(k, v);
                }
                this.version++;
            },
            snapshot: () => Object.fromEntries(this.cache.entries()),
        });
    }

    /** Media URL, "" when unknown for good, undefined when not resolved yet */
    peek(pageUrl: string) {
        return this.cache.get(pageUrl);
    }

    /** Whether the last lookup of `pageUrl` failed recently */
    recentlyFailed(pageUrl: string) {
        const at = this.failedAt.get(pageUrl);
        return at != null && Date.now() - at < RETRY_AFTER_MS;
    }

    resolve(pageUrl: string): Promise<void> {
        if (this.cache.has(pageUrl) || this.recentlyFailed(pageUrl)) return Promise.resolve();
        const existing = this.pending.get(pageUrl);
        if (existing) return existing;

        const run = this.lookup(pageUrl).finally(() => this.pending.delete(pageUrl));
        this.pending.set(pageUrl, run);
        return run;
    }

    private async lookup(pageUrl: string) {
        try {
            const res = await Promise.race([
                fetch(pageUrl, { method: "HEAD" }),
                wait(REQUEST_TIMEOUT_MS).then(() => null),
            ]);
            if (!res?.ok) {
                // Timed out, rate limited or a server error: try again later,
                // don't save it as "no small version"
                this.failedAt.set(pageUrl, Date.now());
                return;
            }
            const media = normalizeUrl(res.url ?? "");
            this.cache.set(pageUrl, isTenorMediaUrl(media) ? media : "");
            this.version++;
            this.saved.changed();
        } catch (e) {
            this.failedAt.set(pageUrl, Date.now());
            runtime.logger?.warn?.("Couldn't resolve Tenor favourite", e);
        }
    }

    stats() {
        return { saved: this.cache.size, bytes: this.cache.approxBytes() + this.failedAt.approxBytes() };
    }

    /** Forgets every resolved page, also the saved ones */
    clear() {
        this.cache.clear();
        this.failedAt.clear();
        this.version++;
        this.saved.reset();
    }

    /** Saves anything pending right away */
    flush() {
        this.saved.flush();
    }

    /** Saves anything pending and stops saving (call when the plugin stops) */
    stop() {
        this.saved.close();
    }
}
