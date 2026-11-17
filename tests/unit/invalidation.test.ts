/* The caches are cleared when a setting or the plugin version changes (invalidation.ts) */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createCacheInvalidation } from "../../vencord/gifPickerOptimizer/invalidation.ts";

const tick = () => new Promise(r => setTimeout(r, 1));

function setup() {
    const reasons: string[] = [];
    let resets = 0;
    const inv = createCacheInvalidation({
        reset: () => void resets++,
        onReset: reason => void reasons.push(reason),
    });
    return { inv, reasons, resets: () => resets };
}

test("several setting changes at once clear the caches once", async () => {
    const { inv, resets, reasons } = setup();
    inv.start();
    inv.settingsChanged();
    inv.settingsChanged();
    inv.settingsChanged();
    await tick();
    assert.equal(resets(), 1);
    assert.deepEqual(reasons, ["settings changed"]);
    inv.settingsChanged();
    await tick();
    assert.equal(resets(), 2);
});

test("nothing is cleared before start or after stop", async () => {
    const { inv, resets } = setup();
    inv.settingsChanged();
    await tick();
    inv.start();
    inv.settingsChanged();
    inv.stop();
    await tick();
    assert.equal(resets(), 0);
});

test("a different saved version clears the caches and saves the new one", async () => {
    const { inv, resets, reasons } = setup();
    inv.start();
    const saved: string[] = [];
    await inv.checkVersion("1.7.2", { load: async () => "1.7.1", save: v => void saved.push(v) });
    assert.equal(resets(), 1);
    assert.deepEqual(saved, ["1.7.2"]);
    assert.deepEqual(reasons, ["version changed from 1.7.1 to 1.7.2"]);
});

test("the same version clears nothing; no saved version (first start) clears once", async () => {
    const { inv, resets } = setup();
    inv.start();
    const saved: string[] = [];
    await inv.checkVersion("1.7.2", { load: () => "1.7.2", save: v => void saved.push(v) });
    assert.equal(resets(), 0);
    assert.deepEqual(saved, []);
    await inv.checkVersion("1.7.2", { load: () => undefined, save: v => void saved.push(v) });
    assert.equal(resets(), 1);
    assert.deepEqual(saved, ["1.7.2"]);
});

test("a version check that finishes after stop clears nothing", async () => {
    const { inv, resets } = setup();
    inv.start();
    let release!: (v: string) => void;
    const check = inv.checkVersion("1.7.2", { load: () => new Promise<string>(r => (release = r)), save: () => { } });
    inv.stop();
    release("1.7.1");
    await check;
    assert.equal(resets(), 0);
});

test("the desktop build's PLUGIN_VERSION matches the Valenced manifest", () => {
    const state = readFileSync(new URL("../../vencord/gifPickerOptimizer/state.ts", import.meta.url), "utf8");
    const manifest = JSON.parse(readFileSync(new URL("../../valenced/gif-picker-optimizer/manifest.json", import.meta.url), "utf8"));
    const desktop = /export const PLUGIN_VERSION = "([^"]+)"/.exec(state)?.[1];
    assert.equal(desktop, manifest.version);
});
