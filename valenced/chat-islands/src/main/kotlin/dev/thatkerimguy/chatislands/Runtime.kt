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
 *
 * Two rules, both from a crash (enabling the plugin while Discord ran closed the app):
 * - Never call into JS before the JS side said it listens (`listen`). Valenced throws inside
 *   its JS bridge for a method that isn't registered, and that throw kills the app; the JS side
 *   doesn't start at all when the plugin is turned on late.
 * - Turning the plugin on or off takes effect after a restart (`requireReload`), like the JS side:
 *   hooking a running chat only half works.
 */
object Runtime {
    const val NS = "thatkerimguy.chatIslands"

    lateinit var scope: PluginScope
        private set

    val main = Handler(Looper.getMainLooper())
    private var coroutines: CoroutineScope? = null

    /** False before start and after stop: hooks and hosts do nothing. */
    @Volatile var active = false
        private set

    /** The JS side registered its event handler (js/native.ts onNativeEvents). */
    @Volatile private var jsListening = false

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
        if (scope.startedLate) {
            scope.log.i("Turned on while Discord runs: takes effect after a restart")
            scope.requireReload()
            return
        }
        try {
            coroutines = CoroutineScope(SupervisorJob() + Dispatchers.Main)
            active = true
            registerMethods()
            hook = MarkerHook(scope).also { hooked = it.install() }
            if (!hooked) problem("The chat's image views weren't found on this Discord version (${hook?.failure ?: "unknown"})")
            scope.withAppActivity { a ->
                guarded("activity") {
                    activity = a
                    pool = SurfacePool(a).also { surfacesWork = it.available }
                    if (!surfacesWork) problem("React surfaces aren't available (${pool?.failure ?: "unknown"})")
                    sendStatus()
                }
            }
        } catch (e: Throwable) {
            // Never take Discord down: islands just stay off
            problem("Couldn't start: $e")
            scope.errors.tryEmit(e)
        }
    }

    /** Turned off: nothing changes until the restart, the hooks and hosts just stop doing anything. */
    fun stop() {
        active = false
        jsListening = false
        scope.requireReload()
        coroutines?.cancel()
        coroutines = null
    }

    /** Runs [block] on the main thread; an exception there would otherwise crash the app. */
    fun post(what: String, block: () -> Unit) {
        main.post { guarded(what, block) }
    }

    inline fun guarded(what: String, block: () -> Unit) {
        try {
            block()
        } catch (e: Throwable) {
            scope.log.e("$what failed", e)
            scope.errors.tryEmit(e)
        }
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

        scope.registerNativeMethod("$NS.listen") {
            jsListening = true
            post("flush") { flush() }
            null
        }

        scope.registerNativeMethod("$NS.measure") { raw ->
            val args = raw.asDelegate()
            val key: String by args.string()
            val width: Double by args.double()
            val pool = pool ?: return@registerNativeMethod false
            if (!active) return@registerNativeMethod false
            post("measure") { pool.measure(key, width.toInt()) }
            true
        }

        scope.registerNativeMethod("$NS.measureDone") { raw ->
            val args = raw.asDelegate()
            val key: String by args.string()
            post("measureDone") { pool?.measureDone(key) }
            null
        }

        scope.registerNativeMethod("$NS.setDebug") { raw ->
            val args = raw.asDelegate()
            val on: Boolean by args.boolean()
            debug = on
            post("setDebug") { Hosts.refreshDebug() }
            null
        }
    }

    // --- events to JS, batched per frame, only once JS listens ---

    private val pending = ArrayDeque<Map<String, Any?>>()
    private var frameScheduled = false

    fun event(type: String, vararg fields: Pair<String, Any?>) {
        if (!active) return
        synchronized(pending) {
            pending.addLast(mapOf("type" to type, *fields))
            // Before JS listens, keep only the latest events
            while (pending.size > MAX_PENDING) pending.removeFirst()
            if (frameScheduled || !jsListening) return
            frameScheduled = true
        }
        post("schedule") { Choreographer.getInstance().postFrameCallback { guarded("flush") { flush() } } }
    }

    private fun flush() {
        if (!jsListening || !active) {
            synchronized(pending) { frameScheduled = false }
            return
        }
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

    private const val MAX_PENDING = 200
}
