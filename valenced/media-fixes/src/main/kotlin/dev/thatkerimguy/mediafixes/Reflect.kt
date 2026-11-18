package dev.thatkerimguy.mediafixes

import android.content.Context
import android.view.View
import java.lang.reflect.Field
import java.lang.reflect.Modifier
import java.util.Collections
import java.util.IdentityHashMap

/** Field walking for obfuscated objects whose field names change with every Discord build. */
object Reflect {
    private val fieldCache = Collections.synchronizedMap(HashMap<Class<*>, List<Field>>())

    /**
     * Breadth-first search through [root]'s instance fields (and theirs, up to [depth] levels) for
     * an object [matches] accepts. Skips platform and library objects, views and contexts, so it
     * stays inside Discord's and ExoPlayer's own objects.
     */
    fun findInstance(root: Any, depth: Int, matches: (Any) -> Boolean): Any? {
        if (matches(root)) return root
        val seen = Collections.newSetFromMap(IdentityHashMap<Any, Boolean>())
        var level = listOf(root)
        seen += root
        repeat(depth) {
            val next = ArrayList<Any>()
            for (obj in level) {
                for (f in fields(obj.javaClass)) {
                    val v = runCatching { f.get(obj) }.getOrNull() ?: continue
                    if (!seen.add(v)) continue
                    if (matches(v)) return v
                    if (walkable(v)) next += v
                }
            }
            level = next
        }
        return null
    }

    private fun walkable(v: Any): Boolean {
        if (v is View || v is Context || v is Collection<*> || v is Map<*, *> || v.javaClass.isArray) return false
        val name = v.javaClass.name
        return !(name.startsWith("java.") || name.startsWith("android.") || name.startsWith("kotlin.") ||
            name.startsWith("kotlinx.") || name.startsWith("com.facebook.") || name.startsWith("dalvik."))
    }

    private fun fields(cls: Class<*>): List<Field> = fieldCache.getOrPut(cls) {
        generateSequence<Class<*>>(cls) { it.superclass }
            .takeWhile { it != Any::class.java }
            .flatMap { it.declaredFields.asSequence() }
            .filter { !Modifier.isStatic(it.modifiers) && !it.type.isPrimitive }
            .onEach { runCatching { it.isAccessible = true } }
            .toList()
    }
}
