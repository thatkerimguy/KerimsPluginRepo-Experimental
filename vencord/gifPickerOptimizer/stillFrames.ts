/*
 * First frames of animated favourites, for "still favourites" when the source
 * has no still rendition of its own (Klipy and others).
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { LruCache } from "./cache";

type Frame = ImageBitmap | HTMLCanvasElement;
interface Size {
    width: number;
    height: number;
}

/**
 * Frames are decoded bitmaps (4 bytes per pixel), so they're captured at tile
 * size and limited by bytes: 24 MB is about 150 tiles at 1x, or 40 at 2x.
 */
export const FRAME_BUDGET_BYTES = 24 * 1024 * 1024;

/** Captured frames by URL. Evicted ones are freed right away. */
export const frames = new LruCache<string, Frame>(
    FRAME_BUDGET_BYTES,
    (_, frame) => {
        if ("close" in frame) frame.close();
        else frame.width = frame.height = 0;
    },
    frame => frame.width * frame.height * 4,
);

/**
 * Draws `frame` into `canvas` like `object-fit: cover`. False when it couldn't:
 * a frame evicted from the cache is closed (0×0) and can't be drawn any more.
 */
export function drawCover(canvas: HTMLCanvasElement, frame: CanvasImageSource & Size): boolean {
    const ctx = canvas.getContext("2d");
    if (!ctx || !frame.width || !frame.height) return false;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round((rect.width || frame.width) * dpr));
    const ch = Math.max(1, Math.round((rect.height || frame.height) * dpr));
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    const scale = Math.max(cw / frame.width, ch / frame.height);
    const w = frame.width * scale;
    const h = frame.height * scale;
    ctx.clearRect(0, 0, cw, ch);
    try {
        ctx.drawImage(frame, (cw - w) / 2, (ch - h) / 2, w, h);
        return true;
    } catch {
        return false;
    }
}

/**
 * Size to keep a `w`×`h` frame at so it still covers a `target` sized tile
 * (object-fit: cover) without upscaling. Null keeps the natural size.
 */
function coverSize(w: number, h: number, target?: Size): Size | null {
    if (!w || !h || !target?.width || !target?.height) return null;
    const scale = Math.min(1, Math.max(target.width / w, target.height / h));
    if (scale >= 1) return null;
    return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Loads `url` (image or video) and returns its first frame at about `target` size (device pixels), cached */
export function captureFrame(url: string, video: boolean, signal: { cancelled: boolean; }, target?: Size): Promise<Frame> {
    const cached = frames.get(url);
    if (cached) return Promise.resolve(cached);

    return new Promise((resolve, reject) => {
        const el = video ? document.createElement("video") : new Image();
        const cleanup = () => {
            el.onerror = null;
            if (el instanceof HTMLVideoElement) {
                el.onloadeddata = null;
                // Free the decoder right away
                el.removeAttribute("src");
                el.load();
            } else {
                el.onload = null;
            }
        };
        const ready = async () => {
            try {
                if (signal.cancelled) throw new Error("cancelled");
                const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
                const h = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
                const size = coverSize(w, h, target);
                let frame: Frame;
                try {
                    frame = await createImageBitmap(el, size
                        ? { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: "medium" }
                        : undefined);
                } catch {
                    // Fall back to copying the frame onto a canvas
                    frame = document.createElement("canvas");
                    frame.width = size?.width ?? w;
                    frame.height = size?.height ?? h;
                    frame.getContext("2d")!.drawImage(el, 0, 0, frame.width, frame.height);
                }
                frames.set(url, frame);
                resolve(frame);
            } catch (e) {
                reject(e);
            } finally {
                cleanup();
            }
        };

        el.onerror = () => {
            cleanup();
            reject(new Error(`Couldn't load ${url}`));
        };
        if (el instanceof HTMLVideoElement) {
            el.muted = true;
            el.preload = "auto";
            el.onloadeddata = ready;
        } else {
            el.decoding = "async";
            el.onload = ready;
        }
        el.src = url;
    });
}
