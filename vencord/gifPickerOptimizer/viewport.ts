/*
 * Tracks whether tiles are on screen, for the load queue's priority.
 * (Discord's GIF list already unmounts tiles that scroll far away, so the
 * plugin doesn't unload them itself.)
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useCallback, useRef } from "@webpack/common";

/** element -> its scrolling ancestor (or null for the window). Every node on the way is cached too. */
const scrollerOf = new WeakMap<Element, Element | null>();

function findScroller(el: Element): Element | null {
    const path: Element[] = [];
    let found: Element | null = null;
    for (let n = el.parentElement; n; n = n.parentElement) {
        if (scrollerOf.has(n)) {
            found = scrollerOf.get(n)!;
            break;
        }
        path.push(n);
        const { overflowY } = getComputedStyle(n);
        if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
            found = n;
            break;
        }
    }
    for (const n of path) scrollerOf.set(n, found);
    return found;
}

/**
 * IntersectionObservers rooted on the picker's own scroller. Rooted on the window,
 * `rootMargin` would do nothing, because the scroller clips the tiles first.
 *
 * There's one observer per scroller and margin, counting the elements it watches.
 * The picker's scroller is a new element every time the picker opens, so an
 * observer is disconnected and dropped with its last element. Kept, it would
 * hold the closed picker's whole DOM in memory.
 */
class ViewportWatcher {
    private observers = new Map<string, { io: IntersectionObserver; count: number; }>();
    private callbacks = new Map<Element, (isIntersecting: boolean) => void>();
    private keyOf = new Map<Element, string>();
    private rootIds = new WeakMap<Element, number>();
    private nextRootId = 1;

    /** Watches `el` with a margin of `margin` px above and below the scroller. Replaces an earlier watch of `el`. */
    observe(el: Element, cb: (isIntersecting: boolean) => void, margin: number) {
        if (this.keyOf.has(el)) this.unobserve(el);
        const root = findScroller(el);
        let rootId = 0;
        if (root) {
            rootId = this.rootIds.get(root) ?? this.nextRootId++;
            this.rootIds.set(root, rootId);
        }
        const key = `${rootId}:${margin}`;

        let entry = this.observers.get(key);
        if (!entry) {
            const io = new IntersectionObserver(entries => {
                for (const e of entries) this.callbacks.get(e.target)?.(e.isIntersecting);
            }, { root, rootMargin: `${margin}px 0px` });
            entry = { io, count: 0 };
            this.observers.set(key, entry);
        }

        entry.count++;
        this.callbacks.set(el, cb);
        this.keyOf.set(el, key);
        entry.io.observe(el);
    }

    unobserve(el: Element) {
        this.callbacks.delete(el);
        const key = this.keyOf.get(el);
        if (key == null) return;
        this.keyOf.delete(el);
        const entry = this.observers.get(key);
        if (!entry) return;
        entry.io.unobserve(el);
        if (--entry.count <= 0) {
            entry.io.disconnect();
            this.observers.delete(key);
        }
    }

    disconnect() {
        for (const { io } of this.observers.values()) io.disconnect();
        this.observers.clear();
        this.callbacks.clear();
        this.keyOf.clear();
    }
}

const VISIBLE_MARGIN = 50;

/** "On screen", for the load queue's priority */
const visibleWatcher = new ViewportWatcher();

export function disconnectWatchers() {
    visibleWatcher.disconnect();
}

/**
 * Watches whichever element the returned ref is attached to (the placeholder,
 * the still tile, or a sentinel inside Discord's tile) and reports on-screen
 * changes through `onVisible`.
 */
export function useViewport(onVisible: (visible: boolean) => void) {
    const elRef = useRef<Element | null>(null);
    const onVisibleRef = useRef(onVisible);
    onVisibleRef.current = onVisible;

    return useCallback((el: Element | null) => {
        if (elRef.current === el) return;
        if (elRef.current) visibleWatcher.unobserve(elRef.current);
        elRef.current = el;
        if (el) visibleWatcher.observe(el, v => onVisibleRef.current(v), VISIBLE_MARGIN);
    }, []);
}
