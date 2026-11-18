package dev.thatkerimguy.chatislands

import android.view.View
import android.view.ViewGroup
import app.valenced.plugins.PluginScope
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import de.robv.android.xposed.XposedHelpers
import java.lang.reflect.Field
import java.lang.reflect.Modifier
import java.util.Collections

/**
 * The main way islands find their placeholder (since 0.1.0.23): Discord's chat MediaView.
 *
 * Discord 352.6 (EmbedView's bind read with Vineflower; jadx can't decompile it): an Image
 * embed's media goes to the static `MediaView.f(view, source, …)`, `source` being a media source
 * (od.c0) whose `previewUrl` is the embed image's proxyURL, our marker. The device log showed
 * that call arriving with the marker, but the Fresco build() carrying it was never seen
 * ([MarkerHook] stays as a fallback). The marker is read from the source's String fields,
 * so no field names are needed; MediaView keeps its class name (layouts and Kotlin metadata).
 *
 * The placeholder view is MediaView's first child (its preview image, `inline_media_image_preview`);
 * MediaView is a FrameLayout, so [Hosts] can put the island next to it.
 */
class MediaViewHook(private val scope: PluginScope) {
    var failure: String? = null
        private set

    private val stringFields = Collections.synchronizedMap(HashMap<Class<*>, List<Field>>())

    fun install(): Boolean {
        val mediaView = XposedHelpers.findClassIfExists(MEDIA_VIEW, scope.classLoader)
            ?: return fail("MediaView not found")
        val show = mediaView.declaredMethods.firstOrNull {
            Modifier.isStatic(it.modifiers) && it.parameterTypes.size > 15 && it.parameterTypes[0] == mediaView
        } ?: return fail("MediaView's static bind not found")

        XposedBridge.hookMethod(show, object : XC_MethodHook() {
            override fun afterHookedMethod(param: MethodHookParam) {
                if (!Runtime.active) return
                try {
                    val view = param.args[0] as? ViewGroup ?: return
                    val preview = view.getChildAt(0) ?: return
                    val url = markerIn(param.args[1])
                    val marker = url?.let(Marker::decode)
                    if (url != null) Runtime.diag("MediaView bound to marker ${marker?.key ?: "(couldn't decode $url)"}", key = true)
                    if (marker == null && !Hosts.isHosting(preview)) return
                    Hosts.onBound(preview, marker)
                } catch (e: Throwable) {
                    scope.log.w("MediaView hook failed", e)
                    DiagLog.line("MediaView hook failed: ${e.stackTraceToString()}")
                }
            }
        })
        scope.log.i("Hooked ${mediaView.simpleName}.${show.name}")
        DiagLog.line("Hooked ${mediaView.simpleName}.${show.name}")
        return true
    }

    /** The marker URL among the media source's String fields (previewUrl), or null. */
    private fun markerIn(source: Any?): String? {
        source ?: return null
        val fields = stringFields.getOrPut(source.javaClass) {
            generateSequence<Class<*>>(source.javaClass) { it.superclass }
                .takeWhile { it != Any::class.java }
                .flatMap { it.declaredFields.asSequence() }
                .filter { !Modifier.isStatic(it.modifiers) && it.type == String::class.java }
                .onEach { it.isAccessible = true }
                .toList()
        }
        for (f in fields) {
            val v = f.get(source) as? String ?: continue
            if (Marker.isMarker(v)) return v
        }
        return null
    }

    private fun fail(reason: String): Boolean {
        failure = reason
        scope.log.w(reason)
        DiagLog.line("MediaView hook: $reason")
        return false
    }

    private companion object {
        const val MEDIA_VIEW = "com.discord.chat.presentation.message.view.MediaView"
    }
}
