/*
 * Providers (registered by dependent plugins) and which islands a message gets.
 * Pure logic, no Discord or React imports (tested in Node).
 */

import type { IslandMessage, IslandProvider, IslandSlot } from "./api";

export interface MatchedSlot {
    key: string;
    provider: IslandProvider<any>;
    slot: IslandSlot<any>;
}

interface Entry {
    provider: IslandProvider<any>;
    /** Plugin id of the dependent that registered it. */
    owner: string;
}

/** What makes a message's matches change: same signature → same slots. */
function signature(m: IslandMessage) {
    return `${m.content}\u0000${m.embeds.length}\u0000${m.embeds.map(e => e.url ?? "").join("\u0001")}\u0000${String(m.editedTimestamp ?? "")}`;
}

export const islandKey = (providerId: string, messageId: string, slotId: string) => `${providerId}:${messageId}:${slotId}`;

export class Registry {
    private readonly entries = new Map<string, Entry>();
    private readonly matches = new Map<string, { sig: string; slots: MatchedSlot[]; }>();
    private readonly maxMatches: number;
    /** Called when providers change (rows must be regenerated). */
    onChange?: () => void;
    /** Called when a provider's match throws. */
    onError?: (providerId: string, error: unknown) => void;

    constructor(maxMatches = 2000) {
        this.maxMatches = maxMatches;
    }

    get size() {
        return this.entries.size;
    }

    provider(id: string): IslandProvider<any> | undefined {
        return this.entries.get(id)?.provider;
    }

    register(owner: string, provider: IslandProvider<any>): () => void {
        if (!provider?.id || typeof provider.match !== "function" || !provider.component) {
            throw new TypeError("Chat Islands: a provider needs id, match and component");
        }
        if (this.entries.has(provider.id)) throw new Error(`Chat Islands: provider "${provider.id}" is already registered`);
        this.entries.set(provider.id, { provider, owner });
        this.matches.clear();
        this.onChange?.();
        return () => {
            if (this.entries.get(provider.id)?.provider !== provider) return;
            this.entries.delete(provider.id);
            this.matches.clear();
            this.onChange?.();
        };
    }

    /** Removes everything a plugin registered (when it stops). */
    unregisterOwner(owner: string) {
        let changed = false;
        for (const [id, e] of this.entries) {
            if (e.owner === owner) {
                this.entries.delete(id);
                changed = true;
            }
        }
        if (changed) {
            this.matches.clear();
            this.onChange?.();
        }
    }

    /** The islands for a message, memoized per message while its content and embeds don't change. */
    slotsFor(message: IslandMessage): MatchedSlot[] {
        if (!this.entries.size || !message?.id) return [];
        const sig = signature(message);
        const cached = this.matches.get(message.id);
        if (cached && cached.sig === sig) return cached.slots;
        const slots: MatchedSlot[] = [];
        const taken = new Set<number>();
        for (const { provider } of this.entries.values()) {
            let found: IslandSlot<any>[] | null = null;
            try {
                found = provider.match(message);
            } catch (e) {
                this.onError?.(provider.id, e);
            }
            for (const slot of found ?? []) {
                // One island per embed: the first provider wins
                const at = slot.replacesEmbed;
                if (at !== null && (at < 0 || at >= message.embeds.length || taken.has(at))) continue;
                if (at !== null) taken.add(at);
                slots.push({ key: islandKey(provider.id, message.id, slot.id), provider, slot });
            }
        }
        this.matches.delete(message.id);
        this.matches.set(message.id, { sig, slots });
        if (this.matches.size > this.maxMatches) this.matches.delete(this.matches.keys().next().value!);
        return slots;
    }
}
