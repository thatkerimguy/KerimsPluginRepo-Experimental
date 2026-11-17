/*
 * The GIF tile the patch renders instead of Discord's. It waits for its turn in
 * the load queue and shows a preview (or still image). Discord's list unmounts it
 * when it scrolls far away, which frees its slot.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { useEffect, useRef, useState } from "@webpack/common";
import type { MouseEvent } from "react";

import { Indicator, LoadOverlay, StillTile } from "./components";
import { wait } from "./klipy";
import { isVideoUrl, normalizeUrl, stillUrl } from "./lowres";
import { isFavoritesTile, klipyLookupFor, pickSrc, pickStill, type StillSource } from "./previews";
import type { Ticket } from "./queue";
import { loadConcurrency, quality, settings } from "./settings";
import { cl, drop, failed, forgetLoaded, isCached, isDropped, isPrecached, logger, markLoaded, queue } from "./state";
import { GIF_TYPE_VIDEO, type GifItem, type ResultProps } from "./types";
import { useViewport } from "./viewport";

/**
 * - queued: waiting for a turn in the load queue
 * - resolving: looking up the small Klipy URL before loading
 * - loading: the chosen URL is loading
 * - done: loaded, failed for good, or shown from cache
 */
type Phase = "queued" | "resolving" | "loading" | "done";

interface LoaderOptions {
    item: GifItem;
    src: string;
    index: number;
    /** Show a still image instead of the animated GIF */
    still: boolean;
    /** The URL to show, for the current mode */
    pick(): string;
    sequential: boolean;
    concurrency: number;
    prioritizeVisible: boolean;
    loadTimeout: number;
}

/** The load lifecycle of one tile: queue ticket, viewport, timeouts and fallbacks */
function useTileLoader(opts: LoaderOptions) {
    const { item, src, index, still, pick, loadTimeout } = opts;

    const indexRef = useRef(index);
    indexRef.current = index;
    const ticketRef = useRef<Ticket | null>(null);
    const visibleRef = useRef(false);

    /** The URL being shown or loaded, null until the tile's turn */
    const [chosen, setChosen] = useState<string | null>(() => {
        const url = pick();
        return isCached(url) ? url : null;
    });
    const [phase, setPhase] = useState<Phase>(() => (chosen ? "done" : "queued"));
    /** Precached: first in the queue and no spinner (it normally comes straight from the cache) */
    const [precached, setPrecached] = useState(false);

    const viewRef = useViewport(visible => {
        visibleRef.current = visible;
        const ticket = ticketRef.current;
        if (ticket && ticket.visible !== visible) {
            ticket.visible = visible;
            queue.kick();
        }
    });

    // Wait for a turn in the load queue
    useEffect(() => {
        if (phase !== "queued") return;

        // Came back on screen and was loaded before: show it from cache right away
        const cached = pick();
        if (isCached(cached)) {
            setChosen(cached);
            setPhase("done");
            return;
        }

        queue.concurrency = opts.sequential ? loadConcurrency(opts.concurrency) : 64;
        queue.prioritizeVisible = opts.prioritizeVisible;
        const priority = isPrecached(cached);
        setPrecached(priority);

        let started = false;
        const begin = () => {
            const url = pick();
            setChosen(url);
            if (isCached(url)) {
                queue.finish(ticket);
                setPhase("done");
            } else {
                setPhase("loading");
            }
        };
        const ticket: Ticket = {
            visible: visibleRef.current,
            priority,
            order: () => indexRef.current ?? 0,
            start: () => {
                started = true;
                try {
                    const lookup = klipyLookupFor(item, src);
                    if (!lookup) return begin();
                    setPhase("resolving");
                    // A lookup never holds a tile longer than the load timeout
                    Promise.race([lookup, wait(loadTimeout * 1000)])
                        .catch(() => { })
                        .then(() => !isDropped(ticket) && begin());
                } catch (e) {
                    logger.error("Couldn't start loading a GIF", e);
                    setChosen(normalizeUrl(src));
                    setPhase("loading");
                }
            },
        };
        ticketRef.current = ticket;
        queue.enqueue(ticket);

        // Once started, the slot is freed by finishing, parking or unmounting instead
        return () => {
            if (!started) drop(ticket);
        };
    }, [phase, still]);

    // The still favourites setting changed: pick the URL again
    const stillRef = useRef(still);
    useEffect(() => {
        if (stillRef.current === still) return;
        stillRef.current = still;
        drop(ticketRef.current);
        setChosen(null);
        setPhase("queued");
    }, [still]);

    // Release the slot after the timeout so one slow GIF doesn't hold everything up
    useEffect(() => {
        if (phase !== "loading" && phase !== "resolving") return;
        const timer = setTimeout(() => ticketRef.current && queue.finish(ticketRef.current), loadTimeout * 1000);
        return () => clearTimeout(timer);
    }, [phase, chosen]);

    // Unmounted while loading: free the slot
    useEffect(() => () => drop(ticketRef.current), []);

    const original = normalizeUrl(src);

    const onDone = () => {
        if (chosen) markLoaded(chosen);
        if (phase !== "loading") return;
        if (ticketRef.current) queue.finish(ticketRef.current);
        setPhase("done");
    };

    const onError = () => {
        if (chosen && chosen !== original) {
            // Still / preview not available: try the next best one, then the original
            failed.add(chosen);
            forgetLoaded(chosen);
            const next = pick();
            setChosen(next !== chosen ? next : original);
            if (phase === "done") setPhase("loading");
            return;
        }
        if (ticketRef.current) queue.finish(ticketRef.current);
        setPhase("done");
    };

    return { phase, chosen, precached, viewRef, onDone, onError };
}

function SequentialResultInner({ Result, resultType, ...rest }: ResultProps) {
    const { item, src, coords } = rest;
    const {
        sequential, concurrency, prioritizeVisible, loadTimeout, showProgress,
        stillFavorites,
    } = settings.use([
        "sequential", "concurrency", "prioritizeVisible", "loadTimeout", "showProgress", "quality",
        "stillFavorites",
    ]);

    const still = stillFavorites && isFavoritesTile(resultType, item);
    const { phase, chosen, precached, viewRef, onDone, onError } = useTileLoader({
        item,
        src,
        index: rest.index,
        still,
        pick: () => (still ? pickStill(item, src).url : pickSrc(item, src)),
        sequential,
        concurrency: concurrency ?? 0,
        prioritizeVisible,
        loadTimeout,
    });

    const click = (e: MouseEvent) => rest.onClick?.(item, rest.index, { shiftKey: e.shiftKey });
    const contextMenu = (e: MouseEvent) => rest.onContextMenu?.(e, item);

    // Waiting for its turn or being looked up
    if (phase === "queued" || phase === "resolving") {
        return (
            <div
                ref={viewRef}
                className={cl("tile")}
                style={coords}
                onClick={click}
                onContextMenu={contextMenu}
            >
                {showProgress && !precached && <Indicator state={phase === "resolving" ? "loading" : "queued"} />}
                {rest.renderExtras?.(item)}
            </div>
        );
    }

    const original = normalizeUrl(src);
    const shown = chosen ?? original;

    if (still) {
        // A ready-made still image is shown as is. Anything else is animated: capture its first frame.
        const source: StillSource = { url: shown, capture: stillUrl(original, quality(), item) !== shown };
        return (
            <StillTile
                key={shown}
                viewRef={viewRef}
                source={source}
                video={source.capture && (rest.format === GIF_TYPE_VIDEO || isVideoUrl(shown))}
                loading={phase === "loading"}
                showProgress={showProgress && !precached}
                coords={coords}
                onClick={click}
                onContextMenu={contextMenu}
                extras={rest.renderExtras?.(item)}
                onDone={onDone}
                onError={onError}
            />
        );
    }

    const video = rest.format === GIF_TYPE_VIDEO || isVideoUrl(shown);

    return (
        <Result
            key={shown}
            {...rest}
            src={shown}
            renderExtras={(it: GifItem) => (
                <>
                    {rest.renderExtras?.(it)}
                    {/* Fills the tile, so the viewport watcher can see Discord's tile */}
                    <div ref={viewRef} className={cl("sentinel")} aria-hidden="true" />
                    {/* Also for a preview shown from cache, which may not load any more */}
                    {(phase === "loading" || shown !== original) && (
                        <LoadOverlay
                            src={shown}
                            video={video}
                            showProgress={showProgress && phase === "loading" && !precached}
                            onDone={onDone}
                            onError={onError}
                        />
                    )}
                </>
            )}
        />
    );
}

export const SequentialResult = ErrorBoundary.wrap(SequentialResultInner, {
    // If anything goes wrong, render Discord's own tile untouched
    fallback: ({ wrappedProps: { Result, resultType, ...props } }) => <Result {...props} />,
    displayName: "GifPickerOptimizerResult",
});
