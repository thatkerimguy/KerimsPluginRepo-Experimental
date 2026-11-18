/*
 * Chat Islands public API: what a dependent plugin gets as `chatIslands` in its
 * plugin API (start({ chatIslands })). Semver with the manifest version: a
 * breaking change here bumps the major version.
 */

import type { ComponentType } from "react";

/** The parts of a Discord message record islands read. Never modify it. */
export interface IslandMessage {
    id: string;
    channel_id: string;
    content: string;
    embeds: readonly IslandEmbed[];
    author?: { id?: string; bot?: boolean; };
    editedTimestamp?: unknown;
}

/** A Discord embed record (mobile: camelCase fields such as rawTitle, proxyURL). */
export interface IslandEmbed {
    id?: string;
    type?: string;
    url?: string;
    [field: string]: unknown;
}

export interface IslandSlot<D = unknown> {
    /** Stable id within the message (e.g. the link it is for). */
    id: string;
    /** Index of the Discord embed this island replaces, or null to add it after the embeds. */
    replacesEmbed: number | null;
    /** Provider data (e.g. a parsed link). Must be cheap to keep. */
    data: D;
}

export interface IslandProps<D = unknown> {
    islandKey: string;
    slot: IslandSlot<D>;
    message: IslandMessage;
    /** Width available, in density-independent pixels. */
    width: number;
    /** True while rendered off screen to measure its height: skip autoplay and animations. */
    measuring: boolean;
}

export interface IslandProvider<D = unknown> {
    /** Unique id, e.g. "social-embeds". */
    id: string;
    /**
     * Which islands a message gets. Called during chat row generation: must be fast, synchronous,
     * without I/O, and return the same slots for the same message.
     */
    match(message: IslandMessage): IslandSlot<D>[] | null;
    /**
     * Loads what the island needs before it is shown (fetches, cache). Until it resolves the message
     * keeps Discord's own embed. Rejecting keeps Discord's embed for good (for this message).
     */
    prepare?(slot: IslandSlot<D>, message: IslandMessage): Promise<void>;
    /** The React Native component drawn inside the chat row. */
    component: ComponentType<IslandProps<D>>;
}

export interface ChatIslandsApi {
    /** Library version (the manifest version). */
    readonly version: string;
    /** Adds a provider. Returns a function that removes it (also done when the dependent plugin stops). */
    register<D>(provider: IslandProvider<D>): () => void;
    /** Whether islands can be shown right now (the native part is working on this Discord version). */
    isAvailable(): boolean;
    /** Why islands are off, when they are. */
    unavailableReason(): string | null;
    /** Measures an island again (its content changed size) and updates its row. */
    resize(islandKey: string): void;
    /** Hook: whether the island is on screen (for pausing video and animations). */
    useIslandVisible(islandKey: string): boolean;
    /**
     * Hook: state that survives the island's view being reused while scrolling (carousel position, expanded parts).
     * Kept per island for the session.
     */
    useIslandState<T>(islandKey: string, name: string, initial: T): [T, (next: T | ((prev: T) => T)) => void];
    /** Opens Discord's long-press menu for the message (for islands that handle long press themselves). */
    openMessageMenu(message: IslandMessage): void;
}
