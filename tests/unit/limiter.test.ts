/* Klipy lookups run two at a time (Limiter in klipy.ts) */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Limiter } from "../../vencord/gifPickerOptimizer/async.ts";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

test("at most `max` tasks at once, the next one starts after the spacing", async () => {
    const limiter = new Limiter(2, 5);
    let running = 0;
    let most = 0;
    const order: number[] = [];
    const task = (i: number) => limiter.run(async () => {
        running++;
        most = Math.max(most, running);
        await sleep(10);
        running--;
        order.push(i);
        return i;
    });
    const results = await Promise.all([0, 1, 2, 3, 4].map(task));
    assert.deepEqual(results, [0, 1, 2, 3, 4]);
    assert.equal(most, 2);
    assert.deepEqual(order.slice(0, 2).sort(), [0, 1], "the first two ran first");
});

test("a task that throws still frees its place", async () => {
    const limiter = new Limiter(1, 1);
    await assert.rejects(limiter.run(async () => { throw new Error("x"); }));
    assert.equal(await limiter.run(async () => "next"), "next");
});
