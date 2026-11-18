@file:JvmName("ChatIslands")

package dev.thatkerimguy.chatislands

import app.valenced.plugins.plugin

/**
 * Chat Islands, native part (Android). Loaded before the JS bundle.
 *
 * - [MediaViewHook] notices when Discord's chat binds an island placeholder (an image embed whose
 *   URL is a chat-islands.invalid marker, see js/marker.ts) and [Hosts] puts an [IslandHost] on it.
 * - [SurfacePool] / [ReactSurfaces] give hosts React surfaces running the JS module "ChatIsland" (js/root.tsx).
 * - [Runtime] answers the JS side (status, measuring, logging) and sends it events.
 *
 * Phase 0 spike: the hook point and the surface API are checked on a device; [Runtime.status]
 * says what was found, and everything that fails leaves Discord's own embeds in place.
 */
@Suppress("UNUSED")
val chatIslands = plugin {
    start {
        Runtime.start(this)
    }
    stop {
        Runtime.stop()
    }
}
