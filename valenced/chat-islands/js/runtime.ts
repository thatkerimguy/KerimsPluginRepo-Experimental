/*
 * The running library: one registry, store and pipeline, availability, and
 * the API object handed to each dependent plugin.
 */

import { useEffect, useReducer } from "react";
import { Dimensions } from "react-native";

import type { ChatIslandsApi, IslandMessage, IslandProvider } from "./api";
import { measureNative } from "./measure";
import type { NativeEvent, NativeStatus } from "./native";
import { nativeStatus } from "./native";
import { Pipeline } from "./pipeline";
import { Registry } from "./registry";
import { IslandStore } from "./store";

export const VERSION = "0.1.0";

/** Message gutter left of content (avatar + paddings) when native hasn't reported the chat width yet. */
const FALLBACK_GUTTER_DP = 72;
/** Islands never get wider than this (tablets), like Discord's embeds. */
const MAX_WIDTH_DP = 520;

export interface RuntimeHooks {
    /** Regenerates rows (discord.ts sets it once it found the row manager). */
    refresh(messageIds: string[]): void;
    openMessageMenu(message: IslandMessage): void;
    log(level: "info" | "warn" | "error", ...args: unknown[]): void;
}

export const hooks: RuntimeHooks = {
    refresh: () => { },
    openMessageMenu: () => { },
    log: () => { },
};

let status: NativeStatus | null = null;
let chatWidthDp = 0;
let unavailable: string | null = "Not started";
const availabilityListeners = new Set<() => void>();

export const registry = new Registry();
export const store = new IslandStore();

export function chatWidth(): number {
    const width = chatWidthDp || Dimensions.get("window").width - FALLBACK_GUTTER_DP;
    return Math.max(160, Math.min(MAX_WIDTH_DP, Math.floor(width)));
}

export const pipeline = new Pipeline({
    store,
    measure: (island, width) => measureNative(island.key, width),
    chatWidth,
    refresh: ids => hooks.refresh(ids),
    onError: (key, e) => hooks.log("warn", `Island ${key} failed`, e),
});

registry.onError = (id, e) => hooks.log("error", `Provider ${id} threw in match()`, e);
registry.onChange = () => hooks.refresh([]);

export function isAvailable() {
    return unavailable === null;
}

export function unavailableReason() {
    return unavailable;
}

export function setUnavailable(reason: string | null) {
    if (reason === unavailable) return;
    unavailable = reason;
    if (reason) hooks.log("warn", `Islands off: ${reason}`);
    for (const l of availabilityListeners) l();
    // Rows go back to Discord's embeds (or get islands)
    hooks.refresh([]);
}

export function onAvailabilityChange(listener: () => void) {
    availabilityListeners.add(listener);
    return () => availabilityListeners.delete(listener);
}

/** Reads the native status (at start and when native says it changed). */
export function checkNative() {
    status = nativeStatus();
    if (!status) setUnavailable("The native part isn't loaded (needs Valenced for Android with native plugin support)");
    else if (!status.ready) setUnavailable(status.reason ?? "The native part isn't ready");
    else setUnavailable(null);
    if (status?.chatWidth) chatWidthDp = status.chatWidth;
}

export function handleNativeEvents(events: NativeEvent[]) {
    for (const e of events) {
        switch (e.type) {
            case "attach":
            case "detach":
                store.update(e.key, { visible: e.type === "attach" });
                break;
            case "visible":
                store.update(e.key, { visible: e.visible });
                break;
            case "chatWidth":
                if (e.width > 0 && e.width !== chatWidthDp) {
                    chatWidthDp = e.width;
                    hooks.refresh([]);
                }
                break;
            case "status":
                status = e.status;
                setUnavailable(e.status.ready ? null : e.status.reason ?? "The native part stopped");
                break;
        }
    }
}

function useIsland(key: string) {
    const [, rerender] = useReducer((n: number) => n + 1, 0);
    useEffect(() => store.subscribe(key, rerender), [key]);
    return store.get(key);
}

export function useIslandVisible(key: string) {
    return useIsland(key)?.visible ?? false;
}

export function useIslandState<T>(key: string, name: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
    useIsland(key);
    const value = store.getState(key, name, initial);
    const set = (next: T | ((prev: T) => T)) => {
        const prev = store.getState(key, name, initial);
        store.setState(key, name, typeof next === "function" ? (next as (p: T) => T)(prev) : next);
    };
    return [value, set];
}

export { useIsland };

/** The API one dependent plugin gets. Its providers are removed when it stops. */
export function createApi(owner: string): { api: ChatIslandsApi; dispose(): void; } {
    const mine = new Set<IslandProvider<any>>();
    const api: ChatIslandsApi = {
        version: VERSION,
        register(provider) {
            const off = registry.register(owner, provider);
            mine.add(provider);
            return () => {
                off();
                mine.delete(provider);
                store.dropProvider(provider);
            };
        },
        isAvailable,
        unavailableReason,
        resize: key => pipeline.resize(key),
        useIslandVisible,
        useIslandState,
        openMessageMenu: message => hooks.openMessageMenu(message),
    };
    return {
        api,
        dispose() {
            registry.unregisterOwner(owner);
            for (const p of mine) store.dropProvider(p);
            mine.clear();
        },
    };
}
