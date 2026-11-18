package dev.thatkerimguy.chatislands

import android.app.Activity
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import java.lang.reflect.Method

/**
 * React surfaces running the JS module "ChatIsland" (js/root.tsx), from Discord's ReactHost
 * (new architecture, bridgeless: `ReactApplication.getReactHost().createSurface(...)`).
 *
 * Surfaces are expensive to start, so a few are kept and reused: a surface leaving an island
 * keeps running and gets the next island's props. Reached through reflection, so the plugin
 * doesn't compile against one React Native version; [failure] says what's missing.
 *
 * Measuring: a surface rendered in an invisible container off screen at the requested width,
 * with free height; the island's root reports its height to JS (js/measure.ts).
 */
class SurfacePool(private val activity: Activity) {
    class Pooled(val surface: Any, val view: ViewGroup) {
        var key: String? = null
        var widthDp = 0
        var measuring = false
        var inUse = false
        var lastUsed = 0L
    }

    var failure: String? = null
        private set
    val available: Boolean

    private val density = activity.resources.displayMetrics.density
    private val surfaces = mutableListOf<Pooled>()
    private val measuring = HashMap<String, Pooled>()
    private var measureBox: FrameLayout? = null

    private val reactHost: Any? = runCatching {
        activity.application.javaClass.getMethod("getReactHost").invoke(activity.application)
    }.getOrNull()

    private val createSurface: Method? = reactHost?.javaClass?.methods?.firstOrNull {
        it.name == "createSurface" && it.parameterTypes.size == 3 && it.parameterTypes[2] == Bundle::class.java
    }

    init {
        available = when {
            reactHost == null -> fail("Discord's ReactHost not found (not the new architecture?)")
            createSurface == null -> fail("ReactHost.createSurface not found")
            else -> true
        }
    }

    private fun fail(reason: String): Boolean {
        failure = reason
        return false
    }

    private fun props(key: String, widthDp: Int, measuring: Boolean) = Bundle().apply {
        putString("islandKey", key)
        putDouble("width", widthDp.toDouble())
        putBoolean("measuring", measuring)
    }

    private fun create(key: String, widthDp: Int, measuring: Boolean): Pooled? = runCatching {
        val surface = createSurface!!.invoke(reactHost, activity, SURFACE_MODULE, props(key, widthDp, measuring))!!
        surface.javaClass.getMethod("start").invoke(surface)
        val view = surface.javaClass.getMethod("getView").invoke(surface) as ViewGroup
        Pooled(surface, view).also { surfaces += it }
    }.onFailure {
        Runtime.problem("Couldn't start a React surface: $it")
        Runtime.surfacesWork = false
        Runtime.sendStatus()
    }.getOrNull()

    /** Points a running surface at another island. Falls back to a new surface when the API to update props is missing. */
    private fun retarget(p: Pooled, key: String, widthDp: Int, measuring: Boolean): Pooled? {
        val update = p.surface.javaClass.methods.firstOrNull { it.name == "updateInitProps" && it.parameterTypes.size == 1 }
        if (update != null && runCatching { update.invoke(p.surface, props(key, widthDp, measuring)) }.isSuccess) return p
        destroy(p)
        return create(key, widthDp, measuring)
    }

    /** A surface showing island [key] (the one that last showed it if still free, so its state is kept). */
    fun acquire(key: String, widthDp: Int, measuring: Boolean = false): Pooled? {
        val now = System.nanoTime()
        val pooled = surfaces.firstOrNull { !it.inUse && it.key == key && it.widthDp == widthDp && it.measuring == measuring }
            ?: surfaces.filter { !it.inUse }.minByOrNull { it.lastUsed }?.let { retarget(it, key, widthDp, measuring) }
            ?: if (surfaces.size < MAX_SURFACES) create(key, widthDp, measuring) else null
        return pooled?.apply {
            this.key = key
            this.widthDp = widthDp
            this.measuring = measuring
            inUse = true
            lastUsed = now
        }
    }

    fun release(p: Pooled) {
        p.inUse = false
        p.lastUsed = System.nanoTime()
        (p.view.parent as? ViewGroup)?.removeView(p.view)
    }

    fun measure(key: String, widthDp: Int) {
        measuring.remove(key)?.let(::release)
        val p = acquire(key, widthDp, measuring = true) ?: return
        measuring[key] = p
        val box = measureBox ?: FrameLayout(activity).also { box ->
            // Laid out but never seen: transparent, off screen, not touchable
            box.alpha = 0f
            box.translationY = -100_000f
            box.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
            activity.findViewById<ViewGroup>(android.R.id.content)
                .addView(box, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            measureBox = box
        }
        (p.view.parent as? ViewGroup)?.removeView(p.view)
        box.addView(p.view, FrameLayout.LayoutParams((widthDp * density).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT))
    }

    fun measureDone(key: String) {
        measuring.remove(key)?.let(::release)
    }

    private fun destroy(p: Pooled) {
        release(p)
        runCatching { p.surface.javaClass.getMethod("stop").invoke(p.surface) }
        surfaces.remove(p)
    }

    fun destroy() {
        surfaces.toList().forEach(::destroy)
        measuring.clear()
        (measureBox?.parent as? ViewGroup)?.removeView(measureBox)
        measureBox = null
    }

    companion object {
        const val SURFACE_MODULE = "ChatIsland"
        /** Surfaces kept: about two screens of islands plus measuring. */
        const val MAX_SURFACES = 10
    }
}
