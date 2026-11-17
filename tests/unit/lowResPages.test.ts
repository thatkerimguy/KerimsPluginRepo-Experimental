/* LowResPages: the small search / trending request alongside Discord's, and the queue waiting for it */

import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiPreviewCache } from "../../vencord/gifPickerOptimizer/cache.ts";
import { LowResPages } from "../../vencord/gifPickerOptimizer/klipy.ts";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

test("early request, waiting for it, fallback request, disabled", async () => {
    const calls: any[] = []; const blocks: number[] = []; let released = 0;
    let enabled = true;
    const previews = new ApiPreviewCache();
    let answer: (v: unknown) => void = () => { };
    const pages = new LowResPages({
        quality: () => "s", enabled: () => enabled, selectedFormat: () => "mp4", locale: () => "en-US",
        get: (url, query) => { calls.push({ url, query }); return new Promise(r => { answer = r; }); },
        previews, block: ms => { blocks.push(ms); return () => { released++; }; }, warn: () => { },
    });
    assert.equal(pages.format(), "tinymp4");
    pages.started("cats", 50);
    assert.deepEqual(calls[0], { url: "/gifs/search", query: { q: "cats", media_format: "tinymp4", locale: "en-US", limit: 50 } });
    const items = [{ id: "1", url: "https://klipy.com/gifs/a", src: "https://static.klipy.com/a.mp4" }];
    const arrived = pages.arrived({ query: "cats", items });
    await arrived;
    assert.equal(blocks.length, 1, "queue waits for the request in flight"); assert.equal(calls.length, 1, "no second request");
    answer([{ id: "1", url: "https://klipy.com/gifs/a", src: "https://static.klipy.com/a-tiny.mp4" }]); await sleep(5);
    assert.equal(released, 1); assert.equal(previews.get("s", items[0]), "https://static.klipy.com/a-tiny.mp4");
    await pages.arrived({ query: "cats", items }); assert.equal(calls.length, 1, "cached: nothing to do");
    // no early request (patch missing): asks now, trending, blocks
    const p2 = pages.arrived({ items: [{ id: "2", url: "u2", src: "https://static.klipy.com/b.mp4" }] });
    await sleep(1); assert.equal(calls[1].url, "/gifs/trending-gifs"); assert.equal(calls[1].query.limit, 1);
    answer([]); await p2; assert.equal(released, 2);
    enabled = false; assert.equal(pages.format(), null);
    pages.started("dogs"); assert.equal(calls.length, 2, "disabled: no request");
    pages.clear();
});
