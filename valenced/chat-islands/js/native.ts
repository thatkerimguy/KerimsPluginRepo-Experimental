/*
 * The bridge to the native part (src/main/kotlin). Method names are shared
 * with Runtime.kt: keep both in sync.
 */

import { callNativeMethod, callNativeMethodSync, registerJSMethod } from "@valenced/modules/native";

// Not the plugin id: the experimental build renames that in JS, but these names are fixed in the Kotlin part too
export const NATIVE = "thatkerimguy.chatIslands";

export interface NativeStatus {
    /** The marker hook and React surfaces are working. */
    ready: boolean;
    /** Why not, when not. */
    reason: string | null;
    /** Native part version (the manifest version it was built with). */
    version: string;
    /** Chat content width in dp, once the chat has been laid out (0 before). */
    chatWidth: number;
}

declare module "@valenced/modules/native" {
    interface NativeMethods {
        "thatkerimguy.chatIslands.status": [[], NativeStatus];
        "thatkerimguy.chatIslands.measure": [[key: string, width: number], boolean];
        "thatkerimguy.chatIslands.measureDone": [[key: string], null];
        "thatkerimguy.chatIslands.setDebug": [[on: boolean], null];
    }
}

export type NativeEvent =
    | { type: "attach"; key: string; }
    | { type: "detach"; key: string; }
    | { type: "visible"; key: string; visible: boolean; }
    | { type: "chatWidth"; width: number; }
    | { type: "status"; status: NativeStatus; };

/** The native status, or null when the native part isn't there (JS-only install, old Valenced). */
export function nativeStatus(): NativeStatus | null {
    try {
        return callNativeMethodSync(`${NATIVE}.status`, []) ?? null;
    } catch {
        return null;
    }
}

/** Starts rendering an island off screen at `width` dp; its root reports the height (measure.ts). */
export function startMeasuring(key: string, width: number): Promise<boolean> {
    return callNativeMethod(`${NATIVE}.measure`, [key, width]);
}

export function stopMeasuring(key: string) {
    callNativeMethod(`${NATIVE}.measureDone`, [key]).catch(() => { });
}

export function setNativeDebug(on: boolean) {
    callNativeMethod(`${NATIVE}.setDebug`, [on]).catch(() => { });
}

/** Native → JS events, delivered in batches (one per frame at most). */
export function onNativeEvents(handler: (events: NativeEvent[]) => void) {
    registerJSMethod(`${NATIVE}.events`, (events: unknown) => {
        if (Array.isArray(events)) handler(events as NativeEvent[]);
        return null;
    });
}
