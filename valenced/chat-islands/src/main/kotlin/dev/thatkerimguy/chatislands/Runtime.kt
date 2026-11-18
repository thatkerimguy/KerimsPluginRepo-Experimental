package dev.thatkerimguy.chatislands

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.Choreographer
import app.valenced.bridge.asDelegate
import app.valenced.plugins.PluginScope
import app.valenced.xposed.api.registerNativeMethod
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * The native side's state and its bridge to JS (method names shared with js/native.ts).
 * Everything that touches views runs on the main thread.
 */
object Runtime {
    const val NS = "thatkerimguy.chatIslands"

    lateinit var scope: PluginScope
        private set

    val main = Handler(Looper.getMainLooper())
    private var coroutines: CoroutineScope? = null

    @Volatile var activity: Activity? = null
        private set

    /** Problems found while starting, in order; empty = ready. */
    private val problems = mutableListOf<String>()

    @Volatile var hooked = false
    @Volatile var surfacesWork = false
    @Volatile var chatWidthDp = 0
        private set
    @Volatile var debug = false
        private set

    var hook: MarkerHook? = null
        private set
    var pool: SurfacePool? = null
        private set

    fun start(scope: PluginScope) {
        this.scope = scope
        coroutines = CoroutineScope(SupervisorJob() + Dispatchers.Main)
        registerMethods()
        hook = MarkerHook(scope).also { hooked = it.install() }
        if (!hooked) problem("The chat's image views weren't found on this Discord version (${hook?.failure ?: "unknown"})")
        scope.withAppActivity { a ->
            activity = a
            pool = SurfacePool(a).also { surfacesWork = it.available }
            if (!surfacesWork) problem("React surfaces aren't available (${pool?.failure ?: "unknown"})")
            sendStatus()
        }
    }

    fun stop() {
        hook?.uninstall()
        hook = null
        main.post {
            Hosts.detachAll()
            pool?.destroy()
            pool = null
        }
        coroutines?.cancel()
        coroutines = null
    }

    fun problem(message: String) {
        scope.log.w(message)
        synchronized(problems) { problems += message }
    }

    fun status(): Map<String, Any?> {
        val reason = synchronized(problems) { problems.firstOrNull() }
            ?: if (activity == null) "Discord hasn't opened yet" else null
        return mapOf(
            "ready" to (reason == null && hooked && surfacesWork),
            "reason" to reason,
            "version" to scope.manifest.version.toString(),
            "chatWidth" to chatWidthDp,
        )
    }

    private fun registerMethods() {
        scope.registerNativeMethod("$NS.status") { status() }

        scope.registerNativeMethod("$NS.measure") { raw ->
            val args = raw.asDelegate()
            val key: String by args.string()
            val width: Double by args.double()
            val pool = pool ?: return@registerNativeMethod false
            main.post { pool.measure(key, width.toInt()) }
            true
        }

        scope.registerNativeMethod("$NS.measureDone") { raw ->
            val args = raw.asDelegate()
            val key: String by args.string()
            main.post { pool?.measureDone(key) }
            null
        }

        scope.registerNativeMethod("$NS.setDebug") { raw ->
            val args = raw.asDelegate()
            val on: Boolean by args.boolean()
            debug = on
            main.post { Hosts.refreshDebug() }
            null
        }
    }

    // --- events to JS, batched per frame ---

    private val pending = mutableListOf<Map<String, Any?>>()
    private var frameScheduled = false

    fun event(type: String, vararg fields: Pair<String, Any?>) {
        synchronized(pending) {
            pending += mapOf("type" to type, *fields)
            if (frameScheduled) return
            frameScheduled = true
        }
        main.post { Choreographer.getInstance().postFrameCallback { flush() } }
    }

    private fun flush() {
        val batch = synchronized(pending) {
            frameScheduled = false
            pending.toList().also { pending.clear() }
        }
        if (batch.isEmpty()) return
        val bridge = scope.bridge
        if (!bridge.isReady) return
        coroutines?.launch {
            try {
                bridge.callJSMethod("$NS.events", listOf(batch))
            } catch (e: Throwable) {
                scope.log.w("Couldn't send events to JS", e)
            }
        }
    }

    fun reportChatWidth(dp: Int) {
        if (dp <= 0 || dp == chatWidthDp) return
        chatWidthDp = dp
        event("chatWidth", "width" to dp)
    }

    fun sendStatus() = event("status", "status" to status())
}
