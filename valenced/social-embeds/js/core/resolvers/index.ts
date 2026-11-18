/*
 * One entry point for the cards: PostRef → Thread, through the cache, with
 * short links resolved and the per-platform kill switch applied.
 */

import { SwrCache } from "../cache";
import { parseLink, refKey } from "../detect";
import type { HttpClient } from "../fetcher";
import { NotFoundError } from "../fetcher";
import { Health } from "../health";
import type { Platform, PostRef, Thread } from "../model";
import { resolveReddit } from "./reddit";
import { resolveX } from "./x";

/** Platforms with a resolver so far (TikTok: phase 3, Instagram: phase 4). */
export const SUPPORTED: ReadonlySet<Platform> = new Set<Platform>(["x", "reddit"]);

export const CACHE_POLICY = {
    /** Counts refresh after this. */
    freshFor: 10 * 60_000,
    /** Shown at once (then refreshed) up to this age. */
    usableFor: 7 * 24 * 60 * 60_000,
};

export interface Resolver {
    readonly cache: SwrCache<Thread>;
    readonly health: Health;
    /** Whether cards should be made for this ref at all. */
    handles(ref: PostRef): boolean;
    /** The thread now if cached and fresh enough to show (no I/O). */
    peek(ref: PostRef): Thread | undefined;
    /**
     * Loads the thread (cached: at once, refreshing stale ones in the background; `onRefresh` gets the update).
     * Rejects with NotFoundError for missing posts.
     */
    resolve(ref: PostRef, onRefresh?: (t: Thread) => void): Promise<Thread>;
}

export function createResolver(http: HttpClient, opts: { cacheSize?: number; now?: () => number; } = {}): Resolver {
    const cache = new SwrCache<Thread>(opts.cacheSize ?? 500, CACHE_POLICY, opts.now);
    const health = new Health();
    // Short link → resolved ref, for the session
    const shortLinks = new Map<string, Promise<PostRef>>();

    async function expand(ref: PostRef): Promise<PostRef> {
        if (!ref.shortLink) return ref;
        let p = shortLinks.get(ref.url);
        if (!p) {
            p = http.resolveRedirect(ref.url).then(final => {
                const resolved = parseLink(final);
                if (!resolved || resolved.shortLink || resolved.platform !== ref.platform) throw new NotFoundError(`Short link went to ${final}`);
                return { ...resolved, url: ref.url, spoiler: ref.spoiler };
            });
            p.catch(() => shortLinks.delete(ref.url));
            shortLinks.set(ref.url, p);
        }
        return p;
    }

    function load(ref: PostRef): Promise<Thread> {
        switch (ref.platform) {
            case "x": return resolveX(ref.id, http);
            case "reddit": return resolveReddit(ref.id, http);
            default: return Promise.reject(new Error(`No resolver for ${ref.platform} yet`));
        }
    }

    return {
        cache,
        health,
        handles: ref => SUPPORTED.has(ref.platform) && health.usable(ref.platform),
        peek: ref => (ref.shortLink ? undefined : cache.peek(refKey(ref))?.value),
        async resolve(ref, onRefresh) {
            const full = await expand(ref);
            const run = () => load(full).then(
                t => { health.success(full.platform); return t; },
                e => { health.failure(full.platform, e); throw e; },
            );
            return (await cache.get(refKey(full), run, onRefresh)).value;
        },
    };
}
