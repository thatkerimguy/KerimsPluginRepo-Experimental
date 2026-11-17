/*
 * Saving to disk: SavedUrlSet, Precacher, KlipyResolver and TenorPageResolver on
 * top of Persisted (load merge, batched saves, nothing saved before the load,
 * clear / detach while loading).
 */

import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { KlipyResolver } from "../../vencord/gifPickerOptimizer/klipy.ts";
import { Precacher } from "../../vencord/gifPickerOptimizer/precache.ts";
import { SavedUrlSet } from "../../vencord/gifPickerOptimizer/saved.ts";
import { TenorPageResolver } from "../../valenced/gif-picker-optimizer/js/tenor.ts";

const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
};
const now = () => Date.now();

test("SavedUrlSet: load merge, save gating, detach", async () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000_000 });
    try {
        const s = new SavedUrlSet(10, 1e9);
        const d = deferred<[string, number][] | undefined>();
        const saves: [string, number][][] = [];
        s.attach({ load: () => d.promise, save: e => saves.push(e) });
        s.add("session");
        mock.timers.tick(5000);
        assert.equal(saves.length, 0, "no save before the load");
        d.resolve([["old", now() - 10], ["bad" as any, "x" as any]]);
        await tick();
        assert.deepEqual([...(s as any).urls.entries()].map((e: any) => e[0]), ["old", "session"], "saved go first");
        mock.timers.tick(15000);
        assert.equal(saves.length, 1); assert.deepEqual(saves[0].map(e => e[0]), ["old", "session"]);
        // re-add within 12 h: no save
        s.add("session"); mock.timers.tick(3000); assert.equal(saves.length, 1);
        // delete saves
        s.delete("old"); mock.timers.tick(15000); assert.equal(saves.length, 2);
        // detach flushes pending, then no more saves
        s.add("new"); s.detach(); assert.equal(saves.length, 3);
        s.add("after"); mock.timers.tick(5000); assert.equal(saves.length, 3, "no save after detach");
        assert.ok(s.has("after"));

    } finally {
        mock.timers.reset();
    }
});

test("SavedUrlSet: clear / detach during a load, throwing load, expiry", async () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000_000 });
    try {
        // clear during a load: the stale load is ignored and [] is saved
        const s = new SavedUrlSet(10, 1e9);
        const d = deferred<[string, number][] | undefined>();
        const saves: any[] = [];
        s.attach({ load: () => d.promise, save: e => saves.push(e) });
        s.add("a"); s.clear();
        assert.deepEqual(saves, [[]]);
        d.resolve([["stale", now()]]); await tick();
        assert.equal(s.has("stale"), false);
        // detach during a load: the stale load is ignored, nothing saved later
        const s2 = new SavedUrlSet(10, 1e9);
        const d2 = deferred<[string, number][] | undefined>();
        const saves2: any[] = [];
        s2.attach({ load: () => d2.promise, save: e => saves2.push(e) });
        s2.add("x"); s2.detach();
        d2.resolve([["stale", now()]]); await tick(); mock.timers.tick(5000);
        assert.equal(s2.has("stale"), false); assert.equal(saves2.length, 0);
        // a load that throws synchronously, or rejects, still allows saving
        const s3 = new SavedUrlSet(10, 1e9); const saves3: any[] = [];
        s3.attach({ load: () => { throw new Error("x"); }, save: e => saves3.push(e) });
        s3.add("y"); await tick(); mock.timers.tick(15000); assert.equal(saves3.length, 1);
        // expired entries are dropped on load
        const s4 = new SavedUrlSet(10, 1000);
        s4.attach({ load: async () => [["old", now() - 5000], ["new", now()]], save: () => { } }); await tick();
        assert.equal(s4.has("old"), false); assert.equal(s4.has("new"), true);

    } finally {
        mock.timers.reset();
    }
});

test("Precacher: load merge, run, clear, stop", async () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000_000 });
    try {
        const d = deferred<string[] | undefined>();
        const saves: string[][] = [];
        const p = new Precacher({ fetch: async () => true, load: () => d.promise, save: u => saves.push(u) });
        let notified = 0; p.subscribe(() => notified++);
        p.mark("session");
        mock.timers.tick(5000); assert.equal(saves.length, 0);
        d.resolve(["saved1", "saved2", 3 as any]); await tick();
        assert.ok(p.has("saved1") && p.has("session") && !p.has(3 as any)); assert.ok(notified >= 1);
        mock.timers.tick(15000);
        assert.deepEqual(saves[0], ["saved1", "saved2", "session"]);
        const run = p.start("Favorites", [() => "a", async () => "b", () => null]);
        await tick(); await tick();
        const res = await run;
        assert.equal(res.done, 3); assert.equal(res.failed, 1); assert.ok(p.has("a") && p.has("b"));
        p.clear(); assert.deepEqual(saves.at(-1), []);
        p.mark("z"); p.stop(); assert.deepEqual(saves.at(-1), ["z"]);
        p.mark("after-stop"); mock.timers.tick(5000); assert.deepEqual(saves.at(-1), ["z"]);
        // clear during load
        const d2 = deferred<string[] | undefined>(); const s2: any[] = [];
        const p2 = new Precacher({ fetch: async () => true, load: () => d2.promise, save: u => s2.push(u) });
        p2.clear(); d2.resolve(["stale"]); await tick(); assert.equal(p2.has("stale"), false); assert.deepEqual(s2, [[]]);

    } finally {
        mock.timers.reset();
    }
});

test("KlipyResolver: load, search, extra results, save, clear, stuck load", async () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000_000 });
    try {
        const d = deferred<Record<string, string> | undefined>();
        const saves: Record<string, string>[] = [];
        let searches = 0;
        const k = new KlipyResolver({
            search: async (q, format) => { searches++; return [{ url: "https://klipy.com/gifs/foo-bar", src: `https://low/${format}` }, { url: "https://klipy.com/gifs/other", src: "https://low/other" }]; },
            load: () => d.promise,
            save: e => saves.push(e),
        });
        const r = k.resolve("https://klipy.com/gifs/foo-bar", ["tinywebp"]);
        d.resolve({ "tinywebp|klipy.com/gifs/saved": "https://low/saved", bad: 3 as any }); await tick();
        const hit = await r;
        assert.equal(hit, "https://low/tinywebp"); assert.equal(searches, 1);
        assert.equal(k.peek("https://klipy.com/gifs/saved", ["tinywebp"]), "https://low/saved");
        mock.timers.tick(15500);
        assert.equal(saves.length, 1); assert.ok("tinywebp|klipy.com/gifs/foo-bar" in saves[0]); assert.ok(!("bad" in saves[0]));
        assert.equal(k.peek("https://klipy.com/gifs/other", ["tinywebp"]), "https://low/other", "extra moves to saved");
        k.flush(); assert.equal(saves.length, 2); assert.ok("tinywebp|klipy.com/gifs/other" in saves[1]);
        k.clear(); assert.deepEqual(saves.at(-1), {});
        k.stop();
        // A load that never settles: resolve still runs after the 2 s cap and saving waits
        const k2 = new KlipyResolver({ search: async () => [], load: () => new Promise(() => { }), save: e => saves.push(e) });
        const before = saves.length;
        const r2 = k2.resolve("https://klipy.com/gifs/x", ["tinywebp"]);
        await tick(); mock.timers.tick(15000); await tick(); await tick(); mock.timers.tick(300); await tick();
        assert.equal(await r2, null);
        mock.timers.tick(5000); assert.equal(saves.length, before, "no save before the load");

    } finally {
        mock.timers.reset();
    }
});

test("TenorPageResolver: load, resolve, save, clear, no store", async () => {
    mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000_000 });
    try {
        const saves: any[] = [];
        const t = new TenorPageResolver({ load: async () => ({ "https://tenor.com/view/a.gif": "https://media.tenor.com/xAAAAC/a.gif" }), save: e => saves.push(e) });
        await tick();
        assert.equal(t.peek("https://tenor.com/view/a.gif"), "https://media.tenor.com/xAAAAC/a.gif");
        (globalThis as any).fetch = async () => ({ ok: true, url: "https://media.tenor.com/yAAAAC/b.gif" });
        await t.resolve("https://tenor.com/view/b.gif");
        mock.timers.tick(15000);
        assert.equal(saves.length, 1); assert.equal(Object.keys(saves[0]).length, 2);
        t.clear(); assert.deepEqual(saves.at(-1), {});
        const t2 = new TenorPageResolver(); await tick(); t2.clear(); t2.stop();

    } finally {
        mock.timers.reset();
    }
});
