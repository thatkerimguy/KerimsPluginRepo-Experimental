/*
 * The message as the chat row generator sees it: the same record, with the
 * embeds that ready islands replace swapped for placeholders. Built per row
 * generation and never stored, so Discord's data stays untouched.
 */

import type { IslandEmbed, IslandMessage } from "./api";
import { placeholderEmbed } from "./marker";

export interface ReadyIsland {
    key: string;
    replacesEmbed: number | null;
    width: number;
    height: number;
}

/**
 * A view of `message` with island placeholders. Uses the message as prototype, so every other
 * field and method (and `instanceof`) reads through to the real record.
 */
export function displayMessage<M extends IslandMessage>(message: M, ready: readonly ReadyIsland[]): M {
    if (!ready.length) return message;
    const embeds: IslandEmbed[] = [...message.embeds];
    const appended: IslandEmbed[] = [];
    for (const island of ready) {
        const placeholder = placeholderEmbed({ key: island.key, width: island.width, height: island.height });
        if (island.replacesEmbed !== null && island.replacesEmbed < embeds.length) embeds[island.replacesEmbed] = placeholder;
        else appended.push(placeholder);
    }
    return Object.create(message, {
        embeds: { value: [...embeds, ...appended], enumerable: true },
    }) as M;
}
