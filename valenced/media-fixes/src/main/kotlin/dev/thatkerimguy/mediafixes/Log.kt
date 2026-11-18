package dev.thatkerimguy.mediafixes

import android.content.Context
import java.io.File
import java.io.FileWriter
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * What the plugin did, for the settings page ([recent]) and for bug reports: a log file in
 * Discord's external app storage, readable with adb without root:
 * `/sdcard/Android/data/<Discord package>/files/media-fixes/log-<start time>.log`.
 * Lines from before Discord's context is known are written once [open] runs.
 */
object Log {
    private const val RECENT = 40
    private const val MAX_BYTES = 1_000_000L
    private const val KEEP_FILES = 3

    private val writer = Executors.newSingleThreadExecutor { r -> Thread(r, "media-fixes-log").apply { isDaemon = true } }
    private val recentLines = ArrayDeque<String>()
    private val early = ArrayList<String>()
    @Volatile private var file: File? = null
    private var bytes = 0L
    private val time = SimpleDateFormat("HH:mm:ss", Locale.US)

    fun open(context: Context) {
        if (file != null) return
        writer.execute {
            runCatching {
                val dir = File(context.getExternalFilesDir(null) ?: context.filesDir, "media-fixes").apply { mkdirs() }
                dir.listFiles { f -> f.name.startsWith("log-") }?.sortedByDescending { it.name }?.drop(KEEP_FILES - 1)?.forEach { it.delete() }
                val f = File(dir, "log-${SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())}.log")
                file = f
                synchronized(early) { early.toList().also { early.clear() } }.forEach(::append)
                Runtime.log("Log file: ${f.absolutePath}")
            }
        }
    }

    /** Something the user may want to know about: shown in the settings and written to the file. */
    fun event(message: String) {
        val stamped = "${synchronized(time) { time.format(Date()) }} $message"
        synchronized(recentLines) {
            recentLines.addFirst(stamped)
            while (recentLines.size > RECENT) recentLines.removeLast()
        }
        line(message)
    }

    /** File only (details). */
    fun line(message: String) {
        val stamped = "${synchronized(time) { time.format(Date()) }} $message"
        Runtime.log(message)
        if (file == null) {
            synchronized(early) { if (early.size < 500) early += stamped }
            return
        }
        writer.execute { append(stamped) }
    }

    /** Newest first. */
    fun recent(): List<String> = synchronized(recentLines) { recentLines.toList() }

    private fun append(text: String) {
        val f = file ?: return
        if (bytes > MAX_BYTES) return
        runCatching {
            FileWriter(f, true).use { it.write(text); it.write("\n") }
            bytes += text.length + 1
        }
    }
}
