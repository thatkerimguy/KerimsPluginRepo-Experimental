/* Favourites export / import (transfer.ts) */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    applyImport, buildExport, createFavoritesBackend, type FavoriteMap, formatExport, importFavorites,
    importSummary, otherSitesWarning, parseExport, protoBytes, urlHost,
} from "../../vencord/gifPickerOptimizer/transfer.ts";

const exportOf = (gifs: unknown[]) => JSON.stringify({ format: "gifs-plus", version: 1, gifs });
const tenor = (n: number) => ({ url: `https://tenor.com/view/cat-${n}`, src: `https://media.tenor.com/abc${n}AAAPo/cat.mp4`, width: 200, height: 100, format: 2 });

test("export round trip keeps every favourite, newest first", () => {
    const gifs: FavoriteMap = {
        "https://tenor.com/view/a": { src: "https://media.tenor.com/aAAAPo/a.mp4", order: 1, format: 2, width: 1, height: 2 },
        "https://tenor.com/view/b": { src: "https://media.tenor.com/bAAAPo/b.mp4", order: 5, format: 1, width: 3, height: 4 },
    };
    const parsed = parseExport(formatExport(buildExport(gifs)));
    assert.deepEqual(parsed.gifs.map(g => g.url), ["https://tenor.com/view/b", "https://tenor.com/view/a"]);
    assert.equal(parsed.skipped, 0);
    assert.deepEqual(parsed.otherSites, []);
    assert.equal(otherSitesWarning(parsed), null);
});

test("parse errors are readable", () => {
    assert.throws(() => parseExport("nope"), /not valid JSON/);
    assert.throws(() => parseExport("{}"), /isn't a GIFs\+ export/);
    assert.throws(() => parseExport(JSON.stringify({ format: "gifs-plus", version: 2, gifs: [] })), /newer version/);
    // A byte order mark is fine
    assert.equal(parseExport(`﻿${exportOf([tenor(1)])}`).gifs.length, 1);
});

test("import skips non-https entries and lists other sites", () => {
    const parsed = parseExport(exportOf([
        tenor(1),
        { url: "http://tenor.com/view/x", src: "https://media.tenor.com/xAAAPo/x.mp4" },
        { url: "https://tenor.com/view/y", src: "javascript:alert(1)" },
        { url: "https://evil.example/phish", src: "https://media.tenor.com/zAAAPo/z.mp4" },
        { url: "https://i.imgur.com/a.gifv", src: "https://tracker.example/pixel.gif" },
        { url: "https://evil.example/2", src: "https://tracker.example/2.gif" },
        { url: "//cdn.discordapp.com/attachments/1/2/a.gif", src: "https://media.discordapp.net/attachments/1/2/a.gif" },
        "not an object",
    ]));
    assert.equal(parsed.gifs.length, 5);
    assert.equal(parsed.skipped, 3);
    assert.deepEqual(parsed.otherSites, ["evil.example", "tracker.example"]);
    assert.match(otherSitesWarning(parsed)!, /evil\.example, tracker\.example\. .*Only import files you made yourself or trust/);
});

test("import sanitizes sizes and formats", () => {
    const [g] = parseExport(exportOf([{ ...tenor(1), width: 1e20, height: -5, format: 7 }])).gifs;
    assert.equal(g.width, 0xffff_ffff);
    assert.equal(g.height, undefined);
    assert.equal(g.format, undefined);
    const gifs: FavoriteMap = {};
    applyImport(gifs, parseExport(exportOf([{ ...tenor(1), format: 7 }])), "merge");
    assert.equal(Object.values(gifs)[0].format, 1, "unknown formats become GIFType.IMAGE");
});

test("urlHost", () => {
    assert.equal(urlHost("https://Media.Tenor.com/x"), "media.tenor.com");
    assert.equal(urlHost("//cdn.discordapp.com:443/a"), "cdn.discordapp.com");
    assert.equal(urlHost("http://x.com"), "");
});

test("merge keeps existing favourites and matches attachments without their signature", () => {
    const gifs: FavoriteMap = {
        "https://cdn.discordapp.com/attachments/1/2/a.gif": { src: "s", order: 3 },
    };
    const file = parseExport(exportOf([
        { url: "https://cdn.discordapp.com/attachments/1/2/a.gif?ex=1&is=2&hm=3&", src: "https://media.discordapp.net/a.gif" },
        tenor(1),
        tenor(2),
    ]));
    assert.equal(applyImport(gifs, file, "merge"), 2);
    assert.equal(gifs["https://tenor.com/view/cat-1"].order, 5, "newest gets the highest order");
    assert.equal(gifs["https://tenor.com/view/cat-2"].order, 4);
    assert.equal(applyImport(gifs, file, "overwrite"), 3);
    assert.equal(Object.keys(gifs).length, 3);
});

function fakeActions(initial: FavoriteMap, onUpdate?: (gifs: FavoriteMap) => void) {
    const state = { gifs: initial };
    return {
        state,
        actions: {
            getCurrentValue: () => ({ favoriteGifs: { gifs: state.gifs } }),
            async updateAsync(_key: "favoriteGifs", updater: (v: { gifs?: FavoriteMap; }) => unknown) {
                await Promise.resolve();
                const copy = { gifs: structuredClone(state.gifs) };
                onUpdate?.(copy.gifs); // a favourite synced in between
                if (updater(copy) !== false) state.gifs = copy.gifs!;
            },
        },
    };
}

test("importFavorites applies inside Discord's update and reports the result", async () => {
    const { state, actions } = fakeActions({}, gifs => { gifs["https://tenor.com/view/synced"] = { src: "s", order: 9 }; });
    const backend = createFavoritesBackend(() => actions);
    const result = await importFavorites(backend, parseExport(exportOf([tenor(1), { url: "http://x", src: "y" }])), "merge");
    assert.deepEqual(result, { added: 1, total: 2, skipped: 1 });
    assert.ok(state.gifs["https://tenor.com/view/synced"], "a favourite synced meanwhile is kept");
    assert.equal(importSummary(result), "Imported 1 GIF (1 skipped). 2 GIFs in favourites now.");
});

test("importFavorites refuses imports over Discord's size limit and changes nothing", async () => {
    const { state, actions } = fakeActions({});
    const backend = createFavoritesBackend(() => actions);
    const many = Array.from({ length: 10_000 }, (_, i) => tenor(i));
    await assert.rejects(importFavorites(backend, parseExport(exportOf(many)), "merge"), /more GIFs than Discord allows/);
    assert.deepEqual(state.gifs, {});
});

test("importFavorites needs Discord's favourites", async () => {
    let missing = 0;
    const backend = createFavoritesBackend(() => undefined, () => missing++);
    await assert.rejects(importFavorites(backend, parseExport(exportOf([tenor(1)])), "merge"), /haven't loaded yet/);
    assert.equal(await backend.update(() => { }), false);
    assert.equal(missing, 1);
});

test("protoBytes uses the FavoriteGIFs proto when it can find it", () => {
    const proto = { fields: [{ localName: "favoriteGifs", kind: "message", T: () => ({ create: (v: object) => v, toBinary: (m: { gifs: object; }) => ({ length: Object.keys(m.gifs).length * 10 }) }) }] };
    assert.equal(protoBytes(proto, { a: { src: "x" }, b: { src: "y" } }), 20);
    assert.equal(protoBytes({}, {}), undefined);
    assert.equal(protoBytes({ fields: [{ localName: "favoriteGifs", kind: "message", T: () => { throw new Error(); } }] }, {}), undefined);
});
