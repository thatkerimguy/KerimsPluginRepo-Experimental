package dev.thatkerimguy.chatislands

import java.net.URLDecoder

/**
 * The placeholder URL format, shared with js/marker.ts:
 * `https://chat-islands.invalid/i/<url-encoded key>?w=<dp>&h=<dp>` (Discord adds parameters and may
 * reorder them, so w and h are read wherever they are).
 */
data class Marker(val key: String, val widthDp: Int, val heightDp: Int) {
    companion object {
        const val PREFIX = "https://chat-islands.invalid/i/"
        private val PATTERN = Regex("""^([^?#/]+)\?([^#]*)""")
        private val WIDTH = Regex("""(?:^|&)w=(\d+)(?:&|$)""")
        private val HEIGHT = Regex("""(?:^|&)h=(\d+)(?:&|$)""")

        fun isMarker(url: String?): Boolean = url != null && url.startsWith(PREFIX)

        fun decode(url: String?): Marker? {
            if (!isMarker(url)) return null
            val m = PATTERN.find(url!!.substring(PREFIX.length)) ?: return null
            val query = m.groupValues[2]
            val w = WIDTH.find(query) ?: return null
            val h = HEIGHT.find(query) ?: return null
            return try {
                Marker(
                    URLDecoder.decode(m.groupValues[1], "UTF-8"),
                    w.groupValues[1].toInt(),
                    h.groupValues[1].toInt(),
                )
            } catch (_: Exception) {
                null
            }
        }
    }
}
