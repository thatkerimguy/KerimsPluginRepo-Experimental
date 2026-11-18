package dev.thatkerimguy.chatislands

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import java.util.WeakHashMap

/**
 * Which placeholder views show which island.
 *
 * An [IslandHost] is added next to its placeholder, in the same parent, covering it exactly
 * (kept in step with the placeholder's bounds). Being part of the row, it scrolls with it in
 * the same frame, and the chat list's own touch handling (vertical scrolling) keeps working.
 * This needs a parent that stacks its children (FrameLayout); phase 0 checks which parent
 * Discord's chat uses for embed images, and other parents are reported in the status.
 */
object Hosts {
    private val byPlaceholder = WeakHashMap<View, IslandHost>()

    fun isHosting(view: View) = byPlaceholder.containsKey(view)

    /** A placeholder view was given a new image: a marker (show that island) or a normal image (stop hosting). */
    fun onBound(placeholder: View, marker: Marker?) {
        if (!Runtime.active) return
        if (!Runtime.main.looper.isCurrentThread) {
            Runtime.post("bind") { onBound(placeholder, marker) }
            return
        }
        val host = byPlaceholder[placeholder]
        if (marker == null) {
            host?.remove()
            byPlaceholder.remove(placeholder)
            return
        }
        if (host != null) {
            host.show(marker)
            return
        }
        val parent = placeholder.parent as? ViewGroup
        if (parent == null) {
            // Bound before being added to its row: try again once it's attached
            placeholder.post { Runtime.guarded("bind") { if (placeholder.parent != null) onBound(placeholder, marker) } }
            return
        }
        if (parent !is FrameLayout) {
            Runtime.problem("Unsupported row layout for islands: ${parent.javaClass.name} (send this to the developer)")
            Runtime.hooked = false
            Runtime.sendStatus()
            return
        }
        val created = IslandHost(placeholder.context, placeholder)
        byPlaceholder[placeholder] = created
        created.attachTo(parent)
        created.show(marker)
        Runtime.diag("host added for ${marker.key} (${marker.widthDp}x${marker.heightDp} dp)", key = true)
    }

    fun detachAll() {
        byPlaceholder.values.toList().forEach { it.remove() }
        byPlaceholder.clear()
    }

    fun refreshDebug() = byPlaceholder.values.forEach { it.applyDebug() }
}

@SuppressLint("ViewConstructor")
class IslandHost(context: Context, private val placeholder: View) : FrameLayout(context) {
    var marker: Marker? = null
        private set
    private var surface: SurfacePool.Pooled? = null
    private val density = context.resources.displayMetrics.density

    private val follow = View.OnLayoutChangeListener { _, l, t, r, b, _, _, _, _ -> matchPlaceholder(l, t, r, b) }

    fun attachTo(parent: FrameLayout) {
        val index = parent.indexOfChild(placeholder) + 1
        // The placeholder (MediaView's preview image) fills its parent, so the host does too. Copying
        // the placeholder's bounds from layout callbacks left a host at 1×1 on the device (0.1.0.25)
        // when the placeholder had its final size before the callback was added.
        val lp = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT, Gravity.TOP or Gravity.START)
        // During a layout pass this asks for another one; the chat binds rows in layout, so that's one extra pass per new host
        parent.addView(this, index, lp)
        placeholder.addOnLayoutChangeListener(follow)
        matchPlaceholder(placeholder.left, placeholder.top, placeholder.right, placeholder.bottom)
        applyDebug()
    }

    /** The host fills its parent like the placeholder; placeholder layout changes only update the chat width. */
    @Suppress("UNUSED_PARAMETER")
    private fun matchPlaceholder(l: Int, t: Int, r: Int, b: Int) {
        if (r - l > 1) reportChatWidth()
    }

    fun show(marker: Marker) {
        val previous = this.marker
        this.marker = marker
        // The placeholder's (broken) image stays underneath, hidden
        placeholder.alpha = 0f
        if (previous?.key == marker.key && surface != null) return
        if (previous != null && previous.key != marker.key) Runtime.event("detach", "key" to previous.key)
        releaseSurface()
        takeSurface(marker)
        if (isAttachedToWindow) Runtime.event("attach", "key" to marker.key)
    }

    /** A pooled surface showing [marker]'s island, in this host. */
    private fun takeSurface(marker: Marker) {
        val pool = Runtime.pool ?: return
        surface = pool.acquire(marker.key, marker.widthDp)?.also { pooled ->
            (pooled.view.parent as? ViewGroup)?.removeView(pooled.view)
            addView(pooled.view, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        }
        if (surface == null) Runtime.diag("no free surface for ${marker.key}", key = true)
    }

    private fun releaseSurface() {
        surface?.let { Runtime.pool?.release(it) }
        surface = null
    }

    fun remove() {
        placeholder.removeOnLayoutChangeListener(follow)
        placeholder.alpha = 1f
        releaseSurface()
        marker?.let { Runtime.event("detach", "key" to it.key) }
        marker = null
        (parent as? ViewGroup)?.removeView(this)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        val marker = marker ?: return
        // Back on screen (or a recycled row that kept its island): take a surface again
        if (surface == null) takeSurface(marker)
        Runtime.event("attach", "key" to marker.key)
    }

    override fun onDetachedFromWindow() {
        marker?.let { Runtime.event("detach", "key" to it.key) }
        // Off screen: give the surface back to the pool. A host whose row is recycled for a message
        // without islands would otherwise keep its surface forever, and after MAX_SURFACES of
        // those new islands would get none (blank cards).
        releaseSurface()
        super.onDetachedFromWindow()
    }

    /**
     * The width islands should be measured at: from the placeholder's left edge to the message's
     * content edge. Discord 352.6: embeds sit in MessageAccessoriesView (name kept), whose right
     * padding is that edge (0.1.0.25 view tree: embed 176..1047 px in a 1080 px wide accessories view).
     * The chat list itself is R8-renamed (f9.g0), so it's recognised by its superclass, as a fallback.
     */
    private fun reportChatWidth() {
        var view: View = this
        var x = left
        var container: ViewGroup? = null
        while (true) {
            val p = view.parent as? ViewGroup ?: break
            if (p.javaClass.name.endsWith(".MessageAccessoriesView") || isRecyclerView(p)) {
                container = p
                break
            }
            x += p.left
            view = p
        }
        if (container == null || container.width <= 0) return
        val available = container.width - container.paddingRight - x
        if (available > 0) Runtime.reportChatWidth((available / density).toInt())
    }

    private fun isRecyclerView(v: View) =
        generateSequence<Class<*>>(v.javaClass) { it.superclass }.any { it.name == "androidx.recyclerview.widget.RecyclerView" }

    fun applyDebug() {
        foreground = if (Runtime.debug) GradientDrawable().apply {
            setStroke((2 * density).toInt(), Color.MAGENTA)
        } else null
    }

}
