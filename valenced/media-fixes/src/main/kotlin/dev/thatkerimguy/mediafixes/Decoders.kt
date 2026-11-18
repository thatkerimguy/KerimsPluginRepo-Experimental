package dev.thatkerimguy.mediafixes

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.os.Build
import android.os.SystemClock
import app.valenced.plugins.PluginScope
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import org.json.JSONObject
import org.luckypray.dexkit.query.enums.StringMatchType
import java.io.File
import java.util.Collections
import java.util.WeakHashMap

/**
 * The black video fix. Three parts:
 *
 * 1. **Decoder fallback on.** ExoPlayer's MediaCodecRenderer (found by its "Preferred decoder
 *    instantiation failed" log line) takes `enableDecoderFallback` as its only boolean constructor
 *    argument; Discord passes false, so the first decoder failing to start ends playback. With it
 *    on, ExoPlayer tries the next decoder for the format (Android's software decoders).
 *
 * 2. **Learning which hardware decoders fail.** Android's MediaCodec (framework methods, stable
 *    names) is watched on ExoPlayer's threads: a hardware video decoder that throws, reports an
 *    error, or takes in many frames without giving any picture back ("no picture") is remembered
 *    with the smallest size it failed at, in the plugin's storage. Next time that decoder is asked
 *    to decode that format at that size or larger, `configure` refuses, and the fallback above
 *    moves on to a software decoder. Only done when a software decoder for the format exists.
 *
 * 3. **Retry instead of sound only.** Discord's player error listener (found by its "Disabling
 *    problematic renderer index" log line) answers a video decoder error by turning the video
 *    off. When a hardware decoder just failed (so part 2 will now skip it), the plugin prepares
 *    the player again instead, and the video comes back with a software decoder. Otherwise
 *    Discord's handling runs, and a toast says the device can't show that video.
 */
object Decoders {
    private const val MARKER = "[media-fixes]"
    private const val NO_PICTURE_INPUTS = 90
    private const val NO_PICTURE_MS = 4000L
    private const val FRESH_FAILURE_MS = 8000L
    private const val RETRIES_PER_MINUTE = 2

    /** One configured hardware video decoder on an ExoPlayer thread. */
    private class Codec(val name: String, val mime: String, val width: Int, val height: Int) {
        val configuredAt = SystemClock.elapsedRealtime()
        @Volatile var inputs = 0
        @Volatile var outputs = 0
        @Volatile var failed = false
        val pixels get() = width.toLong() * height
    }

    private val codecs = Collections.synchronizedMap(WeakHashMap<MediaCodec, Codec>())
    /** "decoder name|mime" → smallest width × height it failed at. */
    private val learned = Collections.synchronizedMap(LinkedHashMap<String, Long>())
    private val softwareFor = Collections.synchronizedMap(HashMap<String, Boolean>())
    private val hookedCallbacks = Collections.synchronizedSet(HashSet<Class<*>>())
    private val retries = Collections.synchronizedMap(WeakHashMap<Any, MutableList<Long>>())

    @Volatile private var lastFailureAt = 0L
    @Volatile private var lastFailure: String? = null
    private var file: File? = null

    fun load(f: File) {
        file = f
        runCatching {
            if (!f.exists()) return
            val o = JSONObject(f.readText())
            o.keys().forEach { k -> learned[k] = o.getLong(k) }
        }.onFailure { Log.line("Couldn't read the remembered decoder failures: $it") }
    }

    fun learnedList(): List<String> = synchronized(learned) {
        learned.map { (k, px) ->
            val (name, mime) = k.split('|', limit = 2).let { it[0] to it.getOrElse(1) { "?" } }
            "${codecLabel(mime)} on $name: software from ${describePixels(px)}"
        }
    }

    fun forget() {
        learned.clear()
        save()
        Log.event("Forgot the remembered decoder failures")
    }

    /** Installs every part; returns part name → null when it works, or what's wrong. */
    fun install(scope: PluginScope): Map<String, String?> {
        fun attempt(name: String, block: () -> String?): Pair<String, String?> = name to try {
            block()
        } catch (e: Throwable) {
            Log.line("$name failed to start: ${e.stackTraceToString()}")
            e.toString()
        }
        return linkedMapOf(
            attempt("Watching video decoders") { installFramework(); null },
            attempt("Decoder fallback") { installFallback(scope) },
            attempt("Retrying failed videos") { installErrorHandler(scope) },
        )
    }

    // 1. Decoder fallback

    private fun installFallback(scope: PluginScope): String? {
        val renderer = scope.dexFinder.findClass {
            matcher { usingStrings("Preferred decoder instantiation failed. Sleeping for 50ms then retrying.") }
        } ?: return "ExoPlayer's decoder renderer wasn't found, so decoder fallback stays off"
        var count = 0
        for (ctor in renderer.declaredConstructors) {
            val index = ctor.parameterTypes.indexOfFirst { it == java.lang.Boolean.TYPE }
            if (index < 0 || ctor.parameterTypes.count { it == java.lang.Boolean.TYPE } != 1) continue
            XposedBridge.hookMethod(ctor, object : XC_MethodHook() {
                override fun beforeHookedMethod(param: MethodHookParam) {
                    if (Runtime.active && Settings.decoderFix) param.args[index] = true
                }
            })
            count++
        }
        if (count == 0) return "ExoPlayer's decoder renderer has no constructor with the fallback switch"
        Log.line("Decoder fallback: hooked $count constructor(s) of ${renderer.name}")
        return null
    }

    // 2. Watching MediaCodec

    private fun installFramework() {
        val cls = MediaCodec::class.java
        XposedBridge.hookAllMethods(cls, "configure", object : XC_MethodHook() {
            override fun beforeHookedMethod(param: MethodHookParam) {
                if (!Runtime.active) return
                try {
                    beforeConfigure(param)
                } catch (e: Throwable) {
                    Log.line("configure hook failed: ${e.stackTraceToString()}")
                }
            }

            override fun afterHookedMethod(param: MethodHookParam) {
                val t = param.throwable ?: return
                if (t.message?.contains(MARKER) == true) return
                codecs[param.thisObject as MediaCodec]?.let { failed(it, "configure failed: $t") }
            }
        })
        val failureWatch = object : XC_MethodHook() {
            override fun afterHookedMethod(param: MethodHookParam) {
                val t = param.throwable ?: return
                if (t.message?.contains(MARKER) == true) return
                if (t is MediaCodec.CodecException && t.isTransient) return
                val codec = codecs[param.thisObject as MediaCodec] ?: return
                failed(codec, "${param.method.name} failed: $t")
            }
        }
        for (name in listOf("start", "dequeueInputBuffer", "dequeueOutputBuffer")) {
            XposedBridge.hookAllMethods(cls, name, failureWatch)
        }
        XposedBridge.hookAllMethods(cls, "queueInputBuffer", object : XC_MethodHook() {
            override fun beforeHookedMethod(param: MethodHookParam) {
                if (!Runtime.active || !Settings.decoderFix) return
                val codec = codecs[param.thisObject as MediaCodec] ?: return
                // A decoder that took many frames without giving one picture back: black video
                if (!codec.failed && codec.outputs == 0 && codec.inputs >= NO_PICTURE_INPUTS &&
                    SystemClock.elapsedRealtime() - codec.configuredAt >= NO_PICTURE_MS
                ) {
                    failed(codec, "no picture after ${codec.inputs} frames")
                    if (hasSoftware(codec.mime)) {
                        param.throwable = IllegalStateException("$MARKER ${codec.name} gave no picture for ${codec.mime} ${codec.width}x${codec.height}")
                    }
                }
            }

            override fun afterHookedMethod(param: MethodHookParam) {
                if (param.throwable != null) {
                    if (param.throwable.message?.contains(MARKER) == true) return
                    codecs[param.thisObject as MediaCodec]?.let { failed(it, "queueInputBuffer failed: ${param.throwable}") }
                    return
                }
                codecs[param.thisObject as MediaCodec]?.let { it.inputs++ }
            }
        })
        XposedBridge.hookAllMethods(cls, "releaseOutputBuffer", object : XC_MethodHook() {
            override fun afterHookedMethod(param: MethodHookParam) {
                codecs[param.thisObject as MediaCodec]?.let { it.outputs++ }
            }
        })
        XposedBridge.hookAllMethods(cls, "release", object : XC_MethodHook() {
            override fun beforeHookedMethod(param: MethodHookParam) {
                codecs.remove(param.thisObject as MediaCodec)
            }
        })
        // ExoPlayer's asynchronous mode (Discord forces it) reports decoder errors to a callback
        XposedBridge.hookAllMethods(cls, "setCallback", object : XC_MethodHook() {
            override fun beforeHookedMethod(param: MethodHookParam) {
                val cb = param.args.getOrNull(0) as? MediaCodec.Callback ?: return
                if (hookedCallbacks.add(cb.javaClass)) hookCallback(cb.javaClass)
            }
        })
        Log.line("Watching MediaCodec")
    }

    private fun hookCallback(cls: Class<*>) {
        val onError = generateSequence<Class<*>>(cls) { it.superclass }
            .takeWhile { it != MediaCodec.Callback::class.java }
            .mapNotNull { c -> runCatching { c.getDeclaredMethod("onError", MediaCodec::class.java, MediaCodec.CodecException::class.java) }.getOrNull() }
            .firstOrNull() ?: return
        XposedBridge.hookMethod(onError, object : XC_MethodHook() {
            override fun beforeHookedMethod(param: MethodHookParam) {
                val e = param.args[1] as? MediaCodec.CodecException
                if (e != null && e.isTransient) return
                val codec = codecs[param.args[0] as? MediaCodec ?: return] ?: return
                failed(codec, "decoder error: $e")
            }
        })
    }

    private fun beforeConfigure(param: XC_MethodHook.MethodHookParam) {
        if (!Thread.currentThread().name.startsWith("ExoPlayer:")) return
        val codec = param.thisObject as MediaCodec
        val format = param.args.getOrNull(0) as? MediaFormat ?: return
        val mime = format.getString(MediaFormat.KEY_MIME) ?: return
        if (!mime.startsWith("video/")) return
        val info = runCatching { codec.codecInfo }.getOrNull() ?: return
        if (info.isEncoder || !isHardware(info)) return
        val width = runCatching { format.getInteger(MediaFormat.KEY_WIDTH) }.getOrDefault(0)
        val height = runCatching { format.getInteger(MediaFormat.KEY_HEIGHT) }.getOrDefault(0)
        val c = Codec(info.name, mime, width, height)
        val failedFrom = learned["${c.name}|$mime"]
        if (Settings.decoderFix && failedFrom != null && c.pixels >= failedFrom && hasSoftware(mime)) {
            Log.line("Skipping ${c.name} for $mime ${width}x$height (failed from ${describePixels(failedFrom)} before)")
            lastFailureAt = SystemClock.elapsedRealtime()
            param.throwable = IllegalStateException("$MARKER skipped ${c.name}: it failed on ${codecLabel(mime)} before")
            return
        }
        codecs[codec] = c
    }

    private fun failed(codec: Codec, why: String) {
        if (codec.failed) return
        codec.failed = true
        val key = "${codec.name}|${codec.mime}"
        val px = codec.pixels.coerceAtLeast(1)
        val before = learned[key]
        if (before == null || px < before) {
            learned[key] = px
            save()
        }
        lastFailureAt = SystemClock.elapsedRealtime()
        lastFailure = "${codecLabel(codec.mime)} ${codec.width}×${codec.height}"
        Log.event("Hardware decoder ${codec.name} failed on ${codecLabel(codec.mime)} ${codec.width}×${codec.height} ($why)")
    }

    private fun save() {
        val f = file ?: return
        runCatching {
            f.parentFile?.mkdirs()
            f.writeText(JSONObject(synchronized(learned) { HashMap(learned) } as Map<*, *>).toString())
        }.onFailure { Log.line("Couldn't save the decoder failures: $it") }
    }

    private fun isHardware(info: MediaCodecInfo): Boolean {
        if (Build.VERSION.SDK_INT >= 29) return info.isHardwareAccelerated && !info.isSoftwareOnly
        val n = info.name.lowercase()
        return !(n.startsWith("omx.google.") || n.startsWith("c2.android.") || n.startsWith("c2.google.") || n.contains(".sw."))
    }

    /** Android has a software decoder for [mime] (only then is skipping the hardware one useful). */
    fun hasSoftware(mime: String): Boolean = softwareFor.getOrPut(mime) {
        runCatching {
            MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.any { info ->
                !info.isEncoder && !isHardware(info) && info.supportedTypes.any { it.equals(mime, ignoreCase = true) }
            }
        }.getOrDefault(false)
    }

    // 3. Discord's error handler

    private fun installErrorHandler(scope: PluginScope): String? {
        val handler = scope.dexFinder.findMethod {
            matcher {
                addUsingString("Disabling problematic renderer index", StringMatchType.Contains)
                paramCount(1)
            }
        } ?: return "Discord's video error handling wasn't found, so failed videos aren't retried"
        XposedBridge.hookMethod(handler, object : XC_MethodHook() {
            override fun beforeHookedMethod(param: MethodHookParam) {
                if (!Runtime.active || !Settings.decoderFix) return
                try {
                    onPlayerError(param)
                } catch (e: Throwable) {
                    Log.line("Error handler hook failed: ${e.stackTraceToString()}")
                }
            }
        })
        Log.line("Hooked Discord's player error handler ${handler.declaringClass.name}.${handler.name}")
        return null
    }

    private fun onPlayerError(param: XC_MethodHook.MethodHookParam) {
        val error = param.args[0] as? Throwable ?: return
        val ours = generateSequence(error) { it.cause }.take(8).any { it.message?.contains(MARKER) == true }
        val message = error.message ?: ""
        val videoError = ours || message.contains("VideoRenderer error")
        if (!videoError) return
        val mime = Regex("video/[A-Za-z0-9.+-]+").find(message)?.value ?: lastFailure
        val fresh = SystemClock.elapsedRealtime() - lastFailureAt < FRESH_FAILURE_MS
        Log.line("Video error (ours=$ours, fresh hardware failure=$fresh): $message / cause: ${error.cause}")

        if (ours || fresh) {
            val player = Players.findPlayer(param.thisObject ?: return)
            val recent = player?.let { p ->
                synchronized(retries) {
                    val list = retries.getOrPut(p) { ArrayList() }
                    val now = SystemClock.elapsedRealtime()
                    list.removeAll { now - it > 60_000 }
                    list
                }
            }
            if (player != null && recent != null && recent.size < RETRIES_PER_MINUTE && Players.retry(player)) {
                recent += SystemClock.elapsedRealtime()
                param.result = null // Discord would turn the picture off: retry with a software decoder instead
                Log.event("Retrying a video with a software decoder (${lastFailure ?: mime ?: "video"})")
                toast("Your phone's video decoder couldn't play this, switching to software decoding")
                return
            }
            Log.line("Not retrying: player=${player != null}, retries=${recent?.size}, prepare=${Players.prepare != null}")
        }
        val what = mime?.let(::codecLabel) ?: "this video"
        Log.event("Couldn't show the picture of a $what video, only its sound plays")
        toast("This phone can't show $what videos, only the sound will play")
    }

    private fun toast(text: String) {
        if (Settings.toasts) Runtime.toast(text)
    }

    fun codecLabel(mime: String): String = when (mime.lowercase().substringBefore(';')) {
        "video/av01" -> "AV1"
        "video/hevc" -> "HEVC (H.265)"
        "video/avc" -> "H.264"
        "video/x-vnd.on2.vp9" -> "VP9"
        "video/x-vnd.on2.vp8" -> "VP8"
        "video/dolby-vision" -> "Dolby Vision"
        else -> mime.removePrefix("video/")
    }

    private fun describePixels(px: Long): String = when {
        px <= 1 -> "any size"
        px >= 3840L * 2160 -> "4K"
        px >= 2560L * 1440 -> "1440p"
        px >= 1920L * 1080 -> "1080p"
        px >= 1280L * 720 -> "720p"
        else -> "$px pixels"
    }
}
