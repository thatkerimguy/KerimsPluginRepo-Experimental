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
        Runtime.diag("onBound ${marker.key}: parent ${parent?.javaClass?.name}, pool ${Runtime.pool != null}, surfaces ${Runtime.surfacesWork}", key = true)
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
        Runtime.diag("host for ${marker.key} added at index ${parent.indexOfChild(created)} of ${parent.childCount}; placeholder ${placeholder.width}x${placeholder.height}", key = true)
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
        val lp = LayoutParams(placeholder.width.coerceAtLeast(1), placeholder.height.coerceAtLeast(1), Gravity.TOP or Gravity.START)
        // During a layout pass this asks for another one; the chat binds rows in layout, so that's one extra pass per new host
        parent.addView(this, index, lp)
        placeholder.addOnLayoutChangeListener(follow)
        matchPlaceholder(placeholder.left, placeholder.top, placeholder.right, placeholder.bottom)
        applyDebug()
    }

    /** Covers the placeholder exactly, whatever size Discord gave it. */
    private fun matchPlaceholder(l: Int, t: Int, r: Int, b: Int) {
        val lp = layoutParams as? LayoutParams ?: return
        val w = (r - l).coerceAtLeast(1)
        val h = (b - t).coerceAtLeast(1)
        if (lp.width == w && lp.height == h && lp.leftMargin == l && lp.topMargin == t) return
        lp.width = w
        lp.height = h
        lp.leftMargin = l
        lp.topMargin = t
        layoutParams = lp
        reportChatWidth()
    }

    fun show(marker: Marker) {
        val previous = this.marker
        this.marker = marker
        if (previous?.key == marker.key && surface != null) return
        if (previous != null) Runtime.event("detach", "key" to previous.key)
        val pool = Runtime.pool ?: return
        surface?.let { pool.release(it) }
        surface = pool.acquire(marker.key, marker.widthDp).also { Runtime.diag("show ${marker.key} at ${marker.widthDp}dp: surface ${if (it == null) "none" else "ok"}", key = true) }?.also { pooled ->
            (pooled.view.parent as? ViewGroup)?.removeView(pooled.view)
            addView(pooled.view, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        }
        // The placeholder's (broken) image stays underneath, hidden
        placeholder.alpha = 0f
        if (isAttachedToWindow) Runtime.event("attach", "key" to marker.key)
    }

    fun remove() {
        Runtime.diag("host ${marker?.key} removed by us: ${Throwable().stackTrace.take(8).joinToString(" < ")}", key = true)
        placeholder.removeOnLayoutChangeListener(follow)
        placeholder.alpha = 1f
        surface?.let { Runtime.pool?.release(it) }
        surface = null
        marker?.let { Runtime.event("detach", "key" to it.key) }
        marker = null
        (parent as? ViewGroup)?.removeView(this)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        Runtime.diag("host ${marker?.key} attached to window: parent ${parent?.javaClass?.simpleName} children ${(parent as? ViewGroup)?.childCount}, ${width}x$height", key = true)
        marker?.let { Runtime.event("attach", "key" to it.key) }
    }

    override fun onDetachedFromWindow() {
        Runtime.diag("host ${marker?.key} detached from window (parent now ${parent?.javaClass?.simpleName}): ${Throwable().stackTrace.take(10).joinToString(" < ")}", key = true)
        marker?.let { Runtime.event("detach", "key" to it.key) }
        super.onDetachedFromWindow()
    }

    /** The width islands should be measured at: from the placeholder's left edge to the chat list's content edge. */
    private fun reportChatWidth() {
        var view: View = this
        var x = left
        var list: ViewGroup? = null
        while (true) {
            val p = view.parent as? ViewGroup ?: break
            if (p.javaClass.name.contains("RecyclerView")) {
                list = p
                break
            }
            x += p.left
            view = p
        }
        if (list == null) return
        val available = list.width - list.paddingRight - x - (CONTENT_END_PADDING_DP * density).toInt()
        Runtime.reportChatWidth((available / density).toInt())
    }

    fun applyDebug() {
        foreground = if (Runtime.debug) GradientDrawable().apply {
            setStroke((2 * density).toInt(), Color.MAGENTA)
        } else null
    }

    private companion object {
        /** Space Discord leaves right of message content. */
        const val CONTENT_END_PADDING_DP = 16
    }
}
