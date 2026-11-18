package dev.thatkerimguy.chatislands

import android.app.Activity
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout

/**
 * React surfaces running the JS module "ChatIsland" (js/root.tsx), started in Discord's
 * bridgeless React Native through [ReactSurfaces] (found by shape: R8 removed the public API).
 *
 * Surfaces are expensive to start, so a few are kept and reused: a surface leaving an island
 * keeps running and gets the next island's props (`SurfaceHandlerBinding.setProps`).
 * [resolve] finds the API once Discord's React root view exists (not yet when the activity is
 * created); [failure] says what's missing. Main thread only.
 *
 * Measuring: a surface rendered in an invisible container off screen at the requested width,
 * with free height; the island's root reports its height to JS (js/measure.ts).
 */
class SurfacePool(private val activity: Activity) {
    class Pooled(val surface: ReactSurfaces.Surface) {
        val view: ViewGroup get() = surface.view
        var key: String? = null
        var widthDp = 0
        var measuring = false
        var inUse = false
        var lastUsed = 0L
    }

    var failure: String? = "Not looked up yet"
        private set
    private var api: ReactSurfaces? = null
    val available: Boolean get() = api != null

    private val density = activity.resources.displayMetrics.density
    private val surfaces = mutableListOf<Pooled>()
    private val measuring = HashMap<String, Pooled>()
    private var measureBox: FrameLayout? = null

    /** Finds the surface API (again, until it's found). True when surfaces can be made. */
    fun resolve(): Boolean {
        if (api != null) return true
        api = try {
            ReactSurfaces.find(activity)
        } catch (e: Throwable) {
            failure = "Looking up React surfaces failed: $e"
            return false
        }
        failure = if (api != null) null else ReactSurfaces.lastFailure ?: "unknown"
        return api != null
    }

    private fun props(key: String, widthDp: Int, measuring: Boolean) = Bundle().apply {
        putString("islandKey", key)
        putDouble("width", widthDp.toDouble())
        putBoolean("measuring", measuring)
    }

    private fun create(key: String, widthDp: Int, measuring: Boolean): Pooled? {
        val api = api ?: return null
        return runCatching {
            Pooled(api.create(activity, SURFACE_MODULE, props(key, widthDp, measuring))).also { surfaces += it }
        }.onFailure {
            Runtime.problem("Couldn't start a React surface: $it")
            Runtime.surfacesWork = false
            Runtime.sendStatus()
        }.getOrNull()
    }

    /** Points a running surface at another island; a new surface if that fails. */
    private fun retarget(p: Pooled, key: String, widthDp: Int, measuring: Boolean): Pooled? {
        val api = api ?: return null
        if (runCatching { api.setProps(p.surface, props(key, widthDp, measuring)) }.isSuccess) return p
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
        runCatching { api?.stop(p.surface) }
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
