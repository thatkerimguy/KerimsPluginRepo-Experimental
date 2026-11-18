package dev.thatkerimguy.chatislands

import android.net.Uri
import android.view.View
import app.valenced.plugins.PluginScope
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import de.robv.android.xposed.XposedHelpers
import java.lang.reflect.Field
import java.lang.reflect.Method
import java.lang.reflect.Modifier
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
 * Checked against Discord 352.6 (decompiled): chat's MediaView (a FrameLayout) loads its
 * SimpleDraweeView with `getControllerBuilder()`, sets the request, `build()`, `setController`.
 * R8 renamed the rest of Fresco, so classes and fields are found from SimpleDraweeView by shape.
 * If something is missing, [failure] says what and islands stay off.
 */
class MarkerHook(private val scope: PluginScope) {
    var failure: String? = null
        private set

    private val unhooks = mutableListOf<XC_MethodHook.Unhook>()
    @Volatile private var sawBuild = false
    @Volatile private var sawSetController = false
    /** Diagnostics: the URL of the last build() (main thread), for setController logging. */
    @Volatile private var lastBuildUrl: String? = null
    private var noRequestLogs = 0
    private var urlLogs = 0

    /** Controller → marker URL, for controllers built from a marker request. */
    private val markerControllers: MutableMap<Any, String> = Collections.synchronizedMap(WeakHashMap())

    private val requestGetter = Collections.synchronizedMap(HashMap<Class<*>, Method?>())
    private val uriGetter = Collections.synchronizedMap(HashMap<Class<*>, Method?>())

    fun install(): Boolean {
        val cl = scope.classLoader
        // Discord's R8 renames most of Fresco (352.6: DraweeView is pj.a, the builder ij.f with
        // AbstractDraweeControllerBuilder merged in). SimpleDraweeView keeps its name (layouts
        // name it), so everything else is found from it by shape.
        val simple = XposedHelpers.findClassIfExists(SIMPLE_DRAWEE_VIEW, cl)
        val draweeView = XposedHelpers.findClassIfExists(DRAWEE_VIEW, cl)
            ?: simple?.let { s ->
                generateSequence<Class<*>>(s) { it.superclass }.firstOrNull { c ->
                    c.declaredMethods.any { it.name == "setController" && it.parameterTypes.size == 1 }
                }
            }
            ?: return fail("Fresco's DraweeView not found")
        val setController = draweeView.methods.firstOrNull { it.name == "setController" && it.parameterTypes.size == 1 }
            ?: return fail("DraweeView.setController not found")
        val controllerType = setController.parameterTypes[0]

        val builderClass = XposedHelpers.findClassIfExists(BUILDER, cl)
            ?: simple?.let { s -> runCatching { s.getMethod("getControllerBuilder").returnType }.getOrNull() }
            ?: return fail("Fresco's controller builder not found")
        val chain = generateSequence(builderClass) { it.superclass }.flatMap { it.declaredMethods.asSequence() }
        val build = chain.firstOrNull { it.name == "build" && it.parameterTypes.isEmpty() }
            ?: chain.firstOrNull { it.parameterTypes.isEmpty() && controllerType.isAssignableFrom(it.returnType) }
            ?: return fail("${builderClass.name}.build() not found")

        unhooks += XposedBridge.hookMethod(build, object : XC_MethodHook() {
            override fun afterHookedMethod(param: MethodHookParam) {
                if (!Runtime.active) return
                try {
                    if (!sawBuild) {
                        sawBuild = true
                        Runtime.diag("first build() call: ${param.thisObject?.javaClass?.name}, request fields ${requestFieldsOf(param.thisObject.javaClass).map { it.name }}")
                    }
                    val controller = param.result ?: return
                    val url = markerUrlOf(param.thisObject) ?: return
                    Runtime.diag("built a marker controller (${controller.javaClass.name}): $url")
                    markerControllers[controller] = url
                } catch (e: Throwable) {
                    scope.log.w("build hook failed", e)
                }
            }
        })

        unhooks += XposedBridge.hookMethod(setController, object : XC_MethodHook() {
            override fun afterHookedMethod(param: MethodHookParam) {
                if (!Runtime.active) return
                try {
                    val view = param.thisObject as? View ?: return
                    val controller = param.args[0]
                    if (!sawSetController) {
                        sawSetController = true
                        Runtime.diag("first setController() call: ${view.javaClass.name}, controller ${controller?.javaClass?.name}")
                    }
                    val url = if (controller == null) null else markerControllers[controller]
                    val marker = url?.let(Marker::decode)
                    if (view.parent?.javaClass?.name?.contains("MediaView") == true) {
                        Runtime.diag("setController in ${view.parent?.javaClass?.name}: controller ${controller?.javaClass?.name}, marker ${url ?: "none"}, last build url ${lastBuildUrl}")
                    }
                    if (url != null) Runtime.diag("setController with a marker on ${view.javaClass.name} (parent ${view.parent?.javaClass?.name}): ${marker?.key ?: "couldn't decode $url"}")
                    // Most images aren't islands: only views that are or were hosts need work
                    if (marker == null && !Hosts.isHosting(view)) return
                    Hosts.onBound(view, marker)
                } catch (e: Throwable) {
                    scope.log.w("setController hook failed", e)
                }
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

    /**
     * The builder's image request's source URI, when it is a marker (cheap for everything else).
     * Fresco's getters when they exist; otherwise (R8 inlined them) the builder's fields that hold
     * an image request (a class with a [Uri] field: the request and the low-res request) and that
     * request's [Uri] field.
     */
    private fun markerUrlOf(builder: Any): String? {
        val getter = getter(requestGetter, builder.javaClass, "getImageRequest")
        val requests = if (getter != null) listOf(getter.invoke(builder)) else requestFieldsOf(builder.javaClass).map { it.get(builder) }
        lastBuildUrl = null
        if (requests.all { it == null } && noRequestLogs++ < 5) {
            // Diagnostics: a build with no request in the fields we read (array or supplier instead?)
            val other = instanceFields(builder.javaClass).mapNotNull { f ->
                runCatching { f.isAccessible = true; f.get(builder) }.getOrNull()?.let { v ->
                    "${f.name}:${v.javaClass.name}${if (v is Array<*>) "[${v.size}]" else ""}"
                }
            }
            Runtime.diag("build() without a request in ${requestFieldsOf(builder.javaClass).map { it.name }}; set fields: $other")
        }
        for (request in requests) {
            if (request == null) continue
            val uri = getter(uriGetter, request.javaClass, "getSourceUri")?.invoke(request)
                ?: uriFieldOf(request.javaClass)?.get(request)
                ?: continue
            val url = uri.toString()
            lastBuildUrl = url
            if (Marker.isMarker(url)) return url
            if (!url.startsWith("https://cdn.discordapp.com/") && urlLogs++ < 40) Runtime.diag("build() url: $url")
            if (url.contains(".invalid/")) Runtime.diag("image request isn't a marker: $url")
        }
        return null
    }

    private fun getter(cache: MutableMap<Class<*>, Method?>, cls: Class<*>, name: String): Method? =
        cache.getOrPut(cls) {
            runCatching { cls.getMethod(name).apply { isAccessible = true } }.getOrNull()
        }

    private val requestFields = Collections.synchronizedMap(HashMap<Class<*>, List<Field>>())
    private val uriFields = Collections.synchronizedMap(HashMap<Class<*>, Field?>())

    private fun instanceFields(cls: Class<*>) = generateSequence(cls) { it.superclass }
        .takeWhile { it != Any::class.java }
        .flatMap { it.declaredFields.asSequence() }
        .filter { !Modifier.isStatic(it.modifiers) }

    private fun uriFieldOf(cls: Class<*>): Field? = uriFields.getOrPut(cls) {
        instanceFields(cls).firstOrNull { it.type == Uri::class.java }?.apply { isAccessible = true }
    }

    private fun requestFieldsOf(cls: Class<*>): List<Field> = requestFields.getOrPut(cls) {
        instanceFields(cls)
            .filter { f -> !f.type.isPrimitive && !f.type.isArray && !f.type.name.startsWith("java.") && !f.type.name.startsWith("android.") }
            .filter { f -> uriFieldOf(f.type) != null }
            .onEach { it.isAccessible = true }
            .toList()
    }

    companion object {
        const val BUILDER = "com.facebook.drawee.controller.AbstractDraweeControllerBuilder"
        const val DRAWEE_VIEW = "com.facebook.drawee.view.DraweeView"
        const val SIMPLE_DRAWEE_VIEW = "com.facebook.drawee.view.SimpleDraweeView"
    }
}
