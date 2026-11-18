package dev.thatkerimguy.mediafixes

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import app.valenced.bridge.asDelegate
import app.valenced.plugins.PluginScope
import app.valenced.xposed.api.registerNativeMethod
import java.io.File

/**
 * Starts the fixes and answers the JS settings page (method names shared with js/native.ts).
 *
 * Turning the plugin on while Discord runs takes effect after a restart (`requireReload`):
 * players and decoders that already exist were made without the fixes. Turning it off makes
 * every hook pass straight through at once ([active]).
 */
object Runtime {
    const val NS = "thatkerimguy.mediaFixes"

    lateinit var scope: PluginScope
        private set

    val main = Handler(Looper.getMainLooper())

    /** False before start and after stop: every hook does nothing. */
    @Volatile var active = false
        private set

    @Volatile private var context: Context? = null
    @Volatile private var waitingForRestart = false

    /** Part name → null when it works, or what's wrong. */
    private val parts = LinkedHashMap<String, String?>()

    fun start(scope: PluginScope) {
        this.scope = scope
        Settings.load(File(scope.storageDir, "settings.json"))
        Decoders.load(File(scope.storageDir, "decoder-failures.json"))
        registerMethods()
        if (scope.startedLate) {
            waitingForRestart = true
            scope.log.i("Turned on while Discord runs: takes effect after a restart")
            scope.requireReload()
            return
        }
        active = true
        scope.withAppContext { ctx ->
            context = ctx.applicationContext
            Log.open(ctx)
            Foreground.install(ctx)
        }
        Foreground.onChange = { visible ->
            if (!visible && active && Settings.backgroundGuard) Players.pauseAll("Discord left the screen")
        }
        part("Background and one-at-a-time") { Players.install(scope) }
        Decoders.install(scope).forEach { (name, problem) -> part(name) { problem } }
        Log.line("Started: ${synchronized(parts) { parts.toString() }}")
    }

    fun stop() {
        active = false
        Foreground.onChange = null
    }

    private fun part(name: String, install: () -> String?) {
        val problem = try {
            install()
        } catch (e: Throwable) {
            Log.line("$name failed to start: ${e.stackTraceToString()}")
            e.toString()
        }
        synchronized(parts) { parts[name] = problem }
        if (problem != null) Log.event("$name: $problem")
    }

    fun log(message: String) {
        if (::scope.isInitialized) scope.log.i(message)
    }

    fun toast(text: String) {
        val ctx = context ?: return
        main.post { runCatching { Toast.makeText(ctx, text, Toast.LENGTH_LONG).show() } }
    }

    private fun status(): Map<String, Any?> = mapOf(
        "version" to scope.manifest.version.toString(),
        "waitingForRestart" to waitingForRestart,
        "parts" to synchronized(parts) { parts.map { (name, problem) -> mapOf("name" to name, "problem" to problem) } },
        "settings" to Settings.asMap(),
        "learned" to Decoders.learnedList(),
        "recent" to Log.recent(),
        "visible" to Foreground.visible,
    ) + Players.stats()

    private fun registerMethods() {
        scope.registerNativeMethod("$NS.status") { status() }

        scope.registerNativeMethod("$NS.set") { raw ->
            val args = raw.asDelegate()
            val key: String by args.string()
            val value: Boolean by args.boolean()
            Settings.set(key, value)
        }

        scope.registerNativeMethod("$NS.stopAll") {
            if (!active) return@registerNativeMethod 0
            Players.pauseAll("Stop all media")
        }

        scope.registerNativeMethod("$NS.forget") {
            Decoders.forget()
            null
        }
    }
}
