/*
 * GIFs+ — sequential load queue.
 * Shared between the Vencord and Valenced builds (keep both copies in sync).
 *
 * Tiles register a ticket when they mount. The queue starts the waiting ticket
 * that comes first in reading order and only starts the next one once the running
 * one reports that it finished loading.
 *
 * Reading order is the item index: Discord's masonry grid places item 0, 1, 2...
 * into columns left to right, row by row, so the index is exactly "left to right,
 * top to bottom" even though the rows of a masonry grid don't line up in pixels.
 *
 * Order: visible tickets first (with `prioritizeVisible`), then `priority` ones
 * (precached GIFs, which normally come straight from the cache), then by index.
 *
 * Waiting tickets are kept in a binary heap, so starting one costs O(log n)
 * instead of a scan over every waiting tile (thousands with a big favourites
 * library and unloading off). The heap is rebuilt when the order changes
 * (`kick()`), and cancelled tickets are skipped when they come up.
 */

export interface Ticket {
    /** Position in reading order (the item index). Lower loads first. */
    order(): number;
    /** Whether the tile is on screen right now */
    visible: boolean;
    /**
     * Goes before the other tickets with the same visibility. Set for precached
     * GIFs: they usually load from the cache in an instant, so they shouldn't
     * wait behind downloads, but still take a turn in case the cache dropped them.
     */
    priority?: boolean;
    /** Called when it is this ticket's turn to load */
    start(): void;
    /** insertion order, tie breaker */
    seq?: number;
}

export class LoadQueue {
    concurrency = 1;
    prioritizeVisible = true;

    private waiting = new Set<Ticket>();
    private active = new Set<Ticket>();
    private blockers = new Set<symbol>();
    private scheduled = false;
    private seq = 0;

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
        if (this.active.delete(t)) this.schedule();
    }

    /** Ticket finished (loaded, errored or timed out) */
    finish(t: Ticket) {
        if (this.active.delete(t)) this.schedule();
    }

    /**
     * Holds the queue (nothing new starts) until the returned function is called
     * or the timeout passes. Used while low resolution URLs are being looked up,
     * so we don't start downloading full resolution files in the meantime.
     */
    block(timeoutMs: number) {
        const key = Symbol("block");
        this.blockers.add(key);
        const release = () => {
            if (this.blockers.delete(key)) this.schedule();
        };
        setTimeout(release, timeoutMs);
        return release;
    }

    get isBlocked() {
        return this.blockers.size > 0;
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

    private pump() {
        if (this.blockers.size) return;
        // Rebuild when the order changed, or when cancelled tickets pile up
        if (this.dirty || this.builtVisibleFirst !== this.prioritizeVisible || this.heap.length > this.waiting.size * 2 + 64) {
            this.rebuild();
        }

        const limit = Math.max(1, this.concurrency | 0);
        while (this.active.size < limit && this.waiting.size) {
            const best = this.pop();
            if (!best) break;
            if (!this.waiting.has(best)) continue; // cancelled

            this.waiting.delete(best);
            this.active.add(best);
            try {
                best.start();
            } catch (e) {
                console.error("[GIFs+] ticket start failed", e);
                this.active.delete(best);
            }
        }
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
