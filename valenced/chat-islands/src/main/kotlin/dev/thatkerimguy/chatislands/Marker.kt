package dev.thatkerimguy.chatislands

import java.net.URLDecoder

/**
 * The placeholder URL format, shared with js/marker.ts:
 * `https://chat-islands.invalid/i/<url-encoded key>?w=<dp>&h=<dp>` (Discord may append parameters).
 */
data class Marker(val key: String, val widthDp: Int, val heightDp: Int) {
    companion object {
        const val PREFIX = "https://chat-islands.invalid/i/"
        private val PATTERN = Regex("""^([^?#/]+)\?(?:.*&)?w=(\d+)&h=(\d+)""")

        fun isMarker(url: String?): Boolean = url != null && url.startsWith(PREFIX)

        fun decode(url: String?): Marker? {
            if (!isMarker(url)) return null
            val m = PATTERN.find(url!!.substring(PREFIX.length)) ?: return null
            return try {
                Marker(
                    URLDecoder.decode(m.groupValues[1], "UTF-8"),
                    m.groupValues[2].toInt(),
                    m.groupValues[3].toInt(),
                )
            } catch (_: Exception) {
                null
            }
        }
    }
}
