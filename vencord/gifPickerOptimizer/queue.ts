/*
 * GIFs+ — sequential load queue.
 * Shared between the Vencord and Valenced builds (keep both copies in sync).
 *
 * Tiles register a ticket when they mount. The queue starts the waiting ticket
 * that comes first and only starts the next one once a running one reports that
 * it finished loading (`concurrency` run at once).
 *
 * Order: visible tickets first (with `prioritizeVisible`), then `priority` ones
 * (GIFs seen in an earlier session, which normally come straight from the cache),
 * then by index. The index is the reading order: Discord's masonry grid places
 * item 0, 1, 2... into columns left to right, row by row, even though its rows
 * don't line up in pixels.
 *
 * Three things on top of that:
 * - Cache fast lane: while seen-before GIFs keep loading in an instant (they came
 *   from the cache), more of them may start at once. One slow load (the cache had
 *   dropped it, so it really downloaded) closes the lane again.
 * - Overtime: a slow GIF gives its slot up after the load timeout (`release`) but
 *   keeps downloading. Those count against a second limit, so on a bad connection
 *   they can't pile up on top of the normal downloads.
 * - `hold()`: tickets marked `waitsForLowRes` (Klipy search results) wait while the
 *   small versions of a results page are being fetched. Everything else carries on.
 *
 * Waiting tickets are kept in a binary heap, so starting one costs O(log n) instead
 * of a scan over every waiting tile. The heap is rebuilt when the order changes
 * (`kick()`), and cancelled tickets are skipped when they come up.
 */

export interface Ticket {
    /** Position in reading order (the item index). Lower loads first. */
    order(): number;
    /** Whether the tile is on screen right now */
    visible: boolean;
    /**
     * Goes before the other tickets with the same visibility. Set for GIFs seen in
     * an earlier session: they usually load from the cache in an instant, so they
     * shouldn't wait behind downloads, but still take a turn in case the cache dropped them.
     */
    priority?: boolean;
    /** Waits while `hold()` is on (its small version may still be on its way) */
    waitsForLowRes?: boolean;
    /** Called when it is this ticket's turn to load */
    start(): void;
    /** insertion order, tie breaker */
    seq?: number;
}

/** A seen-before GIF that loaded this fast came from the cache */
const CACHE_HIT_MS = 150;
/** One that took this long really downloaded: the cache doesn't have them all */
const CACHE_MISS_MS = 400;
/** Extra seen-before GIFs that may load at once while they come from the cache */
const FAST_LANE = 8;
/** Overtime downloads (past the load timeout) may add up to this many times `concurrency` */
const OVERTIME_FACTOR = 1;
/** An overtime download stops counting after this long, even if it never reported back */
const OVERTIME_MAX_MS = 60_000;

export class LoadQueue {
    concurrency = 1;
    prioritizeVisible = true;

    private waiting = new Set<Ticket>();
    private active = new Set<Ticket>();
    /** Released after the load timeout but still downloading -> when it stops counting */
    private overtime = new Map<Ticket, number>();
    private holds = new Set<symbol>();
    private scheduled = false;
    private seq = 0;
    /** Seen-before GIFs are coming from the cache right now */
    private cacheHot = false;

    /** Waiting tickets, best first at [0]. Can also hold cancelled ones (skipped). */
    private heap: Ticket[] = [];
    /** The order changed since the heap was built */
    private dirty = false;
    /** `prioritizeVisible` the heap was built with */
    private builtVisibleFirst = true;

    enqueue(t: Ticket) {
        t.seq = this.seq++;
        this.waiting.add(t);
        if (!this.dirty) this.push(t);
        this.schedule();
    }

    /** Ticket unmounted or no longer interested */
    cancel(t: Ticket) {
        // Left in the heap, skipped when it comes up
        this.waiting.delete(t);
        this.overtime.delete(t);
        if (this.active.delete(t)) this.schedule();
    }

    /**
     * Ticket finished (loaded, failed or given up). `loadMs` is how long the load
     * took, which tells whether seen-before GIFs are coming from the cache.
     */
    finish(t: Ticket, loadMs?: number) {
        if (t.priority && loadMs != null) {
            if (loadMs <= CACHE_HIT_MS) this.cacheHot = true;
            else if (loadMs >= CACHE_MISS_MS) this.cacheHot = false;
        }
        const wasActive = this.active.delete(t);
        if (this.overtime.delete(t) || wasActive) this.schedule();
    }

    /** Ticket hit the load timeout: it gives its slot up but keeps downloading (counted as overtime) */
    release(t: Ticket) {
        if (!this.active.delete(t)) return;
        // Slow means it really downloaded, so the cache isn't serving these right now
        if (t.priority) this.cacheHot = false;
        this.overtime.set(t, Date.now() + OVERTIME_MAX_MS);
        this.schedule();
        // Count it until it reports back, or at most this long
        setTimeout(() => this.schedule(), OVERTIME_MAX_MS + 10);
    }

    /**
     * Holds tickets marked `waitsForLowRes` until the returned function is called or
     * the timeout passes. Used while small versions of a results page are fetched,
     * so their tiles don't start downloading the full size files meanwhile.
     */
    hold(timeoutMs: number) {
        const key = Symbol("hold");
        this.holds.add(key);
        const release = () => {
            if (this.holds.delete(key)) this.schedule();
        };
        setTimeout(release, timeoutMs);
        return release;
    }

    /** Something about the ordering changed (visibility/position) */
    kick() {
        this.dirty = true;
        this.schedule();
    }

    private schedule() {
        if (this.scheduled) return;
        this.scheduled = true;
        // Deferred so that every tile mounted in the same render registers first
        setTimeout(() => {
            this.scheduled = false;
            this.pump();
        }, 0);
    }

    private compare = (a: Ticket, b: Ticket) => {
        if (this.prioritizeVisible && a.visible !== b.visible) return a.visible ? -1 : 1;
        if (!a.priority !== !b.priority) return a.priority ? -1 : 1;
        const d = a.order() - b.order();
        return d !== 0 ? d : (a.seq ?? 0) - (b.seq ?? 0);
    };

    /** Whether `t` may start now, given what's running */
    private mayStart(t: Ticket, limit: number) {
        // Seen-before GIFs while they come from the cache: not real downloads, so past both limits
        if (t.priority && this.cacheHot && this.active.size < limit + FAST_LANE) return true;
        // Downloads: a free slot, and not too many slow ones still going in the background
        return this.active.size < limit && this.active.size + this.overtime.size < limit * (1 + OVERTIME_FACTOR);
    }

    private pump() {
        const now = Date.now();
        for (const [t, until] of this.overtime) if (until <= now) this.overtime.delete(t);

        // Rebuild when the order changed, or when cancelled tickets pile up
        if (this.dirty || this.builtVisibleFirst !== this.prioritizeVisible || this.heap.length > this.waiting.size * 2 + 64) {
            this.rebuild();
        }

        const limit = Math.max(1, this.concurrency | 0);
        /** Held tickets set aside, put back afterwards */
        const held: Ticket[] = [];
        while (this.waiting.size) {
            const best = this.pop();
            if (!best) break;
            if (!this.waiting.has(best)) continue; // cancelled
            if (this.holds.size && best.waitsForLowRes) {
                held.push(best);
                continue;
            }
            if (!this.mayStart(best, limit)) {
                // The best ticket can't start, so no other one may jump ahead of it
                held.push(best);
                break;
            }

            this.waiting.delete(best);
            this.active.add(best);
            try {
                best.start();
            } catch (e) {
                console.error("[GIFs+] ticket start failed", e);
                this.active.delete(best);
            }
        }
        for (const t of held) this.push(t);
    }

    private rebuild() {
        this.dirty = false;
        this.builtVisibleFirst = this.prioritizeVisible;
        // order() is read once per ticket here, not on every comparison
        const keyed = [...this.waiting].map(t => ({ t, v: t.visible, p: !!t.priority, o: t.order(), s: t.seq ?? 0 }));
        const visibleFirst = this.prioritizeVisible;
        keyed.sort((a, b) => {
            if (visibleFirst && a.v !== b.v) return a.v ? -1 : 1;
            if (a.p !== b.p) return a.p ? -1 : 1;
            return a.o - b.o || a.s - b.s;
        });
        // A sorted array is a valid heap
        this.heap = keyed.map(k => k.t);
    }

    private push(t: Ticket) {
        const h = this.heap;
        h.push(t);
        let i = h.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.compare(h[i], h[parent]) >= 0) break;
            [h[i], h[parent]] = [h[parent], h[i]];
            i = parent;
        }
    }

    private pop(): Ticket | undefined {
        const h = this.heap;
        if (!h.length) return undefined;
        const top = h[0];
        const last = h.pop()!;
        if (h.length) {
            h[0] = last;
            let i = 0;
            for (; ;) {
                const l = 2 * i + 1;
                const r = l + 1;
                let m = i;
                if (l < h.length && this.compare(h[l], h[m]) < 0) m = l;
                if (r < h.length && this.compare(h[r], h[m]) < 0) m = r;
                if (m === i) break;
                [h[i], h[m]] = [h[m], h[i]];
                i = m;
            }
        }
        return top;
    }
}
