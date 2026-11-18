/*
 * Getting islands ready, off the row generation path: prepare (the provider's
 * fetch) → measure (rendered off screen at the chat width) → ready, then the
 * message's row is regenerated once with the placeholder at the final size.
 * A few at a time, newest request first (what was just scrolled to).
 * Pure logic with injected platform parts (tested in Node).
 */

import type { ReadyIsland } from "./display";
import type { MatchedSlot } from "./registry";
import type { Island, IslandStore } from "./store";

export interface PipelineDeps {
    store: IslandStore;
    /** Renders the island off screen at `width` dp and resolves with its height in dp. */
    measure(island: Island, width: number): Promise<number>;
    /** The width islands get, in dp. */
    chatWidth(): number;
    /** Regenerates the rows of these messages. */
    refresh(messageIds: string[]): void;
    /** Reports a provider failure (logging). */
    onError?(key: string, error: unknown): void;
    /** Islands prepared at once. */
    concurrency?: number;
}

/** Islands shorter than this are treated as failed measurements. */
const MIN_HEIGHT = 8;
/** Tallest island, dp (a guard against runaway layouts). */
export const MAX_HEIGHT = 4000;

export class Pipeline {
    private readonly deps: PipelineDeps;
    private readonly queue: string[] = [];
    private running = 0;
    private readonly pendingRefresh = new Set<string>();
    private refreshScheduled = false;

    constructor(deps: PipelineDeps) {
        this.deps = deps;
    }

    /**
     * Called for each matched slot while a row is generated. Returns the ready islands' placeholders;
     * starts preparing the others.
     */
    collect(slots: readonly MatchedSlot[], message: Island["message"]): ReadyIsland[] {
        const ready: ReadyIsland[] = [];
        const width = this.deps.chatWidth();
        for (const s of slots) {
            const island = this.deps.store.ensure(s.key, s.provider, s.slot, message);
            if (island.phase === "ready" && island.width === width && island.height) {
                ready.push({ key: island.key, replacesEmbed: island.slot.replacesEmbed, width, height: island.height });
            } else if (island.phase === "ready") {
                // The chat width changed (rotation, split screen): measure again, keep the old size meanwhile
                if (island.height && island.width) ready.push({ key: island.key, replacesEmbed: island.slot.replacesEmbed, width: island.width, height: island.height });
                this.enqueue(island.key, true);
            } else if (island.phase === "new") {
                this.enqueue(island.key);
            }
        }
        return ready;
    }

    /** Measures an island again (its content changed size). */
    resize(key: string) {
        const island = this.deps.store.get(key);
        if (island && island.phase === "ready") this.enqueue(key, true);
    }

    private enqueue(key: string, remeasure = false) {
        const island = this.deps.store.get(key);
        if (!island || this.queue.includes(key)) return;
        if (!remeasure) this.deps.store.update(key, { phase: "preparing" });
        // Newest first: the rows generated last are the ones being looked at
        this.queue.unshift(key);
        this.pump();
    }

    private pump() {
        const max = this.deps.concurrency ?? 2;
        while (this.running < max && this.queue.length) {
            const key = this.queue.shift()!;
            this.running++;
            this.run(key).finally(() => {
                this.running--;
                this.pump();
            });
        }
    }

    private async run(key: string) {
        const { store } = this.deps;
        const island = store.get(key);
        if (!island) return;
        const remeasure = island.phase === "ready";
        try {
            if (!remeasure) await island.provider.prepare?.(island.slot, island.message);
            // The provider may have been removed meanwhile
            if (store.get(key) !== island) return;
            if (!remeasure) store.update(key, { phase: "measuring" });
            const width = this.deps.chatWidth();
            const height = Math.min(MAX_HEIGHT, Math.ceil(await this.deps.measure(island, width)));
            if (!(height >= MIN_HEIGHT)) throw new Error(`Measured height ${height}`);
            if (remeasure && island.width === width && island.height === height) return;
            store.update(key, { phase: "ready", width, height });
            this.scheduleRefresh(island.message.id);
        } catch (e) {
            if (remeasure) return; // keep the old size
            store.update(key, { phase: "failed", error: e });
            this.deps.onError?.(key, e);
        }
    }

    /** One row update per frame for all islands that became ready in it. */
    private scheduleRefresh(messageId: string) {
        this.pendingRefresh.add(messageId);
        if (this.refreshScheduled) return;
        this.refreshScheduled = true;
        const flush = () => {
            this.refreshScheduled = false;
            const ids = [...this.pendingRefresh];
            this.pendingRefresh.clear();
            if (ids.length) this.deps.refresh(ids);
        };
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(flush);
        else setTimeout(flush, 16);
    }
}
