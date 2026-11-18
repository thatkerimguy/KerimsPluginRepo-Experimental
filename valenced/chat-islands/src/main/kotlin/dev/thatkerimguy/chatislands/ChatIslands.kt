@file:JvmName("ChatIslands")

package dev.thatkerimguy.chatislands

import app.valenced.plugins.plugin

/**
 * Chat Islands, native part (Android). Loaded before the JS bundle.
 *
 * - [MarkerHook] notices when Discord's chat draws an island placeholder (an image whose URL
 *   is a chat-islands.invalid marker, see js/marker.ts) and puts an [IslandHost] in its place.
 * - [SurfacePool] gives hosts React surfaces running the JS module "ChatIsland" (js/root.tsx).
 * - [Bridge] answers the JS side (status, measuring) and sends it events.
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
