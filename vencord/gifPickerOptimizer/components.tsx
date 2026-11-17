/*
 * The pieces a tile is drawn with: the loading indicator, the load overlay
 * inside Discord's tile, and the still favourite tile.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useRef, useState } from "@webpack/common";
import type { MouseEvent, ReactNode } from "react";

import type { StillSource } from "./previews";
import { cl } from "./state";
import { captureFrame, drawCover } from "./stillFrames";
import type { TileCoords } from "./types";

const RING_R = 11;
const RING_C = 2 * Math.PI * RING_R;

export function Indicator({ state, progress }: { state: "queued" | "loading"; progress?: number | null; }) {
    const determinate = state === "loading" && progress != null;
    return (
        <div className={cl("indicator", `indicator-${state}`)} aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 28 28" className={cl("ring", { "ring-spin": state === "loading" && !determinate })}>
                <circle className={cl("track")} cx="14" cy="14" r={RING_R} />
                {state === "loading" && (
                    <circle
                        className={cl("bar")}
                        cx="14"
                        cy="14"
                        r={RING_R}
                        strokeDasharray={RING_C}
                        strokeDashoffset={determinate ? RING_C * (1 - Math.min(1, Math.max(0, progress!))) : RING_C * 0.72}
                    />
                )}
            </svg>
            {determinate && <span className={cl("pct")}>{Math.round(progress! * 100)}%</span>}
        </div>
    );
}

interface LoadOverlayProps {
    src: string;
    video: boolean;
    showProgress: boolean;
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
export function LoadOverlay({ src, video, showProgress, onDone, onError }: LoadOverlayProps) {
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
        <div ref={ref} className={cl("overlay")}>
            {showProgress && <Indicator state="loading" progress={progress} />}
        </div>
    );
}

interface StillTileProps {
    viewRef(el: Element | null): void;
    source: StillSource;
    video: boolean;
    loading: boolean;
    showProgress: boolean;
    coords: TileCoords;
    onClick(e: MouseEvent): void;
    onContextMenu(e: MouseEvent): void;
    extras: ReactNode;
    onDone(): void;
    onError(): void;
}

/** A favourite shown as a still image instead of Discord's (animated) tile */
export function StillTile({ viewRef, source, video, loading, showProgress, coords, onClick, onContextMenu, extras, onDone, onError }: StillTileProps) {
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
            {loading && showProgress && <Indicator state="loading" />}
            {extras}
        </div>
    );
}
