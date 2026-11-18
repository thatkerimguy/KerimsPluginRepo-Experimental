/*
 * Chat Islands for Valenced (plugin id thatkerimguy.chat-islands)
 *
 * A library: lets dependent plugins draw React Native components ("islands")
 * inside Discord's native mobile chat. A dependent lists this plugin under
 * `dependencies` in its manifest and gets `chatIslands` (api.ts) in its plugin API:
 *
 *     start({ chatIslands, cleanup }) {
 *         cleanup(chatIslands.register({ id: "my-islands", match, prepare, component }))
 *     }
 *
 * The native part (src/main/kotlin) shows each island where its placeholder is
 * drawn. Without it, or when it can't find its hook on this Discord version,
 * messages keep Discord's own embeds. See SOCIAL_EMBEDS_PLAN.md (section 4).
 */

import { demoProvider } from "./demo";
import { applyPatches } from "./discord";
import { cancelAllMeasuring } from "./measure";
import { onNativeEvents } from "./native";
import { registerRoot } from "./root";
import { checkNative, createApi, handleNativeEvents, hooks, isAvailable, registry, setUnavailable, store, unavailableReason } from "./runtime";
import { failed, resetParts, works } from "./status";

export default plugin({
    init({ decorate }) {
        // Every dependent gets its own API object; its providers go away when it stops
        decorate(dependent => {
            const { api, dispose } = createApi(dependent.manifest.id);
            (dependent.api as unknown as Record<string, unknown>).chatIslands = api;
            return () => {
                dispose();
                delete (dependent.api as unknown as Record<string, unknown>).chatIslands;
            };
        });
    },

    start({ cleanup, logger, plugin: self }) {
        // Patching a chat that's already on screen only half works
        if (self.startedLate) {
            self.requireReload();
            return;
        }
        hooks.log = (level, ...args) => logger[level]?.(...args);
        registerRoot();
        onNativeEvents(handleNativeEvents, e => hooks.log("error", "Native event handling failed", e));
        checkNative();
        if (isAvailable()) works("native");
        else failed("native", unavailableReason() ?? "unknown");
        applyPatches(cleanup);
        // The test island (demo.tsx): messages containing "[island test]"
        cleanup(registry.register("thatkerimguy.chat-islands", demoProvider));
        cleanup(() => {
            cancelAllMeasuring();
            store.clear();
            setUnavailable("Stopped");
            resetParts();
            hooks.log = () => { };
        });
    },

    stop({ plugin: self }) {
        self.requireReload();
    },
});
