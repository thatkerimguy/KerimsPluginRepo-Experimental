/*
 * GIFs+ — small previews for Klipy favourites.
 * Shared between the Vencord and Valenced builds (keep both copies in sync).
 *
 * Klipy gives every rendition a random file name, and Discord stores Klipy
 * favourites as the full size .gif, so a small version can't be derived from the
 * URL. Favourites do keep their Klipy page URL (`https://klipy.com/gifs/<slug>`),
 * so this searches Discord's own GIF API for the slug, asking for a small format,
 * and picks the result with the same page URL.
 *
 * Results (also misses) are cached and persisted, so each favourite is looked up
 * once. The other results a search returns are kept in a small in-memory cache
 * (they sometimes cover another favourite) and only saved once a favourite uses
 * one, so the saved cache grows with your Klipy favourites, not with every
 * search result. Two lookups run at a time, spaced out.
 */

import { Limiter, wait } from "./async";
import { LruCache } from "./cache";
import { lowResMediaFormat, normalizeUrl, type Quality } from "./lowres";
import { Persisted } from "./persist";
import { LOOKUP_CONCURRENCY, LOOKUP_SPACING_MS, LOOKUP_TIMEOUT_MS } from "./tuning";

export interface KlipySearchResult {
    url?: string;
    src?: string;
}

export interface KlipyResolverOptions {
    /** Discord's /gifs/search with the given query, media_format and limit */
    search(q: string, format: string, limit: number): Promise<KlipySearchResult[]>;
    load?(): Promise<Record<string, string> | undefined>;
    save?(entries: Record<string, string>): void;
    onError?(e: unknown): void;
}

const MAX_ENTRIES = 5000;
/** Other results of recent searches, not saved */
const MAX_EXTRA_ENTRIES = 500;
const SEARCH_LIMIT = 50;
/** Don't wait longer than this for the saved cache */
const LOAD_TIMEOUT_MS = 2000;
/**
 * A media_format the API rejected (HTTP 4xx) this many times in a row, and that
 * never worked, is skipped for the rest of the session.
 */
const MAX_FORMAT_FAILURES = 2;

export class KlipyResolver {
    /** Bumped whenever a lookup result is added or the cache is cleared (for memoized URL lists) */
    version = 0;
    /** `${format}|${pageKey}` -> low resolution URL, or "" when the search didn't find it */
    private cache = new LruCache<string, string>(MAX_ENTRIES);
    /** Same keys as `cache`, for results of searches made for other favourites */
    private extra = new LruCache<string, string>(MAX_EXTRA_ENTRIES);
    private pending = new Map<string, Promise<string | null>>();
    private limiter = new Limiter(LOOKUP_CONCURRENCY, LOOKUP_SPACING_MS);
    private saved: Persisted<Record<string, string>>;
    /** media_format -> searches that failed in a row; formats that worked are deleted */
    private formatFailures = new Map<string, number>();
    private workingFormats = new Set<string>();

    constructor(private opts: KlipyResolverOptions) {
        this.saved = new Persisted({
            load: () => opts.load?.(),
            save: entries => opts.save?.(entries),
            apply: entries => {
                if (typeof entries !== "object") return;
                for (const [k, v] of Object.entries(entries)) {
                    if (typeof v === "string" && !this.cache.has(k)) this.cache.set(k, v);
                }
                this.version++;
            },
            snapshot: () => this.entries(),
            onError: e => opts.onError?.(e),
        });
    }

    /** Whether searches with `format` are worth making (it isn't rejected by the API) */
    private usable(format: string) {
        return this.workingFormats.has(format) || (this.formatFailures.get(format) ?? 0) < MAX_FORMAT_FAILURES;
    }

    private key(format: string, pageUrl: string) {
        return `${format}|${pageKey(pageUrl)}`;
    }

    /** Whether `pageUrl` can be looked up at all */
    canResolve(pageUrl: string | undefined) {
        return klipyPageQuery(pageUrl) != null;
    }

    /**
     * Cached answer for the first format that has one:
     * a URL, null when no small version exists, or undefined when not looked up yet.
     */
    peek(pageUrl: string | undefined, formats: string[]): string | null | undefined {
        if (!pageUrl) return null;
        for (const f of formats) {
            const v = this.lookup(this.key(f, pageUrl));
            if (v) return v;
            // A miss, or a format the API rejects: try the next one
            if (v === "" || !this.usable(f)) continue;
            return undefined;
        }
        // Every format missed or is skipped: nothing to look up
        return formats.length ? null : undefined;
    }

    /** Looks `pageUrl` up, trying `formats` in order. Never rejects. */
    resolve(pageUrl: string, formats: string[]): Promise<string | null> {
        const known = this.peek(pageUrl, formats);
        if (known !== undefined) return Promise.resolve(known);

        const id = `${formats.join(",")}|${pageKey(pageUrl)}`;
        const existing = this.pending.get(id);
        if (existing) return existing;

        const run = this.limiter.run(async () => {
            await Promise.race([this.saved.ready, wait(LOAD_TIMEOUT_MS)]);
            for (const format of formats) {
                const cached = this.lookup(this.key(format, pageUrl));
                if (cached) return cached;
                if (cached === "" || !this.usable(format)) continue;
                try {
                    const hit = await this.search(pageUrl, format);
                    this.workingFormats.add(format);
                    this.formatFailures.delete(format);
                    if (hit) return hit;
                } catch (e) {
                    // Try the next format. Only a rejection counts against this one:
                    // a timeout or network error says nothing about the format.
                    if (!this.workingFormats.has(format) && isRejection(e)) {
                        this.formatFailures.set(format, (this.formatFailures.get(format) ?? 0) + 1);
                    }
                    this.opts.onError?.(e);
                }
                await wait(LOOKUP_SPACING_MS);
            }
            return null;
        }).finally(() => this.pending.delete(id));

        this.pending.set(id, run);
        return run;
    }

    private async search(pageUrl: string, format: string): Promise<string | null> {
        const q = klipyPageQuery(pageUrl);
        if (!q) return null;

        const results = await Promise.race([
            this.opts.search(q, format, SEARCH_LIMIT),
            wait(LOOKUP_TIMEOUT_MS).then(() => {
                throw new Error(`Klipy lookup timed out (media_format=${format})`);
            }),
        ]);
        const want = pageKey(pageUrl);
        let hit: string | null = null;
        for (const r of results ?? []) {
            if (!r?.url || !r.src) continue;
            const low = normalizeUrl(r.src);
            if (pageKey(r.url) === want) {
                hit = low;
                continue;
            }
            const key = this.key(format, r.url);
            if (!this.cache.has(key)) this.extra.set(key, low);
            // Saved as "no small version" by an earlier search: this one found it
            else if (this.cache.get(key) === "") this.cache.set(key, low);
        }
        this.cache.set(this.key(format, pageUrl), hit ?? "");
        this.version++;
        this.saved.changed();
        return hit;
    }

    /** Cached answer for `key`. One found among other searches' results is moved into the saved cache. */
    private lookup(key: string): string | undefined {
        const saved = this.cache.get(key);
        if (saved !== undefined) return saved;
        const other = this.extra.get(key);
        if (other === undefined) return undefined;
        this.extra.delete(key);
        this.cache.set(key, other);
        this.saved.changed();
        return other;
    }

    private entries() {
        const out: Record<string, string> = {};
        for (const [k, v] of this.cache.entries()) out[k] = v;
        return out;
    }

    /** Lookups saved, recent search results kept in memory, and roughly how much memory they use */
    stats() {
        return {
            saved: this.cache.size,
            recent: this.extra.size,
            bytes: this.cache.approxBytes() + this.extra.approxBytes(),
        };
    }

    /** Forgets every lookup, also the saved ones */
    clear() {
        this.cache.clear();
        this.extra.clear();
        this.formatFailures.clear();
        this.workingFormats.clear();
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

/**
 * Whether a failed search was the API refusing the request (HTTP 4xx), which for
 * these searches means it doesn't accept the media_format. Rate limits (429),
 * timeouts (408), network errors and our own timeout have no status or another one.
 */
export function isRejection(e: unknown): boolean {
    const err = e as { status?: unknown; response?: { status?: unknown; }; } | null;
    const status = Number(err?.status ?? err?.response?.status);
    return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

const KLIPY_PAGE_RE = /^https?:\/\/(?:www\.)?klipy\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:gifs?|stickers?|clips?)\/([^/?#]+)/i;

/** Search query for a Klipy page URL (`https://klipy.com/gifs/guh-lexa-fortnite` -> `guh lexa fortnite`) */
export function klipyPageQuery(pageUrl: string | undefined): string | null {
    const m = pageUrl && KLIPY_PAGE_RE.exec(normalizeUrl(pageUrl));
    if (!m) return null;
    let slug = m[1];
    try { slug = decodeURIComponent(slug); } catch { }
    const q = slug.replace(/[-_]+/g, " ").trim();
    return q || null;
}

/** Compares page URLs, ignoring scheme, www, letter case, query and trailing slash */
export function pageKey(url: string | undefined): string {
    return normalizeUrl(url ?? "")
        .replace(/^https?:\/\//i, "")
        .replace(/^www\./i, "")
        .replace(/[?#].*$/, "")
        .replace(/\/+$/, "")
        .toLowerCase();
}

/**
 * media_formats to look a Klipy favourite up with, best first. Favourites are
 * usually stored as the full size .gif, so images get a small webp; videos keep
 * their family.
 */
export function klipyFavoriteFormats(originalIsVideo: boolean, selectedFormat: string, quality: Quality): string[] {
    if (quality === "original") return [];
    if (originalIsVideo) {
        const f = lowResMediaFormat(selectedFormat, quality);
        return f ? [f] : [];
    }
    return quality === "xs" ? ["nanowebp", "tinywebp"] : ["tinywebp"];
}
