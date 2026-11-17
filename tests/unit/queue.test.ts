/* The load queue (queue.ts): reading order, visible first, priority, concurrency, blocking */

import assert from "node:assert/strict";
import { test } from "node:test";

import { LoadQueue, type Ticket } from "../../vencord/gifPickerOptimizer/queue.ts";

const flush = () => new Promise(r => setTimeout(r, 1));

function ticket(log: string[], name: string, order: number, extra: Partial<Ticket> = {}): Ticket {
    return { order: () => order, visible: true, start: () => log.push(name), ...extra };
}

test("starts in index order, one at a time, next after finish", async () => {
    const q = new LoadQueue();
    const log: string[] = [];
    const t = [3, 1, 2, 0].map(i => ticket(log, `t${i}`, i));
    t.forEach(x => q.enqueue(x));
    await flush();
    assert.deepEqual(log, ["t0"]);
    q.finish(t[3]);
    await flush();
    q.finish(t[1]);
    await flush();
    assert.deepEqual(log, ["t0", "t1", "t2"]);
});

test("visible first, then priority, then index; cancelled tickets are skipped", async () => {
    const q = new LoadQueue();
    q.concurrency = 10;
    const log: string[] = [];
    q.enqueue(ticket(log, "hidden0", 0, { visible: false }));
    q.enqueue(ticket(log, "visible5", 5));
    q.enqueue(ticket(log, "visiblePriority9", 9, { seenBefore: true }));
    const cancelled = ticket(log, "cancelled1", 1);
    q.enqueue(cancelled);
    q.cancel(cancelled);
    await flush();
    assert.deepEqual(log, ["visiblePriority9", "visible5", "hidden0"]);
});

test("visibility changes take effect after kick()", async () => {
    const q = new LoadQueue();
    const log: string[] = [];
    const a = ticket(log, "a", 0);
    const b = ticket(log, "b", 1, { visible: false });
    const c = ticket(log, "c", 2, { visible: false });
    [a, b, c].forEach(x => q.enqueue(x));
    await flush();
    c.visible = true;
    q.kick();
    q.finish(a);
    await flush();
    assert.deepEqual(log, ["a", "c"]);
});

test("hold() only holds Klipy search tickets, until released or timed out", async () => {
    const q = new LoadQueue();
    q.concurrency = 4;
    const log: string[] = [];
    const release = q.hold(1000);
    q.enqueue(ticket(log, "klipy", 0, { waitsForLowRes: true }));
    q.enqueue(ticket(log, "tenor", 1));
    await flush();
    assert.deepEqual(log, ["tenor"], "the Tenor tile doesn't wait");
    release();
    await flush();
    assert.deepEqual(log, ["tenor", "klipy"]);
    q.hold(5);
    q.enqueue(ticket(log, "klipy2", 2, { waitsForLowRes: true }));
    await new Promise(r => setTimeout(r, 20));
    assert.deepEqual(log, ["tenor", "klipy", "klipy2"], "timed out");
});

test("cache fast lane: seen-before GIFs that load instantly may go past the limit", async () => {
    const q = new LoadQueue();
    q.concurrency = 1;
    const log: string[] = [];
    const t = Array.from({ length: 6 }, (_, i) => ticket(log, `s${i}`, i, { seenBefore: true }));
    t.forEach(x => q.enqueue(x));
    await flush();
    assert.deepEqual(log, ["s0"], "cold: one at a time");
    q.finish(t[0], 20); // came from the cache
    await flush();
    assert.equal(log.length, 6, "hot: the rest start together");
    // A slow one closes the lane again
    q.finish(t[1], 900);
    const more = Array.from({ length: 3 }, (_, i) => ticket(log, `m${i}`, 10 + i, { seenBefore: true }));
    for (const x of t.slice(2)) q.finish(x);
    more.forEach(x => q.enqueue(x));
    await flush();
    assert.deepEqual(log.slice(6), ["m0"], "cold again: back to the limit");
});

test("the fast lane is only for seen-before GIFs", async () => {
    const q = new LoadQueue();
    q.concurrency = 1;
    const log: string[] = [];
    const seen = ticket(log, "seen", 0, { seenBefore: true });
    q.enqueue(seen);
    await flush();
    q.finish(seen, 10);
    q.enqueue(ticket(log, "new1", 1));
    q.enqueue(ticket(log, "new2", 2));
    await flush();
    assert.deepEqual(log, ["seen", "new1"], "downloads still one at a time");
});

test("overtime: released slow GIFs count against a second limit", async () => {
    const q = new LoadQueue();
    q.concurrency = 2;
    const log: string[] = [];
    const t = Array.from({ length: 8 }, (_, i) => ticket(log, `t${i}`, i));
    t.forEach(x => q.enqueue(x));
    await flush();
    assert.deepEqual(log, ["t0", "t1"]);
    q.release(t[0]);
    q.release(t[1]);
    await flush();
    assert.deepEqual(log, ["t0", "t1", "t2", "t3"], "released slots go to the next ones");
    q.release(t[2]);
    q.release(t[3]);
    await flush();
    assert.equal(log.length, 4, "4 still downloading = 2 x concurrency: nothing more starts");
    q.finish(t[0], 12_000);
    await flush();
    assert.deepEqual(log.slice(4), ["t4"], "an overtime one finishing makes room");
});

test("a ticket whose start throws frees its slot", async () => {
    const q = new LoadQueue();
    const log: string[] = [];
    const consoleError = console.error;
    console.error = () => { };
    try {
        q.enqueue(ticket(log, "bad", 0, { start: () => { throw new Error("x"); } }));
        q.enqueue(ticket(log, "next", 1));
        await flush();
        assert.deepEqual(log, ["next"]);
    } finally {
        console.error = consoleError;
    }
});
