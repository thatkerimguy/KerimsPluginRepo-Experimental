/*
 * The pieces a tile is drawn with: the loading indicator, the load overlay
 * inside Discord's tile, and the still favourite tile.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useRef, useState } from "@webpack/common";
import type { CSSProperties, MouseEvent, ReactNode } from "react";

import type { StillSource } from "./previews";
import { cl } from "./state";
import { captureFrame, drawCover } from "./stillFrames";
import type { TileCoords } from "./types";

/**
 * - queued: a breathing dot
 * - loading: the dot grows into a spinner, which flattens into a progress line once progress is known
 * - cached (precached / seen, normally straight from the cache): a breathing circle that morphs into a square and back
 */
export type IndicatorState = "queued" | "loading" | "cached";

/** Lengths of the looping animations in styles.css (vc-gpo-breathe, vc-gpo-morph) */
const LOOP_MS = { queued: 1600, cached: 2400 } as const;

/**
 * A negative delay that puts a looping animation where it would be had it started at page load.
 * Every tile then breathes in step, and a tile moving from the placeholder to Discord's tile
 * (a new element) carries on where it was instead of starting over.
 */
const inStep = (period: number) => ({ animationDelay: `${-(performance.now() % period)}ms` });

/** Length of vc-gpo-shimmer */
const SHIMMER_MS = 1600;
/** For the tile's ::after shimmer, which can't take an inline animationDelay */
export const shimmerInStep = () => ({ "--vc-gpo-sync": `${-(performance.now() % SHIMMER_MS)}ms` }) as CSSProperties;

/**
 * Passed to Discord's tile as `color`, the background it shows until its GIF loads.
 * Without it Discord picks a bright purple or blue from a fixed palette, which ignores the theme.
 * Same as the placeholder's background (.vc-gpo-tile).
 */
export const PLACEHOLDER_COLOR = "var(--background-mod-subtle)";

export function Indicator({ state, progress, enter = true }: {
    state: IndicatorState;
    progress?: number | null;
    /** Play the entry animation (dot to spinner, cached fade-in). False when the previous element already showed this state. */
    enter?: boolean;
}) {
    const p = state === "loading" && progress != null ? Math.min(1, Math.max(0, progress)) : null;

    let shape: ReactNode;
    if (state === "queued") shape = <div className={cl("dot")} style={inStep(LOOP_MS.queued)} />;
    else if (state === "cached") shape = <div className={cl("shape")} style={inStep(LOOP_MS.cached)} />;
    else if (p == null) shape = <div className={cl("spinner", { "spinner-enter": enter })} />;
    else shape = (
        <div className={cl("line")}>
            <div className={cl("line-fill")} style={{ width: `${p * 100}%` }} />
        </div>
    );

    return (
        <div className={cl("indicator", `indicator-${state}`, { "indicator-enter": enter })} aria-hidden="true">
            {shape}
            {p != null && <span className={cl("pct")}>{Math.round(p * 100)}%</span>}
        </div>
    );
}

interface LoadOverlayProps {
    src: string;
    video: boolean;
    /** Still loading: shimmer like the placeholder */
    loading: boolean;
    showProgress: boolean;
    /** Precached / seen: the cached shape instead of the spinner */
    precached: boolean;
    /** False when the placeholder already showed a spinner (Klipy lookup), so it doesn't grow out of a dot again */
    enter: boolean;
    onDone(): void;
    onError(): void;
}

// Done on `canplay`, like Discord's own tile, which shows its video then (`handleCanPlay`).
// `canplaythrough` comes later and would hold the queue slot longer.
const VIDEO_EVENTS = ["progress", "loadedmetadata", "durationchange", "canplay", "error"];
/** HTMLMediaElement.HAVE_FUTURE_DATA: what `canplay` reports */
const HAVE_FUTURE_DATA = 3;

/**
 * Rendered inside Discord's GIF tile (through renderExtras). Watches the tile's
 * <video>/<img> for load events and draws the progress overlay.
 */
export function LoadOverlay({ src, video, loading, showProgress, precached, enter, onDone, onError }: LoadOverlayProps) {
    // Fixed at mount, so the shimmer doesn't jump on re-render
    const [sync] = useState(shimmerInStep);
    const ref = useRef<HTMLDivElement>(null);
    const [progress, setProgress] = useState<number | null>(null);
    const cbs = useRef({ onDone, onError });
    cbs.current = { onDone, onError };

    useEffect(() => {
        const root = ref.current?.parentElement;
        if (!root) return;

        let finished = false;
        const finish = (ok: boolean) => {
            if (finished) return;
            finished = true;
            if (ok) cbs.current.onDone();
            else cbs.current.onError();
        };

        const reportBuffered = (v: HTMLVideoElement) => {
            if (!(v.duration > 0) || !v.buffered.length) return;
            const p = v.buffered.end(v.buffered.length - 1) / v.duration;
            setProgress(p);
            if (p >= 0.999) finish(true);
        };

        const onMedia = (e: Event) => {
            const v = e.target;
            if (!(v instanceof HTMLVideoElement)) return;
            // Discord clears src when returning the element to its pool
            if (!v.getAttribute("src")) return;
            switch (e.type) {
                case "progress":
                case "loadedmetadata":
                case "durationchange":
                    reportBuffered(v);
                    break;
                case "canplay":
                    reportBuffered(v);
                    finish(true);
                    break;
                case "error":
                    finish(false);
                    break;
            }
        };

        let probe: HTMLImageElement | null = null;
        let check: ReturnType<typeof setTimeout> | undefined;

        if (video) {
            for (const ev of VIDEO_EVENTS) root.addEventListener(ev, onMedia, true);
            // The video may already be ready (cache) before we started listening
            check = setTimeout(() => {
                const v = root.querySelector("video");
                if (v?.getAttribute("src") && v.readyState >= HAVE_FUTURE_DATA) finish(true);
            }, 50);
        } else {
            // Discord preloads images on a detached <img>, so watch the same URL.
            // The browser shares the request, it isn't downloaded twice.
            probe = new Image();
            probe.onload = () => finish(true);
            probe.onerror = () => finish(false);
            probe.src = src;
        }

        return () => {
            finished = true;
            clearTimeout(check);
            for (const ev of VIDEO_EVENTS) root.removeEventListener(ev, onMedia, true);
            if (probe) probe.onload = probe.onerror = null;
        };
    }, [src, video]);

    return (
        <div ref={ref} className={cl("overlay", { "overlay-loading": loading })} style={sync}>
            {showProgress && (precached
                // Carries on from the placeholder's shape, so no fade-in
                ? <Indicator state="cached" enter={false} />
                : <Indicator state="loading" progress={progress} enter={enter} />)}
        </div>
    );
}

interface StillTileProps {
    viewRef(el: Element | null): void;
    source: StillSource;
    video: boolean;
    loading: boolean;
    showProgress: boolean;
    precached: boolean;
    enter: boolean;
    coords: TileCoords;
    onClick(e: MouseEvent): void;
    onContextMenu(e: MouseEvent): void;
    extras: ReactNode;
    onDone(): void;
    onError(): void;
}

/** A favourite shown as a still image instead of Discord's (animated) tile */
export function StillTile({ viewRef, source, video, loading, showProgress, precached, enter, coords, onClick, onContextMenu, extras, onDone, onError }: StillTileProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const cbs = useRef({ onDone, onError });
    cbs.current = { onDone, onError };

    useEffect(() => {
        if (!source.capture) return;
        const signal = { cancelled: false };
        const rect = canvasRef.current?.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const target = rect && rect.width > 0 && rect.height > 0
            ? { width: Math.round(rect.width * dpr), height: Math.round(rect.height * dpr) }
            : undefined;

        const capture = (retry: boolean): Promise<void> => captureFrame(source.url, video, signal, target).then(frame => {
            if (signal.cancelled) return;
            if (canvasRef.current && !drawCover(canvasRef.current, frame)) {
                // Evicted from the cache (and closed) before it was drawn: capture it again
                if (retry) return capture(false);
                throw new Error("Couldn't draw the still frame");
            }
            cbs.current.onDone();
        });
        capture(true).catch(() => !signal.cancelled && cbs.current.onError());

        return () => void (signal.cancelled = true);
    }, [source.url, source.capture, video]);

    return (
        <div
            ref={viewRef}
            className={cl("tile", "tile-still")}
            style={coords}
            onClick={onClick}
            onContextMenu={onContextMenu}
        >
            {source.capture
                ? <canvas ref={canvasRef} className={cl("still-media")} />
                : (
                    <img
                        className={cl("still-media")}
                        src={source.url}
                        alt=""
                        draggable={false}
                        decoding="async"
                        onLoad={() => cbs.current.onDone()}
                        onError={() => cbs.current.onError()}
                    />
                )}
            {loading && showProgress && (precached
                ? <Indicator state="cached" enter={false} />
                : <Indicator state="loading" enter={enter} />)}
            {extras}
        </div>
    );
}
