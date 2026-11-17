/* The shared tile loader (tileLoader.ts) with React, the way both builds use it */

import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import TR from "react-test-renderer";
import { LoadQueue, type Ticket } from "../../vencord/gifPickerOptimizer/queue.ts";
import { useTileLoader, type TileEnv } from "../../vencord/gifPickerOptimizer/tileLoader.ts";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
// react-test-renderer still works with React 19, it only warns
const consoleError = console.error;
console.error = (...args: unknown[]) => String(args[0]).includes("react-test-renderer is deprecated") || consoleError(...args);
const { act } = TR as any;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await sleep(5); }); };

function makeEnv(opts: { cached?: Set<string>; seen?: Set<string>; failedBefore?: Set<string>; } = {}) {
    const queue = new LoadQueue();
    queue.concurrency = 1;
    const dropped = new WeakSet<Ticket>();
    const log: string[] = [];
    const env: TileEnv = {
        queue,
        isCached: u => !!opts.cached?.has(u),
        wasSeen: u => !!opts.seen?.has(u),
        markLoaded: u => { log.push(`loaded ${u}`); opts.cached?.add(u); },
        markFailed: u => log.push(`failed ${u}`),
        forgetLoaded: u => { log.push(`forgot ${u}`); opts.cached?.delete(u); },
        failedBefore: u => !!opts.failedBefore?.has(u),
        drop: t => { if (t) { dropped.add(t); queue.cancel(t); } },
        isDropped: t => dropped.has(t),
        onError: () => { },
    };
    return { env, log };
}

type Api = ReturnType<typeof useTileLoader>;
const apis: Record<string, Api> = {};
const renders: Record<string, { phase: string; seenBefore: boolean; }[]> = {};
function Tile(p: { id: string; env: TileEnv; index: number; still?: boolean; enabled?: boolean; loadTimeout?: number; pick: () => string; lookup?: () => Promise<unknown> | null; probe?: (u: string) => Promise<boolean>; }) {
    const api = useTileLoader(React as any, p.env, {
        original: `orig-${p.id}`, index: p.index, still: !!p.still, enabled: p.enabled, loadTimeout: p.loadTimeout ?? 30, initiallyVisible: true,
        pick: p.pick, lookup: p.lookup ?? (() => null), probeCache: p.probe, retryDelaysMs: [5, 5, 5],
    });
    apis[p.id] = api;
    (renders[p.id] ??= []).push({ phase: api.phase, seenBefore: api.seenBefore });
    return null;
}

test("Sequential in index order, one at a time", async () => {
    const { env, log } = makeEnv({ cached: new Set() });
    let root: any;
    const ids = ["c", "a", "d", "b"]; const idx: Record<string, number> = { a: 0, b: 1, c: 2, d: 3 };
    await act(async () => { root = TR.create(React.createElement(React.Fragment, null, ids.map(id => React.createElement(Tile, { key: id, id, env, index: idx[id], pick: () => `low-${id}` })))); });
    await settle();
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
        const loading = Object.entries(apis).filter(([id, a]) => ids.includes(id) && a.phase === "loading").map(([id]) => id);
        assert.equal(loading.length, 1, `one at a time (step ${i}): ${loading}`);
        order.push(loading[0]);
        await act(async () => apis[loading[0]].done());
        await settle();
    }
    assert.deepEqual(order, ["a", "b", "c", "d"]);
    assert.ok(ids.every(id => apis[id].phase === "done"));
    assert.ok(log.includes("loaded low-a"));
    act(() => root.unmount());
});

test("Seen before: known on the very first render (no queued-dot flash); cached: done at once", async () => {
    const { env } = makeEnv({ cached: new Set(["low-cached"]), seen: new Set(["low-pre"]) });
    let root: any;
    await act(async () => { root = TR.create(React.createElement(React.Fragment, null,
        React.createElement(Tile, { id: "pre", env, index: 0, pick: () => "low-pre" }),
        React.createElement(Tile, { id: "cached", env, index: 1, pick: () => "low-cached" }))); });
    assert.equal(renders.pre[0].seenBefore, true, "seen before on the first render");
    assert.equal(renders.cached[0].phase, "done", "cached shows at once");
    await settle();
    assert.equal(apis.pre.phase, "loading");
    act(() => root.unmount());
});

test("Still toggled while queued: not stranded", async () => {
    const { env } = makeEnv({ cached: new Set() });
    let root: any;
    const el = (still: boolean) => React.createElement(React.Fragment, null,
        React.createElement(Tile, { id: "busy", env, index: 0, pick: () => "low-busy" }),
        React.createElement(Tile, { id: "s", env, index: 1, still, pick: () => (still ? "still-s" : "low-s") }));
    await act(async () => { root = TR.create(el(false)); });
    await settle();
    assert.equal(apis.busy.phase, "loading"); assert.equal(apis.s.phase, "queued");
    await act(async () => root.update(el(true)));
    await settle();
    await act(async () => apis.busy.done()); await settle();
    assert.equal(apis.s.phase, "loading", "still-toggled tile gets its turn");
    assert.equal(apis.s.chosen, "still-s");
    act(() => root.unmount());
});

test("Disabled during a lookup: restarts and loads when enabled again; the slot is freed meanwhile", async () => {
    const { env } = makeEnv({ cached: new Set() });
    let resolveLookup!: () => void;
    const lookup = () => new Promise<void>(r => { resolveLookup = r; });
    let root: any;
    let first = true;
    const el = (enabled: boolean) => React.createElement(Tile, { id: "r", env, index: 0, enabled, pick: () => "low-r", lookup: () => (first ? (first = false, lookup()) : null) });
    await act(async () => { root = TR.create(el(true)); });
    await settle();
    assert.equal(apis.r.phase, "resolving");
    await act(async () => root.update(el(false)));
    await settle();
    assert.equal(apis.r.phase, "queued");
    await act(async () => resolveLookup()); await settle();
    assert.equal(apis.r.phase, "queued", "stale lookup doesn't begin");
    await act(async () => root.update(el(true)));
    await settle();
    assert.equal(apis.r.phase, "loading", "loads once enabled again");
    act(() => root.unmount());
});

test("native cache probe skips the queue", async () => {
    const { env } = makeEnv({ cached: new Set() });
    let root: any;
    await act(async () => { root = TR.create(React.createElement(Tile, { id: "p", env, index: 0, pick: () => "low-p", probe: async () => true })); });
    await settle();
    assert.equal(apis.p.phase, "done", "native cache hit shown without a turn");
    act(() => root.unmount());
});

/** Fails the tile's current image `times` times, waiting for each retry to start loading again */
async function failTimes(id: string, times: number) {
    for (let i = 0; i < times; i++) {
        await act(async () => apis[id].error());
        await settle();
    }
}

test("a failed preview is retried, never swapped for the original", async () => {
    const { env, log } = makeEnv({ cached: new Set() });
    let root: any;
    await act(async () => { root = TR.create(React.createElement(Tile, { id: "e", env, index: 0, pick: () => "low-e" })); });
    await settle();
    assert.equal(apis.e.chosen, "low-e");
    await failTimes("e", 3);
    assert.equal(apis.e.phase, "loading", "loading again after each retry");
    assert.equal(apis.e.chosen, "low-e");
    assert.equal(apis.e.attempt, 3, "each retry is a new element");
    assert.ok(!log.includes("failed low-e"), "not marked failed while retrying");
    // The fourth failure: no other preview, so it gives up instead of loading the original
    await failTimes("e", 1);
    assert.equal(apis.e.phase, "done");
    assert.equal(apis.e.gaveUp, true);
    assert.equal(apis.e.chosen, "low-e");
    assert.ok(log.includes("failed low-e"));
    // It loads after all: the failed mark goes away
    await act(async () => apis.e.done());
    assert.equal(apis.e.gaveUp, false);
    act(() => root.unmount());
});

test("a retry that works finishes normally", async () => {
    const { env, log } = makeEnv({ cached: new Set() });
    let root: any;
    await act(async () => { root = TR.create(React.createElement(Tile, { id: "r", env, index: 0, pick: () => "low-r" })); });
    await settle();
    await failTimes("r", 1);
    assert.equal(apis.r.phase, "loading");
    await act(async () => apis.r.done());
    assert.equal(apis.r.phase, "done");
    assert.equal(apis.r.gaveUp, false);
    assert.ok(log.includes("loaded low-r"));
    act(() => root.unmount());
});

test("a still image that keeps failing falls back to the animated preview", async () => {
    const { env, log } = makeEnv({ cached: new Set() });
    let root: any;
    const stillFailed = () => log.includes("failed still-s");
    await act(async () => { root = TR.create(React.createElement(Tile, { id: "s", env, index: 0, still: true, pick: () => (stillFailed() ? "low-s" : "still-s") })); });
    await settle();
    assert.equal(apis.s.chosen, "still-s");
    await failTimes("s", 4);
    assert.equal(apis.s.chosen, "low-s", "the animated preview, not the original");
    assert.equal(apis.s.phase, "loading");
    assert.equal(apis.s.gaveUp, false);
    act(() => root.unmount());
});

test("an original that fails just stops", async () => {
    const { env } = makeEnv({ cached: new Set() });
    let root: any;
    await act(async () => { root = TR.create(React.createElement(Tile, { id: "o", env, index: 0, pick: () => "orig-o" })); });
    await settle();
    await failTimes("o", 1);
    assert.equal(apis.o.phase, "done");
    assert.equal(apis.o.attempt, 0, "no retry loop for the original (Discord's own tile handles it)");
    act(() => root.unmount());
});

test("a lookup frees its slot, and the tile loads the small URL once it's known", async () => {
    const { env } = makeEnv({ cached: new Set() });
    let resolveLookup!: () => void;
    let known = false;
    let root: any;
    await act(async () => { root = TR.create(React.createElement(React.Fragment, null,
        React.createElement(Tile, {
            id: "k", env, index: 0,
            pick: () => (known ? "small-k" : "orig-k"),
            lookup: () => (known ? null : new Promise<void>(r => { resolveLookup = () => { known = true; r(); }; })),
        }),
        React.createElement(Tile, { id: "n", env, index: 1, pick: () => "low-n" }))); });
    await settle();
    assert.equal(apis.k.phase, "resolving");
    assert.equal(apis.n.phase, "loading", "the next GIF loads while the lookup runs");
    assert.equal(apis.k.chosen, null, "no original meanwhile");
    await act(async () => resolveLookup());
    await settle();
    await act(async () => apis.n.done());
    await settle();
    assert.equal(apis.k.phase, "loading");
    assert.equal(apis.k.chosen, "small-k");
    act(() => root.unmount());
});

test("a preview that failed for good before gets one quick retry", async () => {
    const { env, log } = makeEnv({ cached: new Set(), failedBefore: new Set(["low-q"]) });
    let root: any;
    await act(async () => { root = TR.create(React.createElement(Tile, { id: "q", env, index: 0, pick: () => "low-q" })); });
    await settle();
    await failTimes("q", 1);
    assert.equal(apis.q.phase, "loading", "one retry");
    await failTimes("q", 1);
    assert.equal(apis.q.gaveUp, true, "then gives up");
    assert.ok(log.includes("failed low-q"));
    act(() => root.unmount());
});

test("a slow GIF releases its slot after the timeout, and reports its load time", async () => {
    const { env } = makeEnv({ cached: new Set() });
    const calls: string[] = [];
    const queue = env.queue as any;
    const release = queue.release.bind(queue);
    const finish = queue.finish.bind(queue);
    queue.release = (t: unknown) => { calls.push("release"); release(t); };
    queue.finish = (t: unknown, ms?: number) => { calls.push(`finish ${typeof ms}`); finish(t, ms); };
    let root: any;
    await act(async () => { root = TR.create(React.createElement(Tile, { id: "t", env, index: 0, pick: () => "low-t", loadTimeout: 0.01 })); });
    await settle();
    await act(async () => { await sleep(30); });
    assert.ok(calls.includes("release"), "released after the timeout");
    await act(async () => apis.t.done());
    assert.ok(calls.includes("finish number"), "finished with its load time");
    act(() => root.unmount());
});
