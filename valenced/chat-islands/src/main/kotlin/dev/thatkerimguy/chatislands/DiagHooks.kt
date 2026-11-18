package dev.thatkerimguy.chatislands

import android.view.View
import android.view.ViewGroup
import app.valenced.plugins.PluginScope
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import de.robv.android.xposed.XposedHelpers

/**
 * Device-test diagnostics (phase 0; remove when islands work): what Discord's MediaView is asked
 * to show. In 352.6 the embed view's bind (q9.q.b, read with Vineflower) passes the embed's
 * media source (od.c0, toString "MediaSource(sourceUrl=…, previewUrl=…)") to the static
 * MediaView.f(view, source, …), which loads previewUrl into its first image view.
 * Only calls whose source mentions a marker are logged, plus the state after the call.
 */
object DiagHooks {
    private const val MEDIA_VIEW = "com.discord.chat.presentation.message.view.MediaView"

    fun install(scope: PluginScope) {
        try {
            val mediaView = XposedHelpers.findClassIfExists(MEDIA_VIEW, scope.classLoader)
                ?: return DiagLog.line("diag hooks: MediaView not found")
            val show = mediaView.declaredMethods.firstOrNull {
                java.lang.reflect.Modifier.isStatic(it.modifiers) && it.parameterTypes.size > 15 && it.parameterTypes[0] == mediaView
            } ?: return DiagLog.line("diag hooks: MediaView's static bind not found")
            XposedBridge.hookMethod(show, object : XC_MethodHook() {
                override fun beforeHookedMethod(param: MethodHookParam) {
                    try {
                        val source = param.args[1]?.toString() ?: "null"
                        if (!source.contains(".invalid")) return
                        val view = param.args[0] as View
                        Runtime.diag("MediaView.${show.name} called with $source; kind ${param.args[5]}; view visible ${view.visibility == View.VISIBLE}, attached ${view.isAttachedToWindow}", key = true)
                        param.setObjectExtra("marker", true)
                    } catch (e: Throwable) {
                        DiagLog.line("diag MediaView before failed: $e")
                    }
                }

                override fun afterHookedMethod(param: MethodHookParam) {
                    try {
                        if (param.getObjectExtra("marker") != true) return
                        val view = param.args[0] as ViewGroup
                        val children = (0 until view.childCount).joinToString { i ->
                            val c = view.getChildAt(i)
                            "${c.javaClass.simpleName}(${if (c.visibility == View.VISIBLE) "V" else if (c.visibility == View.GONE) "G" else "I"} ${c.width}x${c.height})"
                        }
                        Runtime.diag("after MediaView.${show.name}: ${view.width}x${view.height}, children: $children", key = true)
                        param.throwable?.let { Runtime.diag("MediaView.${show.name} threw $it", key = true) }
                    } catch (e: Throwable) {
                        DiagLog.line("diag MediaView after failed: $e")
                    }
                }
            })
            DiagLog.line("diag hooks: MediaView.${show.name} hooked")
        } catch (e: Throwable) {
            DiagLog.line("diag hooks failed: $e")
        }
    }
}
