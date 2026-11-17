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
    q.enqueue(ticket(log, "visiblePriority9", 9, { priority: true }));
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

test("block() holds new starts until released or timed out", async () => {
    const q = new LoadQueue();
    const log: string[] = [];
    const release = q.block(1000);
    q.enqueue(ticket(log, "a", 0));
    await flush();
    assert.deepEqual(log, []);
    release();
    await flush();
    assert.deepEqual(log, ["a"]);
    q.block(5);
    q.enqueue(ticket(log, "b", 1));
    q.concurrency = 2;
    await new Promise(r => setTimeout(r, 20));
    assert.deepEqual(log, ["a", "b"], "timed out");
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
