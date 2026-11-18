package dev.thatkerimguy.chatislands

import android.view.View
import app.valenced.plugins.PluginScope
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import de.robv.android.xposed.XposedHelpers
import java.lang.reflect.Method
import java.util.Collections
import java.util.WeakHashMap

/**
 * Notices when an image view in the app is given an island marker URL.
 *
 * Discord's native chat loads images with Fresco: a controller is built from an image request
 * (AbstractDraweeControllerBuilder.build) and set on a DraweeView (setController). The builder
 * hook remembers which controllers carry a marker; the setController hook then tells [Hosts]
 * which view shows which island, and when a reused view goes back to a normal image.
 *
 * Phase 0 checks that Discord's chat uses these classes under these names (Fresco's public
 * API; RN keeps it). If not, [failure] says what's missing and islands stay off.
 */
class MarkerHook(private val scope: PluginScope) {
    var failure: String? = null
        private set

    private val unhooks = mutableListOf<XC_MethodHook.Unhook>()

    /** Controller → marker URL, for controllers built from a marker request. */
    private val markerControllers: MutableMap<Any, String> = Collections.synchronizedMap(WeakHashMap())

    private val requestGetter = Collections.synchronizedMap(HashMap<Class<*>, Method?>())
    private val uriGetter = Collections.synchronizedMap(HashMap<Class<*>, Method?>())

    fun install(): Boolean {
        val cl = scope.classLoader
        val builderClass = XposedHelpers.findClassIfExists(BUILDER, cl)
            ?: runCatching {
                scope.dexFinder.findClass { matcher { usingStrings(BUILDER_STRING) } }
            }.getOrNull()
        val draweeView = XposedHelpers.findClassIfExists(DRAWEE_VIEW, cl)
        if (builderClass == null) return fail("Fresco's controller builder not found")
        if (draweeView == null) return fail("Fresco's DraweeView not found")

        val build = generateSequence(builderClass) { it.superclass }
            .flatMap { it.declaredMethods.asSequence() }
            .firstOrNull { it.name == "build" && it.parameterTypes.isEmpty() }
            ?: return fail("${builderClass.name}.build() not found")
        val setController = draweeView.methods.firstOrNull { it.name == "setController" && it.parameterTypes.size == 1 }
            ?: return fail("DraweeView.setController not found")

        unhooks += XposedBridge.hookMethod(build, object : XC_MethodHook() {
            override fun afterHookedMethod(param: MethodHookParam) {
                val controller = param.result ?: return
                val url = markerUrlOf(param.thisObject) ?: return
                markerControllers[controller] = url
            }
        })

        unhooks += XposedBridge.hookMethod(setController, object : XC_MethodHook() {
            override fun afterHookedMethod(param: MethodHookParam) {
                val view = param.thisObject as? View ?: return
                val controller = param.args[0]
                val marker = if (controller == null) null else markerControllers[controller]?.let(Marker::decode)
                // Most images aren't islands: only views that are or were hosts need work
                if (marker == null && !Hosts.isHosting(view)) return
                Hosts.onBound(view, marker)
            }
        })
        scope.log.i("Hooked ${builderClass.name}.build and ${draweeView.name}.setController")
        return true
    }

    fun uninstall() {
        unhooks.forEach { it.unhook() }
        unhooks.clear()
        markerControllers.clear()
    }

    private fun fail(reason: String): Boolean {
        failure = reason
        scope.log.w(reason)
        return false
    }

    /** The builder's image request's source URI, when it is a marker (cheap for everything else). */
    private fun markerUrlOf(builder: Any): String? {
        val request = getter(requestGetter, builder.javaClass, "getImageRequest")?.invoke(builder) ?: return null
        val uri = getter(uriGetter, request.javaClass, "getSourceUri")?.invoke(request) ?: return null
        val url = uri.toString()
        return if (Marker.isMarker(url)) url else null
    }

    private fun getter(cache: MutableMap<Class<*>, Method?>, cls: Class<*>, name: String): Method? =
        cache.getOrPut(cls) {
            runCatching { cls.getMethod(name).apply { isAccessible = true } }.getOrNull()
        }

    companion object {
        const val BUILDER = "com.facebook.drawee.controller.AbstractDraweeControllerBuilder"
        const val DRAWEE_VIEW = "com.facebook.drawee.view.DraweeView"
        /** A string only that builder uses, for finding it if R8 renamed it. */
        const val BUILDER_STRING = "Cannot specify both ImageRequest and FirstAvailableImageRequests!"
    }
}
