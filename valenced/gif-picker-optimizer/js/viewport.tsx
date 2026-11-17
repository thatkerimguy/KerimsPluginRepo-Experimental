/** @jsxRuntime classic */
/** @jsx valenced.react.React.createElement */
/** @jsxFrag valenced.react.React.Fragment */
/*
 * Which items the GIF list shows right now, so the load queue starts the ones on
 * screen first.
 *
 * Discord's list is a MasonryFlashList with `drawDistance` of about one row
 * (GIF_PICKER_ITEM_ESIMTATED_HEIGHT, 180), so it already unmounts and recycles
 * tiles that scroll away. Its `viewedItemIndexes` only picks placeholder vs real
 * tile for mounted ones. The plugin used to also "park" tiles far outside the
 * visible range; FlashList had unmounted those already, so that was removed.
 * With the Viewport buffer setting it widens `drawDistance` (DRAW_DISTANCE), so tiles
 * are rendered before they scroll in.
 */

import type { ReactElement, ReactNode } from "react";
import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useMemo, useRef } from "react";

import { patchWorks } from "./diagnostics";
import { lazy } from "./lazy";
import { useSettings } from "./settingsStore";
import { applyQueueSettings, loadedThisSession } from "./state";
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

const viewportContext = lazy(() => createContext<ViewportStore | null>(null));

export interface ResultsListProps {
    [k: string]: unknown;
}

/** The list element inside Discord's results list (a MasonryFlashList) */
interface ViewableInfo {
    viewableItems?: ViewToken[];
}

/** The props of Discord's MasonryFlashList the plugin uses */
interface FlashListProps {
    onViewableItemsChanged?: (info: ViewableInfo) => void;
    renderItem?: unknown;
    drawDistance?: number;
}

/**
 * How far past the screen edge the list renders tiles, in px. Discord's is about one
 * row (GIF_PICKER_ITEM_ESIMTATED_HEIGHT, 180), so when scrolling outpaces rendering,
 * tiles at the edge show up blank (not even the grey box) and pop in. Three rows keeps
 * them ready. The extra tiles only queue: on-screen GIFs still load first.
 * Used while the Viewport buffer setting is on.
 */
const DRAW_DISTANCE = 540;

const isFlashList = (n: unknown): n is ReactElement<FlashListProps> =>
    isValidElement(n)
    && typeof (n.props as FlashListProps | null)?.onViewableItemsChanged === "function"
    && typeof (n.props as FlashListProps | null)?.renderItem === "function";

/** Wraps Discord's GIF results list to track which items are on screen */
export function OptimizedResultsList({ props, render }: { props: ResultsListProps; render: (p: ResultsListProps) => ReactNode; }) {
    const store = useMemo(() => new ViewportStore(), []);
    const settings = useSettings();
    const { cacheSize, sequential, concurrency, viewportBuffer } = settings;
    useEffect(() => {
        if (loadedThisSession.max !== cacheSize) loadedThisSession.resize(cacheSize);
    }, [cacheSize]);
    // Settings changed since start: once per list, not per tile
    useEffect(() => applyQueueSettings(settings), [sequential, concurrency]);
    const tree = render(props);

    const originalCallback = useRef<((info: ViewableInfo) => void) | null>(null);
    // Stable, because lists don't support changing onViewableItemsChanged on the fly
    const onViewableItemsChanged = useCallback((info: ViewableInfo) => {
        originalCallback.current?.(info);
        store.update(info?.viewableItems);
    }, [store]);

    const [result, hit] = replaceInTree(tree, isFlashList, list => {
        originalCallback.current = list.props.onViewableItemsChanged ?? null;
        return cloneElement(list, viewportBuffer
            ? { onViewableItemsChanged, drawDistance: Math.max(list.props.drawDistance ?? 0, DRAW_DISTANCE) }
            : { onViewableItemsChanged });
    });

    if (hit) patchWorks("resultsList");
    const ViewportContext = viewportContext();
    return (
        <ViewportContext.Provider value={hit ? store : null}>
            {(hit ? result : tree) as ReactNode}
        </ViewportContext.Provider>
    );
}

/**
 * Reports whether the tile at `index` is on screen through `onVisible` (now and
 * on every change), for the queue's priority. Returns whether it is right now.
 */
export function useVisibleIndex(index: number, onVisible: (visible: boolean) => void) {
    const store = useContext(viewportContext());
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
