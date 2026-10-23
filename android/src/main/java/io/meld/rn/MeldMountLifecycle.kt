package io.meld.rn

import io.meld.sdk.MeldMountException

/**
 * Main-thread ownership for one native mount, as on iOS. Inputs are compared in memory, never
 * logged or stored. A callback carries the generation it was mounted with and is dropped once that
 * generation is no longer current.
 */
internal class MeldMountLifecycle<Handle : Any>(private val unmount: (Handle) -> Unit) {
    private var handle: Handle? = null
    private var inputs: Any? = null
    private var generation = 0L

    fun isCurrent(token: Long): Boolean = inputs != null && generation == token

    /** Mounts [next] unless those inputs were already attempted. New inputs first end the old mount. */
    fun mount(next: Any, make: (Long) -> Handle, failed: (Long, Exception) -> Unit) {
        if (next == inputs) return
        detach()
        inputs = next
        val token = generation
        try {
            val mounted = make(token)
            // A synchronous event may detach or replace the view before make returns.
            if (isCurrent(token)) handle = mounted else unmount(mounted)
        } catch (e: Exception) {
            if (isCurrent(token)) failed(token, e)
        }
    }

    fun detach() {
        generation++
        inputs = null
        val previous = handle
        handle = null
        if (previous != null) unmount(previous)
    }
}

/**
 * An embeddable surface renders into the component's view. Any other is mounted for the life of the
 * current Activity, so the component leaving its window does not end it; with no Activity it cannot mount.
 */
internal inline fun <A : Any, H> mountWhere(embeddable: Boolean, activity: A?, intoView: () -> H, forActivity: (A) -> H): H =
    if (embeddable) intoView() else forActivity(activity ?: throw MeldMountException.PresentationUnavailable)
