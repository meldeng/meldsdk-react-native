package io.meld.rn

import io.meld.sdk.MeldMountException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class MeldMountLifecycleTest {
    private val noFailure: (Long, Exception) -> Unit = { _, e -> fail("unexpected failure: $e") }

    @Test
    fun `prop batches do not remount an unchanged order`() {
        var mounted = 0
        val unmounted = mutableListOf<Int>()
        val state = MeldMountLifecycle<Int> { unmounted.add(it) }
        for (i in 0 until 3) {
            state.mount(order("synthetic"), { ++mounted }, noFailure)
        }
        assertEquals(1, mounted)
        assertTrue(unmounted.isEmpty())
        state.detach()
        assertEquals(listOf(1), unmounted)
    }

    @Test
    fun `a new order closes the old mount, drops its events first, and mounts the new one`() {
        val tokens = mutableListOf<Long>()
        val unmounted = mutableListOf<Int>()
        var oldWasCurrentDuringUnmount = true
        lateinit var state: MeldMountLifecycle<Int>
        state = MeldMountLifecycle {
            unmounted.add(it)
            oldWasCurrentDuringUnmount = state.isCurrent(tokens[0])
        }
        state.mount(order("first"), { tokens.add(it); 1 }, noFailure)
        state.mount(order("second"), { tokens.add(it); 2 }, noFailure)
        assertEquals(listOf(1), unmounted)
        assertFalse(oldWasCurrentDuringUnmount)
        assertFalse(state.isCurrent(tokens[0]))
        assertTrue(state.isCurrent(tokens[1]))
        state.detach()
        assertEquals(listOf(1, 2), unmounted)
        assertFalse(state.isCurrent(tokens[1]))
    }

    @Test
    fun `a returning order mounts again after another one replaced it`() {
        var mounted = 0
        val state = MeldMountLifecycle<Int> { }
        for (id in listOf("first", "second", "first")) state.mount(order(id), { ++mounted }, noFailure)
        assertEquals(3, mounted)
    }

    @Test
    fun `a synchronous detach cannot retain the just-created handle`() {
        val unmounted = mutableListOf<Int>()
        var token = -1L
        lateinit var state: MeldMountLifecycle<Int>
        state = MeldMountLifecycle { unmounted.add(it) }
        state.mount(order("synthetic"), { generation -> token = generation; state.detach(); 1 }, noFailure)
        assertEquals(listOf(1), unmounted)
        assertFalse(state.isCurrent(token))
    }

    @Test
    fun `a synchronous replacement cannot overwrite the new handle`() {
        val unmounted = mutableListOf<Int>()
        lateinit var state: MeldMountLifecycle<Int>
        state = MeldMountLifecycle { unmounted.add(it) }
        state.mount(order("first"), {
            state.mount(order("second"), { 2 }, noFailure)
            1
        }, noFailure)
        assertEquals(listOf(1), unmounted)
        state.detach()
        assertEquals(listOf(1, 2), unmounted)
    }

    @Test
    fun `a failed mount reports once and is not retried for the same order`() {
        var attempts = 0
        val failures = mutableListOf<Long>()
        val state = MeldMountLifecycle<Int> { fail("nothing was mounted") }
        for (i in 0 until 3) {
            state.mount(order("synthetic"), { attempts++; throw IllegalStateException("refused") }, { token, _ -> failures.add(token) })
        }
        assertEquals(1, attempts)
        assertEquals(1, failures.size)
        assertTrue("the failure is reported while its generation is current", state.isCurrent(failures[0]))
        state.mount(order("replacement"), { attempts++; 1 }, noFailure)
        assertEquals(2, attempts)
    }

    @Test
    fun `a failure after a synchronous detach is not reported`() {
        lateinit var state: MeldMountLifecycle<Int>
        state = MeldMountLifecycle { }
        state.mount(order("synthetic"), { state.detach(); throw IllegalStateException("refused") }, noFailure)
    }

    @Test
    fun `an equal order rebuilt by the bridge is the same order`() {
        var mounted = 0
        val state = MeldMountLifecycle<Int> { }
        val first = hashMapOf<String, Any?>("id" to "synthetic", "headlessPresentation" to hashMapOf("version" to 1.0),
            "payload" to arrayListOf("a", null))
        val rebuilt = hashMapOf<String, Any?>("payload" to arrayListOf("a", null), "headlessPresentation" to hashMapOf("version" to 1.0),
            "id" to "synthetic")
        state.mount(first, { ++mounted }, noFailure)
        state.mount(rebuilt, { ++mounted }, noFailure)
        assertEquals(1, mounted)
        state.mount(hashMapOf<String, Any?>("id" to "synthetic", "headlessPresentation" to hashMapOf("version" to 2.0),
            "payload" to arrayListOf("a", null)), { ++mounted }, noFailure)
        assertEquals(2, mounted)
    }

    @Test
    fun `an embeddable order mounts into the view and any other for the Activity`() {
        val activity = Any()
        for (current in listOf(activity, null)) {
            assertEquals("view", mountWhere(true, current, { "view" }, { fail("an embeddable order needs its view"); "activity" }))
        }
        var received: Any? = null
        assertEquals("activity", mountWhere(false, activity, { fail("no view of the component is used"); "view" }) {
            received = it
            "activity"
        })
        assertSame(activity, received)
    }

    @Test
    fun `an order that draws into no view does not mount without an Activity`() {
        val thrown = assertThrows(MeldMountException::class.java) {
            mountWhere<Any, String>(false, null, { fail("no view of the component is used"); "view" }, { fail("no Activity"); "activity" })
        }
        assertSame(MeldMountException.PresentationUnavailable, thrown)
    }

    private fun order(id: String): Map<String, Any?> = hashMapOf("id" to id)
}
