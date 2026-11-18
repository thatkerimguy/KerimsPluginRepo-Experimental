/*
 * The bridge to the native part (src/main/kotlin), where both fixes live. Method
 * names are shared with Runtime.kt: keep both in sync.
 */

import { callNativeMethodSync } from "@valenced/modules/native";

// Not the plugin id: the experimental build renames that in JS, but these names are fixed in the Kotlin part too
const NATIVE = "thatkerimguy.mediaFixes";

export type SettingKey = "decoderFix" | "backgroundGuard" | "oneAtATime" | "toasts";

export interface NativeStatus {
    version: string;
    /** Turned on while Discord was running: the fixes start after a restart. */
    waitingForRestart: boolean;
    /** Each hook: problem is null when it works. */
    parts: { name: string; problem: string | null; }[];
    settings: Record<SettingKey, boolean>;
    /** Hardware decoders that failed and are skipped for those videos now. */
    learned: string[];
    /** What the plugin did lately, newest first. */
    recent: string[];
    /** A Discord screen is visible. */
    visible: boolean;
    players: number;
    playing: number;
}

declare module "@valenced/modules/native" {
    interface NativeMethods {
        "thatkerimguy.mediaFixes.status": [[], NativeStatus];
        "thatkerimguy.mediaFixes.set": [[key: SettingKey, value: boolean], boolean];
        "thatkerimguy.mediaFixes.stopAll": [[], number];
        "thatkerimguy.mediaFixes.forget": [[], null];
    }
}

/** The native status, or null when the native part isn't loaded (iOS, old Valenced). */
export function nativeStatus(): NativeStatus | null {
    try {
        return callNativeMethodSync(`${NATIVE}.status`, []) ?? null;
    } catch {
        return null;
    }
}

export function setSetting(key: SettingKey, value: boolean) {
    try {
        callNativeMethodSync(`${NATIVE}.set`, [key, value]);
    } catch { }
}

/** Pauses every Discord player that's playing; returns how many. */
export function stopAllMedia(): number {
    try {
        return callNativeMethodSync(`${NATIVE}.stopAll`, []) ?? 0;
    } catch {
        return 0;
    }
}

export function forgetDecoderFailures() {
    try {
        callNativeMethodSync(`${NATIVE}.forget`, []);
    } catch { }
}
