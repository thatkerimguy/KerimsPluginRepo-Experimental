package dev.thatkerimguy.mediafixes

import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.content.Context
import android.os.Bundle

/**
 * Whether any Discord screen is visible. Counts started activities (a picture-in-picture
 * window is started too); an activity that stops only to be recreated (rotation) doesn't count
 * as leaving. Until the first activity event is seen, the process importance decides, so a
 * late registration never makes the plugin think Discord is hidden while it's on screen.
 */
object Foreground {
    @Volatile private var started = 0
    @Volatile private var seenAny = false
    @Volatile private var changing = false
    private var installed = false

    /** Called with false when the last Discord screen stops, true when one starts again. */
    var onChange: ((visible: Boolean) -> Unit)? = null

    val visible: Boolean
        get() {
            if (changing) return true
            if (seenAny) return started > 0
            return runCatching {
                val info = ActivityManager.RunningAppProcessInfo()
                ActivityManager.getMyMemoryState(info)
                info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
            }.getOrDefault(true)
        }

    fun install(context: Context) {
        if (installed) return
        val app = context.applicationContext as? Application ?: run {
            Log.event("Couldn't watch Discord's screens (no Application), the background fix only uses the process state")
            return
        }
        installed = true
        app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityStarted(activity: Activity) {
                val wasVisible = seenAny && started > 0
                seenAny = true
                started++
                changing = false
                if (!wasVisible) onChange?.invoke(true)
            }

            override fun onActivityStopped(activity: Activity) {
                if (!seenAny) return
                started = (started - 1).coerceAtLeast(0)
                changing = activity.isChangingConfigurations
                if (started == 0 && !changing) onChange?.invoke(false)
            }

            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
            override fun onActivityResumed(activity: Activity) {}
            override fun onActivityPaused(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) {}
        })
    }
}
