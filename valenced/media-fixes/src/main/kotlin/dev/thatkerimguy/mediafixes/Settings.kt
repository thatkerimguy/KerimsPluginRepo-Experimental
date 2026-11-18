package dev.thatkerimguy.mediafixes

import org.json.JSONObject
import java.io.File

/**
 * The plugin's settings, kept by the native part (the hooks read them on every call, and the
 * JS settings page changes them through the bridge). Saved as JSON in the plugin's storage.
 */
object Settings {
    /** Turn decoder fallback on, skip hardware decoders that failed, retry instead of sound only. */
    @Volatile var decoderFix = true
    /** No Discord player may start while Discord isn't on screen; pause them when it leaves. */
    @Volatile var backgroundGuard = true
    /** Starting a video with sound pauses the others that have sound. */
    @Volatile var oneAtATime = true
    /** Short messages when a video had to switch decoders or can't be shown. */
    @Volatile var toasts = true

    val KEYS = listOf("decoderFix", "backgroundGuard", "oneAtATime", "toasts")

    private var file: File? = null

    fun load(f: File) {
        file = f
        runCatching {
            if (!f.exists()) return
            val o = JSONObject(f.readText())
            decoderFix = o.optBoolean("decoderFix", decoderFix)
            backgroundGuard = o.optBoolean("backgroundGuard", backgroundGuard)
            oneAtATime = o.optBoolean("oneAtATime", oneAtATime)
            toasts = o.optBoolean("toasts", toasts)
        }.onFailure { Log.event("Couldn't read the settings, using the defaults: $it") }
    }

    fun asMap(): Map<String, Any?> = mapOf(
        "decoderFix" to decoderFix,
        "backgroundGuard" to backgroundGuard,
        "oneAtATime" to oneAtATime,
        "toasts" to toasts,
    )

    /** Changes one setting; false for an unknown key. */
    fun set(key: String, value: Boolean): Boolean {
        when (key) {
            "decoderFix" -> decoderFix = value
            "backgroundGuard" -> backgroundGuard = value
            "oneAtATime" -> oneAtATime = value
            "toasts" -> toasts = value
            else -> return false
        }
        save()
        return true
    }

    private fun save() {
        val f = file ?: return
        runCatching {
            f.parentFile?.mkdirs()
            f.writeText(JSONObject(asMap()).toString())
        }.onFailure { Log.event("Couldn't save the settings: $it") }
    }
}
