package dev.thatkerimguy.chatislands

import android.app.Activity
import android.content.Context
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import java.lang.reflect.Constructor
import java.lang.reflect.Field
import java.lang.reflect.Method
import java.lang.reflect.Modifier
import java.util.concurrent.atomic.AtomicReference

/**
 * Starts and stops React surfaces in Discord's bridgeless React Native, found by shape.
 *
 * Discord's R8 removes or renames the public API (352.6: no `getReactHost()` on the
 * application, no `ReactHost.createSurface`, and `ReactSurfaceImpl.attach / start / stop /
 * getView / updateInitProps` are inlined into `ReactDelegate.loadApp`). What it can't rename are
 * the JNI-facing classes: `SurfaceHandlerBinding` (setProps), `FabricUIManager`
 * (startSurface / stopSurface), `ReactContext.getFabricUIManager`, `Arguments.fromBundle`.
 *
 * So this does what loadApp does, from Discord's own running root surface view: that view's
 * class, its surface's class (the one holding a `SurfaceHandlerBinding`) and the surface's
 * view / host references (the `AtomicReference`s holding the root view and the host).
 * A surface is: `ReactSurfaceImpl(context, module, props)`, `ReactSurfaceView(context, surface)`,
 * view and host set on the surface, then `FabricUIManager.startSurface(binding, context, view)`.
 *
 * [find] returns null with [lastFailure] set when something is missing. Main thread only.
 */
class ReactSurfaces private constructor(
    private val surfaceCtor: Constructor<*>,
    private val viewCtor: Constructor<*>,
    private val handlerField: Field,
    private val viewRef: Field,
    private val hostRef: Field,
    private val host: Any,
    private val uiManager: Any,
    private val startSurface: Method,
    private val stopSurface: Method,
    private val setProps: Method,
    private val fromBundle: Method,
) {
    class Surface(val surface: Any, val view: ViewGroup, val handler: Any)

    fun create(context: Context, module: String, props: Bundle): Surface {
        val surface = surfaceCtor.newInstance(context, module, props)!!
        val view = viewCtor.newInstance(context, surface) as ViewGroup
        @Suppress("UNCHECKED_CAST")
        (viewRef.get(surface) as AtomicReference<Any?>).compareAndSet(null, view)
        @Suppress("UNCHECKED_CAST")
        (hostRef.get(surface) as AtomicReference<Any?>).compareAndSet(null, host)
        val handler = handlerField.get(surface)!!
        startSurface.invoke(uiManager, handler, context, view)
        return Surface(surface, view, handler)
    }

    /** New props for a running surface (what `updateInitProps` did). */
    fun setProps(s: Surface, props: Bundle) {
        setProps.invoke(s.handler, fromBundle.invoke(null, props))
    }

    fun stop(s: Surface) {
        stopSurface.invoke(uiManager, s.handler)
    }

    companion object {
        var lastFailure: String? = null
            private set

        private const val HANDLER = "com.facebook.react.fabric.SurfaceHandlerBinding"
        private const val REACT_CONTEXT = "com.facebook.react.bridge.ReactContext"
        private const val NATIVE_MAP = "com.facebook.react.bridge.NativeMap"
        private const val ARGUMENTS = "com.facebook.react.bridge.Arguments"

        private fun fail(reason: String): ReactSurfaces? {
            lastFailure = reason
            return null
        }

        private fun fields(cls: Class<*>) = generateSequence(cls) { it.superclass }
            .takeWhile { it != Any::class.java && !it.name.startsWith("android.") }
            .flatMap { it.declaredFields.asSequence() }
            .filter { !Modifier.isStatic(it.modifiers) }
            .onEach { it.isAccessible = true }

        /** Discord's root React view and its surface: the first view holding an object that holds a SurfaceHandlerBinding. */
        private fun findRoot(activity: Activity, handlerClass: Class<*>): Pair<View, Any>? {
            val queue = ArrayDeque<View>()
            queue.addLast(activity.window?.decorView ?: return null)
            var seen = 0
            while (queue.isNotEmpty() && seen++ < 300) {
                val v = queue.removeFirst()
                if (!v.javaClass.name.startsWith("android.")) {
                    for (f in fields(v.javaClass)) {
                        if (f.type.isPrimitive || f.type.name.startsWith("java.") || f.type.name.startsWith("android.")) continue
                        if (fields(f.type).none { it.type == handlerClass }) continue
                        val surface = runCatching { f.get(v) }.getOrNull() ?: continue
                        return v to surface
                    }
                }
                if (v is ViewGroup) for (i in 0 until v.childCount) queue.addLast(v.getChildAt(i))
            }
            return null
        }

        fun find(activity: Activity): ReactSurfaces? {
            val cl = activity.classLoader
            val handlerClass = runCatching { Class.forName(HANDLER, false, cl) }.getOrNull()
                ?: return fail("SurfaceHandlerBinding not found (not the new architecture?)")
            val (rootView, rootSurface) = findRoot(activity, handlerClass)
                ?: return fail("Discord's React root view not found yet")
            val surfaceClass = rootSurface.javaClass

            val surfaceCtor = runCatching {
                surfaceClass.getDeclaredConstructor(Context::class.java, String::class.java, Bundle::class.java).apply { isAccessible = true }
            }.getOrNull() ?: return fail("${surfaceClass.name}(Context, String, Bundle) not found")
            val viewCtor = runCatching {
                rootView.javaClass.getDeclaredConstructor(Context::class.java, surfaceClass).apply { isAccessible = true }
            }.getOrNull() ?: return fail("${rootView.javaClass.name}(Context, ${surfaceClass.name}) not found")

            val surfaceFields = fields(surfaceClass).toList()
            val handlerField = surfaceFields.firstOrNull { it.type == handlerClass }
                ?: return fail("${surfaceClass.name} has no SurfaceHandlerBinding")
            val refs = surfaceFields.filter { it.type == AtomicReference::class.java }
            val viewRef = refs.firstOrNull { (it.get(rootSurface) as AtomicReference<*>).get() === rootView }
                ?: return fail("${surfaceClass.name}'s view reference not found")
            var host: Any? = null
            val hostRef = refs.firstOrNull { f ->
                val value = (f.get(rootSurface) as AtomicReference<*>).get()
                (value != null && value !is View).also { if (it) host = value }
            } ?: return fail("${surfaceClass.name}'s host reference not found")

            val reactContextClass = runCatching { Class.forName(REACT_CONTEXT, false, cl) }.getOrNull()
                ?: return fail("ReactContext not found")
            fun contextFrom(o: Any): Any? = o.javaClass.methods
                .firstOrNull { it.parameterTypes.isEmpty() && reactContextClass.isAssignableFrom(it.returnType) }
                ?.let { runCatching { it.invoke(o) }.getOrNull() }
            val reactContext = contextFrom(rootView) ?: contextFrom(host!!)
                ?: return fail("Discord's ReactContext not found")
            val uiManager = runCatching { reactContextClass.getMethod("getFabricUIManager").invoke(reactContext) }.getOrNull()
                ?: return fail("FabricUIManager not found")

            val startSurface = runCatching {
                uiManager.javaClass.getMethod("startSurface", handlerClass, Context::class.java, View::class.java)
            }.getOrNull() ?: return fail("FabricUIManager.startSurface(SurfaceHandlerBinding, …) not found")
            val stopSurface = runCatching { uiManager.javaClass.getMethod("stopSurface", handlerClass) }.getOrNull()
                ?: return fail("FabricUIManager.stopSurface(SurfaceHandlerBinding) not found")
            val setProps = runCatching { handlerClass.getMethod("setProps", Class.forName(NATIVE_MAP, false, cl)) }.getOrNull()
                ?: return fail("SurfaceHandlerBinding.setProps not found")
            val fromBundle = runCatching { Class.forName(ARGUMENTS, false, cl).getMethod("fromBundle", Bundle::class.java) }.getOrNull()
                ?: return fail("Arguments.fromBundle not found")

            lastFailure = null
            return ReactSurfaces(surfaceCtor, viewCtor, handlerField, viewRef, hostRef, host!!, uiManager,
                startSurface, stopSurface, setProps, fromBundle)
        }
    }
}
