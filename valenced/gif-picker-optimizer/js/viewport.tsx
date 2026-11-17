/*
 * Which items the GIF list shows right now, so the load queue starts the ones on
 * screen first.
 *
 * Discord's list is a MasonryFlashList with `drawDistance` of about one row
 * (GIF_PICKER_ITEM_ESIMTATED_HEIGHT, 180), so it already unmounts and recycles
 * tiles that scroll away. Its `viewedItemIndexes` only picks placeholder vs real
 * tile for mounted ones. The plugin used to also "park" tiles far outside the
 * visible range; FlashList had unmounted those already, so that was removed.
 */

import type { ReactNode } from "react";
import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useMemo, useRef } from "react";

import { useSettings } from "./settingsStore";
import { loaded } from "./state";
import { replaceInTree } from "./tree";

interface ViewToken {
    index?: number | null;
    isViewable?: boolean;
}

class ViewportStore {
    first = -1;
    last = -1;
    private listeners = new Set<() => void>();

    get known() {
        return this.first !== -1;
    }

    update(viewable: ViewToken[] | undefined) {
        let first = Infinity;
        let last = -Infinity;
        for (const t of viewable ?? []) {
            if (!t?.isViewable || t.index == null) continue;
            if (t.index < first) first = t.index;
            if (t.index > last) last = t.index;
        }
        // Nothing viewable (list hidden or empty): keep the last known range
        if (first === Infinity) return;
        if (first === this.first && last === this.last) return;
        this.first = first;
        this.last = last;
        for (const listener of this.listeners) listener();
    }

    isVisible(index: number) {
        return !this.known || (index >= this.first && index <= this.last);
    }

    subscribe(listener: () => void) {
        this.listeners.add(listener);
        return () => void this.listeners.delete(listener);
    }
}

const ViewportContext = createContext<ViewportStore | null>(null);

export interface ResultsListProps {
    [k: string]: unknown;
}

/** The list element inside Discord's results list (a MasonryFlashList) */
const isFlashList = (n: any) =>
    isValidElement(n)
    && typeof (n.props as any)?.onViewableItemsChanged === "function"
    && typeof (n.props as any)?.renderItem === "function";

/** Wraps Discord's GIF results list to track which items are on screen */
export function OptimizedResultsList({ props, render }: { props: ResultsListProps; render: (p: ResultsListProps) => ReactNode; }) {
    const store = useMemo(() => new ViewportStore(), []);
    const { cacheSize } = useSettings();
    useEffect(() => {
        if (loaded.max !== cacheSize) loaded.resize(cacheSize);
    }, [cacheSize]);
    const tree = render(props);

    const originalCallback = useRef<((info: any) => void) | null>(null);
    // Stable, because lists don't support changing onViewableItemsChanged on the fly
    const onViewableItemsChanged = useCallback((info: any) => {
        originalCallback.current?.(info);
        store.update(info?.viewableItems);
    }, [store]);

    const [result, hit] = replaceInTree(tree, isFlashList, (list: any) => {
        originalCallback.current = list.props.onViewableItemsChanged;
        return cloneElement(list, { onViewableItemsChanged });
    });

    return (
        <ViewportContext.Provider value={hit ? store : null}>
            {hit ? result : tree}
        </ViewportContext.Provider>
    );
}

/**
 * Reports whether the tile at `index` is on screen through `onVisible` (now and
 * on every change), for the queue's priority. Returns whether it is right now.
 */
export function useVisibleIndex(index: number, onVisible: (visible: boolean) => void) {
    const store = useContext(ViewportContext);
    const latest = useRef({ index, onVisible });
    latest.current = { index, onVisible };

    useEffect(() => {
        if (!store) return;
        const check = () => {
            const { index, onVisible } = latest.current;
            onVisible(store.isVisible(index));
        };
        check();
        return store.subscribe(check);
    }, [store, index]);

    return store?.isVisible(index) ?? true;
}
