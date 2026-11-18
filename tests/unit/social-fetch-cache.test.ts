/*
 * Social Embeds HTTP client (per-host limit, one request per URL, retries,
 * Retry-After, errors) and the stale-while-revalidate cache.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { SwrCache } from "../../valenced/social-embeds/js/core/cache.ts";
import { createHttpClient, HttpError, NotFoundError, ParseError, type FetchResponse } from "../../valenced/social-embeds/js/core/fetcher.ts";

const response = (status: number, body = "", headers: Record<string, string> = {}, url = ""): FetchResponse => ({
    status,
    url,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    text: async () => body,
});

const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test("one request for the same URL, at most perHost at once", async () => {
    const pending: (() => void)[] = [];
    const calls: string[] = [];
    const http = createHttpClient(url => {
        calls.push(url);
        return new Promise(r => pending.push(() => r(response(200, `{"u":"${url}"}`))));
    }, { perHost: 2 });
    const a = http.getJson("https://h.test/1");
    const b = http.getJson("https://h.test/1");
    const c = http.getJson("https://h.test/2");
    const d = http.getJson("https://h.test/3");
    const e = http.getJson("https://other.test/1");
    await tick();
    assert.deepEqual(calls, ["https://h.test/1", "https://h.test/2", "https://other.test/1"]);
    pending.shift()!();
    await tick();
    assert.deepEqual(calls.at(-1), "https://h.test/3");
    while (pending.length) pending.shift()!();
    assert.deepEqual(await a, { u: "https://h.test/1" });
    // One request; each caller gets its own parsed copy
    assert.deepEqual(await a, await b);
    assert.equal(calls.filter(u => u === "https://h.test/1").length, 1);
    await Promise.all([c, d, e]);
});

test("retries 429 / 5xx / network errors with backoff and Retry-After", async () => {
    const sleeps: number[] = [];
    const answers = [response(503), response(429, "", { "retry-after": "5" }), response(200, "ok")];
    const http = createHttpClient(async () => answers.shift()!, { sleep: async ms => { sleeps.push(ms); }, retryDelays: [1000, 3000] });
    assert.deepEqual(await http.getText("https://h.test/x"), { text: "ok", url: "https://h.test/x" });
    assert.deepEqual(sleeps, [1000, 5000]);

    let n = 0;
    const flaky = createHttpClient(async () => {
        if (n++ === 0) throw new TypeError("Network request failed");
        return response(200, "{}");
    }, { sleep: async () => { } });
    assert.deepEqual(await flaky.getJson("https://h.test/y"), {});
});

test("final errors: 404, 403, long Retry-After, bad JSON, retries exhausted", async () => {
    const once = (r: FetchResponse) => createHttpClient(async () => r, { sleep: async () => { } });
    await assert.rejects(once(response(404)).getJson("https://h.test/a"), NotFoundError);
    await assert.rejects(once(response(403)).getJson("https://h.test/a"), (e: unknown) => e instanceof HttpError && e.status === 403);
    await assert.rejects(once(response(429, "", { "retry-after": "120" })).getJson("https://h.test/a"), /Rate limited for 120 s/);
    await assert.rejects(once(response(200, "<html>")).getJson("https://h.test/a"), ParseError);
    await assert.rejects(once(response(500)).getJson("https://h.test/a"), (e: unknown) => e instanceof HttpError && e.status === 500);
});

test("resolveRedirect returns the final URL", async () => {
    const http = createHttpClient(async (url, init) => {
        assert.equal(init?.method, "HEAD");
        return response(200, "", {}, "https://www.tiktok.com/@a/video/123");
    });
    assert.equal(await http.resolveRedirect("https://vm.tiktok.com/ZMabc/"), "https://www.tiktok.com/@a/video/123");
});

test("SwrCache: fresh, stale with background refresh, expired, LRU, restore", async () => {
    let now = 0;
    const cache = new SwrCache<string>(2, { freshFor: 100, usableFor: 1000 }, () => now);
    let loads = 0;
    const loader = async () => `v${++loads}`;

    assert.deepEqual(await cache.get("a", loader), { value: "v1", fresh: true });
    now = 50;
    assert.deepEqual(await cache.get("a", loader), { value: "v1", fresh: true });
    now = 500;
    const refreshed: string[] = [];
    assert.deepEqual(await cache.get("a", loader, v => refreshed.push(v)), { value: "v1", fresh: false });
    await tick();
    assert.deepEqual(refreshed, ["v2"]);
    now = 2000;
    assert.equal(cache.peek("a"), undefined);

    // One load for concurrent callers
    const [x, y] = await Promise.all([cache.get("b", loader), cache.get("b", loader)]);
    assert.equal(x.value, y.value);
    cache.set("c", "c");
    cache.set("d", "d");
    assert.equal(cache.size, 2);
    assert.equal(cache.peek("b"), undefined);

    const saved = cache.entries();
    const other = new SwrCache<string>(5, { freshFor: 100, usableFor: 1000 }, () => now);
    other.set("d", "newer");
    other.restore([...saved, ["old", { value: "x", at: -5000 }]]);
    assert.equal(other.peek("d")?.value, "newer");
    assert.equal(other.peek("c")?.value, "c");
    assert.equal(other.peek("old"), undefined);
});
