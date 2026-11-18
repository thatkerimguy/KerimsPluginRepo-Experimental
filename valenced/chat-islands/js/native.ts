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
        "thatkerimguy.chatIslands.listen": [[], null];
        "thatkerimguy.chatIslands.measure": [[key: string, width: number], boolean];
        "thatkerimguy.chatIslands.measureDone": [[key: string], null];
        "thatkerimguy.chatIslands.setDebug": [[on: boolean], null];
        "thatkerimguy.chatIslands.log": [[level: string, text: string], null];
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

/** Writes a JS warning or error into native's diagnostics file (Valenced's JS logger only shows them in the app). */
export function nativeLog(level: string, text: string) {
    try {
        callNativeMethod(`${NATIVE}.log`, [level, text]).catch(() => { });
    } catch { /* native part missing */ }
}

export function setNativeDebug(on: boolean) {
    callNativeMethod(`${NATIVE}.setDebug`, [on]).catch(() => { });
}

/**
 * Native → JS events, delivered in batches (one per frame at most). Native sends nothing until
 * `listen` is called, after the handler is registered: a call to an unregistered JS method, or one
 * that throws, crashes the app (Valenced can't catch it on the native side).
 */
export function onNativeEvents(handler: (events: NativeEvent[]) => void, onError: (e: unknown) => void) {
    registerJSMethod(`${NATIVE}.events`, (events: unknown) => {
        try {
            if (Array.isArray(events)) handler(events as NativeEvent[]);
        } catch (e) {
            onError(e);
        }
        return null;
    });
    callNativeMethod(`${NATIVE}.listen`, []).catch(onError);
}
