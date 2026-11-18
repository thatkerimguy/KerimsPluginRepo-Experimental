/*
 * The Discord mobile modules Chat Islands touches (paths checked against
 * discord-mobile-datamining, tests/patches/mobile-modules.test.ts):
 *
 * - MessageWithContent.generateMessageRowData: builds a message's chat row. Before it
 *   runs, ready islands' embeds are swapped for placeholders (display.ts).
 * - useRowManager: the chat's row manager hook; its updateRows regenerates rows
 *   (updateMessageIds for some messages, forceRender for all).
 * - showLongPressMessageActionSheet: Discord's message menu.
 */

import { getModuleWithImportedPath } from "@valenced/discord/utils/modules/finders";
import { after, before } from "@valenced/patcher";

import type { IslandMessage } from "./api";
import { displayMessage } from "./display";
import { failed, works } from "./status";
import { hooks, isAvailable, pipeline, registry } from "./runtime";

const ROW_DATA_PATH = "modules/messages/native/renderer/MessageWithContent.tsx";
const ROW_MANAGER_PATH = "modules/messages/native/hooks/useRowManager.tsx";
const LONG_PRESS_PATH = "modules/messages/native/long_press/showLongPressMessageActionSheet.tsx";

type UpdateRows = (opts?: { updateMessageIds?: Set<string>; forceRender?: boolean; }) => void;

interface RowArgs {
    message?: IslandMessage;
    [field: string]: unknown;
}

type GenerateRow = (row: RowArgs, options: unknown, theme: unknown) => unknown;

/** The most recently rendered chat's updateRows (the chat on screen). */
let updateRows: UpdateRows | null = null;

function refresh(ids: string[]) {
    const update = updateRows;
    if (!update) return;
    try {
        if (ids.length) update({ updateMessageIds: new Set(ids) });
        else update({ forceRender: true });
    } catch (e) {
        hooks.log("warn", "updateRows failed", e);
    }
}

export function applyPatches(cleanup: (...fns: (() => unknown)[]) => void) {
    hooks.refresh = refresh;

    cleanup(
        getModuleWithImportedPath<{ generateMessageRowData: GenerateRow; }>(ROW_DATA_PATH, mod => {
            if (typeof mod?.generateMessageRowData !== "function") {
                failed("rows", "MessageWithContent.generateMessageRowData not found");
                return;
            }
            cleanup(before(mod, "generateMessageRowData", args => {
                const row = args[0];
                const message = row?.message;
                if (!message?.id || !Array.isArray(message.embeds) || !isAvailable()) return args;
                works("rows");
                try {
                    const slots = registry.slotsFor(message);
                    if (!slots.length) return args;
                    const ready = pipeline.collect(slots, message);
                    if (!ready.length) return args;
                    // A new row argument object: the caller's one is left as it was
                    return [{ ...row, message: displayMessage(message, ready) }, args[1], args[2]] as typeof args;
                } catch (e) {
                    hooks.log("error", "Island row patch failed", e);
                    return args;
                }
            }));
        }),

        getModuleWithImportedPath<{ default: (...args: unknown[]) => { updateRows?: UpdateRows; }; }>(ROW_MANAGER_PATH, mod => {
            if (typeof mod?.default !== "function") {
                failed("rowManager", "useRowManager not found");
                return;
            }
            cleanup(after(mod, "default", result => {
                if (typeof result?.updateRows === "function") {
                    updateRows = result.updateRows;
                    works("rowManager");
                }
                return result;
            }));
        }),

        getModuleWithImportedPath<{ default?: (...args: unknown[]) => unknown; showLongPressMessageActionSheet?: (...args: unknown[]) => unknown; }>(LONG_PRESS_PATH, mod => {
            const show = mod?.default ?? mod?.showLongPressMessageActionSheet;
            if (typeof show !== "function") {
                failed("longPress", "showLongPressMessageActionSheet not found");
                return;
            }
            works("longPress");
            hooks.openMessageMenu = message => {
                try {
                    show({ message, channelId: message.channel_id });
                } catch (e) {
                    hooks.log("warn", "Couldn't open the message menu", e);
                }
            };
        }),

        () => {
            hooks.refresh = () => { };
            hooks.openMessageMenu = () => { };
            updateRows = null;
        },
    );
}
