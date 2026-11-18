package dev.thatkerimguy.chatislands

import android.content.Context
import java.io.File
import java.io.FileWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Device-test log file (phase 0): every diagnostic line, uncapped, in Discord's external app
 * storage so adb can read it without root:
 * `/sdcard/Android/data/<Discord package>/files/chat-islands/diag-<start time>.log`.
 *
 * Lines written before Discord's context is known are kept and flushed once [open] runs.
 * Writes happen on one background thread; a file stops growing at [MAX_BYTES].
 * Only the newest [KEEP_FILES] files are kept.
 */
object DiagLog {
    private val writer = Executors.newSingleThreadExecutor { r -> Thread(r, "chat-islands-diag").apply { isDaemon = true } }
    private val early = ArrayList<String>()
    @Volatile private var file: File? = null
    private var bytes = 0L
    private val time = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)

    fun open(context: Context) {
        if (file != null) return
        writer.execute {
            runCatching {
                val dir = File(context.getExternalFilesDir(null) ?: context.filesDir, "chat-islands").apply { mkdirs() }
                dir.listFiles { f -> f.name.startsWith("diag-") }?.sortedByDescending { it.name }?.drop(KEEP_FILES - 1)?.forEach { it.delete() }
                val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
                val f = File(dir, "diag-$stamp.log")
                file = f
                val pending = synchronized(early) { early.toList().also { early.clear() } }
                pending.forEach(::append)
                Runtime.scope.log.i("Diagnostics log: ${f.absolutePath}")
            }
        }
    }

    fun line(message: String) {
        val text = "${synchronized(time) { time.format(Date()) }} $message"
        if (file == null) {
            synchronized(early) { if (early.size < MAX_EARLY) early += text }
            return
        }
        writer.execute { append(text) }
    }

    private fun append(text: String) {
        val f = file ?: return
        if (bytes > MAX_BYTES) return
        runCatching {
            FileWriter(f, true).use { it.write(text); it.write("\n") }
            bytes += text.length + 1
        }
    }

    private const val MAX_BYTES = 4L * 1024 * 1024
    private const val MAX_EARLY = 2000
    private const val KEEP_FILES = 5
}
