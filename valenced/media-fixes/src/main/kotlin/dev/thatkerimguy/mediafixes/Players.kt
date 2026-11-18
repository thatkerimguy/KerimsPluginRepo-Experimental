package dev.thatkerimguy.mediafixes

import android.media.AudioTrack
import android.os.HandlerThread
import android.os.Looper
import app.valenced.plugins.PluginScope
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import java.lang.ref.WeakReference
import java.lang.reflect.Field
import java.lang.reflect.Method
import java.lang.reflect.Modifier
import java.util.Collections
import java.util.WeakHashMap

/**
 * Every ExoPlayer in Discord (chat videos, voice messages, react-native-video) goes through
 * ExoPlayerImpl. Its `setPlayWhenReady(boolean)` is the one place a player starts, whoever asks.
 *
 * Found by shape, not name (Discord 352.6: `yo.z.f0(Z)V`): the ExoPlayerImpl class is the one
 * with ExoPlayer's "SurfaceTextureListener already unset or replaced." warning;
 * setPlayWhenReady is its `(boolean)void` method that calls the audio focus manager's
 * `updateAudioFocus(int, boolean): int` and `updatePlayWhenReady(int, int, boolean)`, and
 * `prepare()` the `()void` one calling both. The volume is ExoPlayerImpl's only float field.
 *
 * Whether a player has sound: ExoPlayer creates its AudioTrack on that player's own
 * "ExoPlayer:Playback" thread, so the AudioTrack constructor tells which player has audio
 * (GIF-like videos have none and never count).
 */
object Players {
    var setPlayWhenReady: Method? = null
        private set
    var prepare: Method? = null
        private set
    private var volume: Field? = null

    /** Player → what it was last told (true = play). */
    private val players = Collections.synchronizedMap(WeakHashMap<Any, Boolean>())
    /** Player → its "ExoPlayer:Playback" thread (looked up once). */
    private val playbackThreads = Collections.synchronizedMap(WeakHashMap<Any, WeakReference<Thread>>())
    /** Playback thread → the AudioTrack it made last. */
    private val audioTracks = Collections.synchronizedMap(WeakHashMap<Thread, WeakReference<AudioTrack>>())

    /** Set while the plugin itself calls setPlayWhenReady, so its own calls aren't judged. */
    private val ours = ThreadLocal<Boolean>()

    fun install(scope: PluginScope): String? {
        val impl = scope.dexFinder.findClass {
            matcher { usingStrings("SurfaceTextureListener already unset or replaced.") }
        } ?: return "ExoPlayer's player class wasn't found"
        val play = scope.dexFinder.findMethod {
            matcher {
                declaredClass(impl.name)
                paramTypes("boolean")
                returnType("void")
                addInvoke { paramTypes("int", "boolean"); returnType("int") }
                addInvoke { paramTypes("int", "int", "boolean"); returnType("void") }
            }
        } ?: return "ExoPlayer's setPlayWhenReady wasn't found"
        prepare = scope.dexFinder.findMethod {
            matcher {
                declaredClass(impl.name)
                paramCount(0)
                returnType("void")
                addInvoke { paramTypes("int", "boolean"); returnType("int") }
                addInvoke { paramTypes("int", "int", "boolean"); returnType("void") }
            }
        }
        if (prepare == null) Log.line("ExoPlayer's prepare wasn't found: a failed video can't be retried automatically")
        volume = impl.declaredFields.singleOrNull { !Modifier.isStatic(it.modifiers) && it.type == java.lang.Float.TYPE }
            ?.apply { isAccessible = true }
        if (volume == null) Log.line("ExoPlayer's volume field wasn't found: muted players count as having sound")
        setPlayWhenReady = play

        XposedBridge.hookMethod(play, object : XC_MethodHook() {
            override fun beforeHookedMethod(param: MethodHookParam) {
                if (!Runtime.active || ours.get() == true) return
                try {
                    onSetPlayWhenReady(param)
                } catch (e: Throwable) {
                    Log.line("setPlayWhenReady hook failed: ${e.stackTraceToString()}")
                }
            }
        })
        XposedBridge.hookAllConstructors(AudioTrack::class.java, object : XC_MethodHook() {
            override fun afterHookedMethod(param: MethodHookParam) {
                val t = Thread.currentThread()
                if (t.name.startsWith("ExoPlayer:Playback")) audioTracks[t] = WeakReference(param.thisObject as AudioTrack)
            }
        })
        // A player's sound really starts here (its first AudioTrack doesn't exist yet when
        // setPlayWhenReady(true) runs): the newest player with sound wins
        XposedBridge.hookMethod(AudioTrack::class.java.getMethod("play"), object : XC_MethodHook() {
            override fun afterHookedMethod(param: MethodHookParam) {
                if (!Runtime.active || param.throwable != null) return
                val t = Thread.currentThread()
                if (!t.name.startsWith("ExoPlayer:Playback")) return
                audioTracks[t] = WeakReference(param.thisObject as AudioTrack)
                Runtime.main.post {
                    try {
                        val player = synchronized(playbackThreads) { playbackThreads.entries.firstOrNull { it.value.get() === t }?.key }
                            ?: return@post
                        if (players[player] != true) return@post
                        if (Settings.backgroundGuard && !Foreground.visible) {
                            pause(player)
                            Log.event("Stopped a video's sound while Discord isn't on screen")
                        } else if (Settings.oneAtATime && hasSound(player)) {
                            pauseOthers(player)
                        }
                    } catch (e: Throwable) {
                        Log.line("AudioTrack.play hook failed: ${e.stackTraceToString()}")
                    }
                }
            }
        })
        Log.line("Hooked ${impl.name}.${play.name} (setPlayWhenReady), prepare: ${prepare?.name}, volume: ${volume?.name}")
        return null
    }

    private fun onSetPlayWhenReady(param: XC_MethodHook.MethodHookParam) {
        val player = param.thisObject ?: return
        val play = param.args[0] as? Boolean ?: return
        if (!play) {
            players[player] = false
            return
        }
        if (Settings.backgroundGuard && !Foreground.visible) {
            param.args[0] = false
            players[player] = false
            Log.event("Stopped a video from starting while Discord isn't on screen")
            return
        }
        players[player] = true
        playbackThread(player) // remembered for the AudioTrack.play hook
        if (Settings.oneAtATime && hasSound(player)) pauseOthers(player)
    }

    /** Pauses every other playing player that has sound. */
    private fun pauseOthers(player: Any) {
        val others = synchronized(players) { players.filter { (p, playing) -> playing && p !== player }.keys.toList() }
        var paused = 0
        for (other in others) {
            if (!hasSound(other)) continue
            pause(other)
            paused++
        }
        if (paused > 0) Log.event("Paused $paused other video${if (paused == 1) "" else "s"} with sound")
    }

    /** Pauses every player Discord started (Discord left the screen, or "Stop all media"). */
    fun pauseAll(reason: String): Int {
        val playing = synchronized(players) { players.filterValues { it }.keys.toList() }
        playing.forEach(::pause)
        if (playing.isNotEmpty()) Log.event("Paused ${playing.size} playing video${if (playing.size == 1) "" else "s"} ($reason)")
        return playing.size
    }

    /** Calls the real setPlayWhenReady(false) on the main thread (Discord's players live there). */
    private fun pause(player: Any) {
        players[player] = false
        onMain { call(player, false) }
    }

    /** prepare() then play, for a player that stopped with an error (see [Decoders]). */
    fun retry(player: Any): Boolean {
        val prep = prepare ?: return false
        onMain {
            try {
                prep.invoke(player)
                players[player] = true
                call(player, true)
            } catch (e: Throwable) {
                Log.line("Retrying the video failed: ${e.stackTraceToString()}")
            }
        }
        return true
    }

    private fun call(player: Any, play: Boolean) {
        val m = setPlayWhenReady ?: return
        ours.set(true)
        try {
            m.invoke(player, play)
        } catch (e: Throwable) {
            Log.line("setPlayWhenReady($play) failed: $e")
        } finally {
            ours.set(false)
        }
    }

    private fun onMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block() else Runtime.main.post(block)
    }

    private fun hasSound(player: Any): Boolean {
        val v = runCatching { volume?.getFloat(player) }.getOrNull()
        if (v != null && v <= 0f) return false
        val thread = playbackThread(player) ?: return true
        val track = audioTracks[thread]?.get() ?: return false
        return runCatching { track.state == AudioTrack.STATE_INITIALIZED }.getOrDefault(false)
    }

    /** The player's "ExoPlayer:Playback" HandlerThread, found among its fields (two levels deep). */
    private fun playbackThread(player: Any): Thread? {
        playbackThreads[player]?.get()?.let { return it }
        val found = Reflect.findInstance(player, depth = 2) { it is HandlerThread && it.name.startsWith("ExoPlayer:Playback") } as? Thread
            ?: return null
        playbackThreads[player] = WeakReference(found)
        return found
    }

    /** The ExoPlayerImpl reachable from [root] (Discord's wrapper objects hold it a few fields deep). */
    fun findPlayer(root: Any): Any? {
        val cls = setPlayWhenReady?.declaringClass ?: return null
        return Reflect.findInstance(root, depth = 3) { cls.isInstance(it) }
    }

    fun stats(): Map<String, Any?> = mapOf(
        "players" to players.size,
        "playing" to synchronized(players) { players.count { it.value } },
    )
}
