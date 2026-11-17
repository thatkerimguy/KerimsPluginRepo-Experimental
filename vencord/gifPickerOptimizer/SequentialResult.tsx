/*
 * The GIF tile the patch renders instead of Discord's. It waits for its turn in
 * the load queue and shows a preview (or still image). Discord's list unmounts it
 * when it scrolls far away, which frees its slot.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { useEffect, useMemo, useRef, useState } from "@webpack/common";
import type { MouseEvent } from "react";

import { Indicator, LoadOverlay, PLACEHOLDER_COLOR, shimmerInStep, StillTile } from "./components";
import { patchWorks } from "./diagnostics";
import { isVideoUrl, normalizeUrl, stillUrl } from "./lowres";
import { isFavoritesTile, klipyLookupFor, pickSrc, pickStill, type StillSource } from "./previews";
import { quality, settings } from "./settings";
import { cl, tileEnv } from "./state";
import { useTileLoader } from "./tileLoader";
import { GIF_TYPE_VIDEO, type GifItem, type ResultProps } from "./types";
import { useViewport } from "./viewport";

function SequentialResultInner({ Result, resultType, ...rest }: ResultProps) {
    patchWorks("results");
    const { item, src, coords } = rest;
    const { loadTimeout, showProgress, stillFavorites } = settings.use(["loadTimeout", "showProgress", "quality", "stillFavorites"]);

    const still = stillFavorites && isFavoritesTile(resultType, item);
    const original = normalizeUrl(src);
    // Hooks passed at render time: @webpack/common fills them in only once Discord's React
    // loads, after this module is evaluated (a module-level copy would hold undefined)
    const { phase, chosen, seenBefore, attempt, gaveUp, setVisible, done: onDone, error: onError } = useTileLoader({ useState, useEffect, useRef }, tileEnv, {
        original,
        index: rest.index,
        still,
        loadTimeout,
        initiallyVisible: false,
        pick: () => (still ? pickStill(item, src).url : pickSrc(item, src)),
        lookup: () => klipyLookupFor(item, src),
    });
    const viewRef = useViewport(setVisible);
    const shown = chosen ?? original;
    // A ready-made still image is shown as is. Anything else is animated: its first frame is captured.
    const q = quality();
    const captureStill = useMemo(() => still && stillUrl(original, q, item) !== shown, [still, original, shown, q]);

    // A tile that was resolving already showed a spinner: the loading one carries on instead of growing out of a dot
    const spinnerShown = useRef(false);
    if (phase === "resolving") spinnerShown.current = true;
    else if (phase === "queued") spinnerShown.current = false;
    // Fixed at mount, so the placeholder's shimmer doesn't jump on re-render
    const [shimmerSync] = useState(shimmerInStep);

    const click = (e: MouseEvent) => rest.onClick?.(item, rest.index, { shiftKey: e.shiftKey });
    const contextMenu = (e: MouseEvent) => rest.onContextMenu?.(e, item);

    // Waiting for its turn or being looked up
    if (phase === "queued" || phase === "resolving") {
        return (
            <div
                ref={viewRef}
                className={cl("tile")}
                style={{ ...coords, ...shimmerSync }}
                onClick={click}
                onContextMenu={contextMenu}
            >
                {showProgress && <Indicator state={seenBefore ? "cached" : phase === "resolving" ? "loading" : "queued"} />}
                {rest.renderExtras?.(item)}
            </div>
        );
    }

    if (still) {
        const source: StillSource = { url: shown, capture: captureStill };
        return (
            <StillTile
                // A retry of the same URL is a new element, so it loads again
                key={`${attempt}:${shown}`}
                viewRef={viewRef}
                source={source}
                video={source.capture && (rest.format === GIF_TYPE_VIDEO || isVideoUrl(shown))}
                loading={phase === "loading"}
                showProgress={showProgress}
                seenBefore={seenBefore}
                enter={!spinnerShown.current}
                failed={gaveUp}
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
            // A retry of the same URL is a new element, so it loads again
            key={`${attempt}:${shown}`}
            {...rest}
            color={rest.color ?? PLACEHOLDER_COLOR}
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
                            loading={phase === "loading"}
                            showProgress={showProgress && (phase === "loading" || gaveUp)}
                            seenBefore={seenBefore}
                            enter={!spinnerShown.current}
                            failed={gaveUp}
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
    fallback: ({ wrappedProps: { Result, resultType, ...props } }) => <Result color={PLACEHOLDER_COLOR} {...props} />,
    displayName: "GifPickerOptimizerResult",
});
