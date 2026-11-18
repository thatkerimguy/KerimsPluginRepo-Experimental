/*
 * Measuring an island: native renders it off screen in a React surface at the
 * chat width; the island's root (root.tsx) reports its laid-out height here.
 */

import { startMeasuring, stopMeasuring } from "./native";

const TIMEOUT_MS = 4000;

interface Pending {
    width: number;
    resolve(height: number): void;
    reject(e: unknown): void;
    timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, Pending>();

export function measureNative(key: string, width: number): Promise<number> {
    pending.get(key)?.reject(new Error("Measured again"));
    return new Promise<number>((resolve, reject) => {
        const done = (fn: () => void) => {
            clearTimeout(entry.timer);
            pending.delete(key);
            stopMeasuring(key);
            fn();
        };
        const entry: Pending = {
            width,
            resolve: h => done(() => resolve(h)),
            reject: e => done(() => reject(e)),
            timer: setTimeout(() => entry.reject(new Error(`Measuring ${key} timed out`)), TIMEOUT_MS),
        };
        pending.set(key, entry);
        startMeasuring(key, width).then(
            started => { if (!started) entry.reject(new Error("Native couldn't start a measuring surface")); },
            e => entry.reject(e),
        );
    });
}

/** Called by a measuring root after layout. Heights are reported until they stop changing for a frame. */
export function reportHeight(key: string, width: number, height: number) {
    const entry = pending.get(key);
    if (!entry || entry.width !== width) return;
    // Wait one more frame: images with known sizes and fonts settle in the first two layouts
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => entry.resolve(height), 32);
}

export function cancelAllMeasuring() {
    for (const entry of [...pending.values()]) entry.reject(new Error("Stopped"));
}
