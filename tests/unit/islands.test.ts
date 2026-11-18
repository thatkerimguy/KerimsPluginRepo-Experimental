/*
 * Chat Islands pure parts: the marker format (shared with Kotlin), the provider
 * registry, the display view of a message, the island store and the
 * prepare → measure → ready pipeline.
 */

import assert from "node:assert/strict";
import { mock, test } from "node:test";

import type { IslandMessage, IslandProvider } from "../../valenced/chat-islands/js/api.ts";
import { displayMessage } from "../../valenced/chat-islands/js/display.ts";
import { decodeMarker, encodeMarker, MARKER_PREFIX, placeholderEmbed } from "../../valenced/chat-islands/js/marker.ts";
import { MAX_ATTEMPTS, MAX_HEIGHT, Pipeline, RETRY_AFTER_MS } from "../../valenced/chat-islands/js/pipeline.ts";
import { Registry } from "../../valenced/chat-islands/js/registry.ts";
import { IslandStore } from "../../valenced/chat-islands/js/store.ts";

const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

class FakeMessage implements IslandMessage {
    id: string;
    channel_id = "c1";
    content: string;
    embeds: { url?: string; type?: string; }[];
    constructor(id: string, content: string, embeds: { url?: string; type?: string; }[] = []) {
        this.id = id;
        this.content = content;
        this.embeds = embeds;
    }
    isFake() {
        return this.id;
    }
}

const linkProvider = (id = "links"): IslandProvider<string> => ({
    id,
    match: m => [...m.content.matchAll(/https:\/\/\S+/g)].map((x, i) => ({
        id: x[0],
        replacesEmbed: m.embeds.findIndex(e => e.url === x[0]) === -1 ? null : m.embeds.findIndex(e => e.url === x[0]),
        data: x[0],
    })).filter((_, i) => i < 5),
    component: () => null,
});

test("marker: round trip, appended parameters, rejects", () => {
    const url = encodeMarker({ key: "social-embeds:123:https://x.com/a/status/1", width: 320.4, height: 410.6 });
    assert.ok(url.startsWith(MARKER_PREFIX));
    assert.deepEqual(decodeMarker(url), { key: "social-embeds:123:https://x.com/a/status/1", width: 320, height: 411 });
    assert.deepEqual(decodeMarker(`${url}&format=webp&width=640`), { key: "social-embeds:123:https://x.com/a/status/1", width: 320, height: 411 });
    // Discord's getSrcWithWidthAndHeight re-serialises the query
    const [base, query] = url.split("?");
    assert.deepEqual(decodeMarker(`${base}?format=png&${query.split("&").reverse().join("&")}&width=320&height=411`), { key: "social-embeds:123:https://x.com/a/status/1", width: 320, height: 411 });
    assert.equal(decodeMarker(`${base}?width=320&height=411`), null);
    assert.equal(decodeMarker("https://cdn.discordapp.com/a.png"), null);
    assert.equal(decodeMarker(`${MARKER_PREFIX}abc`), null);
    assert.equal(decodeMarker(null), null);
    const embed = placeholderEmbed({ key: "k", width: 300, height: 200 });
    assert.equal(embed.type, "image");
    // Discord's native embed view shows an Image embed's inline media from `image` only
    // url, width, height and srcIsAnimated are required by native EmbedMedia
    assert.deepEqual(embed.image, { url: embed.url, proxyURL: embed.url, width: 300, height: 200, srcIsAnimated: false });
    assert.equal(embed.thumbnail, undefined);
});

test("registry: match, memo, one island per embed, owners, bad providers", () => {
    const r = new Registry();
    let changes = 0;
    r.onChange = () => changes++;
    const errors: string[] = [];
    r.onError = id => errors.push(id);
    const off = r.register("plugin-a", linkProvider());
    assert.throws(() => r.register("plugin-a", linkProvider()), /already registered/);
    assert.throws(() => r.register("plugin-a", { id: "x" } as never), /needs id, match and component/);
    r.register("plugin-b", linkProvider("second"));
    r.register("plugin-b", { id: "broken", match: () => { throw new Error("boom"); }, component: () => null });

    const m = new FakeMessage("m1", "see https://a.test/1 and https://b.test/2", [{ url: "https://b.test/2" }]);
    const slots = r.slotsFor(m);
    // links: two islands; second: only the one without an embed taken (b.test/2's embed is taken by "links")
    assert.deepEqual(slots.map(s => s.key), ["links:m1:https://a.test/1", "links:m1:https://b.test/2", "second:m1:https://a.test/1"]);
    assert.deepEqual(errors, ["broken"]);
    assert.equal(r.slotsFor(m), slots, "memoized while unchanged");
    m.content = "edited https://a.test/1";
    assert.notEqual(r.slotsFor(m), slots);

    assert.equal(changes, 3);
    off();
    r.unregisterOwner("plugin-b");
    assert.equal(r.size, 0);
    assert.deepEqual(r.slotsFor(m), []);
});

test("displayMessage: placeholders replace or append, record untouched, prototype kept", () => {
    const m = new FakeMessage("m1", "x", [{ url: "https://a.test/1" }, { url: "https://b.test/2" }]);
    assert.equal(displayMessage(m, []), m);
    const shown = displayMessage(m, [
        { key: "k1", replacesEmbed: 1, width: 300, height: 200 },
        { key: "k2", replacesEmbed: null, width: 300, height: 100 },
    ]);
    assert.notEqual(shown, m);
    assert.deepEqual(shown.embeds.map(e => e.url?.slice(0, MARKER_PREFIX.length) === MARKER_PREFIX ? decodeMarker(e.url)!.key : e.url), ["https://a.test/1", "k1", "k2"]);
    assert.equal(m.embeds.length, 2);
    assert.equal(m.embeds[1].url, "https://b.test/2");
    assert.ok(shown instanceof FakeMessage);
    assert.equal(shown.isFake(), "m1");
    assert.equal(shown.content, "x");
});

test("store: ensure, edits restart, state, listeners, eviction", () => {
    const s = new IslandStore(10);
    const p = linkProvider();
    const m = new FakeMessage("m1", "a");
    const isl = s.ensure("k", p, { id: "a", replacesEmbed: null, data: "a" }, m);
    assert.equal(isl.phase, "new");
    s.update("k", { phase: "ready", width: 300, height: 200 });
    // Same content, new record object: stays ready
    s.ensure("k", p, isl.slot, new FakeMessage("m1", "a"));
    assert.equal(s.get("k")!.phase, "ready");
    // Edited: starts over
    s.ensure("k", p, isl.slot, new FakeMessage("m1", "b"));
    assert.equal(s.get("k")!.phase, "new");
    assert.equal(s.get("k")!.height, undefined);

    let calls = 0;
    const unsub = s.subscribe("k", () => calls++);
    assert.equal(s.getState("k", "page", 0), 0);
    s.setState("k", "page", 3);
    s.setState("k", "page", 3);
    assert.equal(s.getState("k", "page", 0), 3);
    assert.equal(calls, 1);
    unsub();
    s.setState("k", "page", 4);
    assert.equal(calls, 1);

    for (let i = 0; i < 20; i++) s.ensure(`e${i}`, p, isl.slot, m);
    assert.ok(s.size <= 10);
    s.dropProvider(p);
    assert.equal(s.size, 0);
});

test("pipeline: prepare → measure → ready → one refresh; failures; resize; width change", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
        const store = new IslandStore();
        const refreshed: string[][] = [];
        let width = 300;
        const measured: string[] = [];
        let heights: Record<string, number> = { "links:m1:https://a.test/1": 240.2, "links:m1:https://b.test/2": 3 };
        const prepared: string[] = [];
        const provider: IslandProvider<string> = {
            ...linkProvider(),
            prepare: async slot => {
                prepared.push(slot.id);
                if (slot.id.includes("fail")) throw new Error("not found");
            },
        };
        const pipeline = new Pipeline({
            store,
            measure: async (island, w) => { measured.push(`${island.key}@${w}`); return heights[island.key] ?? 5000; },
            chatWidth: () => width,
            refresh: ids => refreshed.push(ids),
            concurrency: 2,
        });
        const r = new Registry();
        r.register("p", provider);
        const m = new FakeMessage("m1", "https://a.test/1 https://b.test/2 https://fail.test/3 https://c.test/4");
        const slots = r.slotsFor(m);

        assert.deepEqual(pipeline.collect(slots, m), []);
        await tick();
        mock.timers.tick(20);
        await tick();
        mock.timers.tick(20);
        assert.deepEqual(prepared.sort(), ["https://a.test/1", "https://b.test/2", "https://c.test/4", "https://fail.test/3"]);
        assert.equal(store.get("p:m1:https://fail.test/3"), undefined, "keys use the provider id");
        const key = (u: string) => `links:m1:${u}`;
        assert.equal(store.get(key("https://fail.test/3"))!.phase, "failed");
        assert.equal(store.get(key("https://b.test/2"))!.phase, "failed", "too short to be real");
        assert.equal(store.get(key("https://a.test/1"))!.height, 241);
        assert.equal(store.get(key("https://c.test/4"))!.height, MAX_HEIGHT);
        assert.deepEqual(refreshed, [["m1"]], "one refresh for the whole batch");

        const ready = pipeline.collect(slots, m);
        assert.deepEqual(ready.map(x => [x.key, x.height]), [[key("https://a.test/1"), 241], [key("https://c.test/4"), MAX_HEIGHT]]);

        // Resize with the same height: no refresh
        measured.length = 0;
        pipeline.resize(key("https://a.test/1"));
        await tick();
        assert.deepEqual(measured, [`${key("https://a.test/1")}@300`]);
        mock.timers.tick(20);
        assert.equal(refreshed.length, 1);

        // Width change: old size shown meanwhile, then re-measured at the new width
        width = 400;
        heights = { ...heights, [key("https://a.test/1")]: 200 };
        const during = pipeline.collect(slots, m);
        assert.deepEqual(during.map(x => [x.width, x.height]), [[300, 241], [300, MAX_HEIGHT]]);
        await tick();
        mock.timers.tick(20);
        await tick();
        mock.timers.tick(20);
        assert.equal(store.get(key("https://a.test/1"))!.height, 200);
        assert.equal(store.get(key("https://a.test/1"))!.width, 400);
        assert.equal(refreshed.length, 2);
    } finally {
        mock.timers.reset();
    }
});

test("pipeline: failed islands are tried again later, a few times", async () => {
    const store = new IslandStore();
    let clock = 1000;
    let failing = true;
    let calls = 0;
    const pipeline = new Pipeline({
        store,
        measure: async () => { calls++; if (failing) throw new Error("Measuring timed out"); return 120; },
        chatWidth: () => 300,
        refresh: () => { },
        now: () => clock,
    });
    const r = new Registry();
    r.register("p", linkProvider());
    const m = new FakeMessage("m1", "https://a.test/1");
    const slots = r.slotsFor(m);
    const key = "links:m1:https://a.test/1";

    pipeline.collect(slots, m);
    await tick();
    assert.equal(store.get(key)!.phase, "failed");
    assert.equal(store.get(key)!.attempts, 1);

    // Too soon: not tried again
    clock += RETRY_AFTER_MS - 1;
    pipeline.collect(slots, m);
    await tick();
    assert.equal(calls, 1);

    // Later: tried again, until MAX_ATTEMPTS
    for (let i = 2; i <= MAX_ATTEMPTS; i++) {
        clock += RETRY_AFTER_MS;
        pipeline.collect(slots, m);
        await tick();
        assert.equal(calls, i);
    }
    clock += RETRY_AFTER_MS;
    pipeline.collect(slots, m);
    await tick();
    assert.equal(calls, MAX_ATTEMPTS, "gives up after MAX_ATTEMPTS");

    // An edit starts it over, and a working measurement makes it ready
    failing = false;
    const edited = new FakeMessage("m1", "https://a.test/1 (edited)");
    pipeline.collect(r.slotsFor(edited), edited);
    await tick();
    assert.equal(store.get(key)!.phase, "ready");
    assert.equal(store.get(key)!.height, 120);
});
