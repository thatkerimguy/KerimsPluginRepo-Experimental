/*
 * Island bookkeeping: each island's phase (preparing → measuring → ready, or
 * failed), its measured size, its state that survives view reuse, and whether
 * it's on screen. Pure logic (tested in Node); React hooks read it through
 * subscribe().
 */

import type { IslandMessage, IslandProvider, IslandSlot } from "./api";

export type Phase = "new" | "preparing" | "measuring" | "ready" | "failed";

export interface Island {
    key: string;
    provider: IslandProvider<any>;
    slot: IslandSlot<any>;
    message: IslandMessage;
    phase: Phase;
    /** Measured size in dp (ready islands). */
    width?: number;
    height?: number;
    error?: unknown;
    /** Session state for useIslandState. */
    state: Map<string, unknown>;
    visible: boolean;
}

type Listener = () => void;

export class IslandStore {
    private readonly islands = new Map<string, Island>();
    private readonly listeners = new Map<string, Set<Listener>>();
    private readonly max: number;

    constructor(max = 3000) {
        this.max = max;
    }

    get size() {
        return this.islands.size;
    }

    get(key: string): Island | undefined {
        return this.islands.get(key);
    }

    /** The island for a matched slot, created if new. A changed message (edited) starts it over. */
    ensure(key: string, provider: IslandProvider<any>, slot: IslandSlot<any>, message: IslandMessage): Island {
        let island = this.islands.get(key);
        if (island && island.provider === provider) {
            if (island.message !== message) {
                const edited = island.message.content !== message.content || island.message.embeds.length !== message.embeds.length;
                island.message = message;
                island.slot = slot;
                if (edited && island.phase !== "preparing" && island.phase !== "measuring") {
                    island.phase = "new";
                    island.height = undefined;
                    island.width = undefined;
                    island.error = undefined;
                }
            }
            return island;
        }
        island = { key, provider, slot, message, phase: "new", state: new Map(), visible: false };
        this.islands.set(key, island);
        if (this.islands.size > this.max) this.evict();
        return island;
    }

    /** Drops the oldest islands that aren't on screen. */
    private evict() {
        for (const [key, island] of this.islands) {
            if (this.islands.size <= this.max * 0.9) break;
            if (!island.visible && island.phase !== "preparing" && island.phase !== "measuring") this.islands.delete(key);
        }
    }

    update(key: string, change: Partial<Pick<Island, "phase" | "width" | "height" | "error" | "visible">>) {
        const island = this.islands.get(key);
        if (!island) return;
        Object.assign(island, change);
        this.emit(key);
    }

    getState<T>(key: string, name: string, initial: T): T {
        const island = this.islands.get(key);
        return island && island.state.has(name) ? (island.state.get(name) as T) : initial;
    }

    setState<T>(key: string, name: string, value: T) {
        const island = this.islands.get(key);
        if (!island || island.state.get(name) === value) return;
        island.state.set(name, value);
        this.emit(key);
    }

    /** Forgets every island of a provider (it was unregistered). */
    dropProvider(provider: IslandProvider<any>) {
        for (const [key, island] of this.islands) if (island.provider === provider) this.islands.delete(key);
    }

    clear() {
        this.islands.clear();
    }

    subscribe(key: string, listener: Listener): () => void {
        let set = this.listeners.get(key);
        if (!set) this.listeners.set(key, set = new Set());
        set.add(listener);
        return () => {
            set!.delete(listener);
            if (!set!.size) this.listeners.delete(key);
        };
    }

    private emit(key: string) {
        for (const l of this.listeners.get(key) ?? []) l();
    }
}
