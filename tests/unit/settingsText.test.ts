/* The shared settings wording (settingsText.ts) and the patch summary (diagnostics.ts) */

import assert from "node:assert/strict";
import { test } from "node:test";

import { clearPatches, expectPatch, patchFailed, patchWorks, summarizePatches } from "../../vencord/gifPickerOptimizer/diagnostics.ts";
import { cacheStatRows, cacheSummary, QUALITY_CHOICES, TEXT } from "../../vencord/gifPickerOptimizer/settingsText.ts";

const numbers = {
    loaded: 340, loadedMax: 1000, seen: 1200, seenMax: 5000, klipySaved: 12, klipyRecent: 40,
    searchPreviews: 100, failed: 1, memoryBytes: 1.5 * 1024 * 1024,
};

test("cache summary and rows", () => {
    assert.equal(cacheSummary(numbers), "About 1.5 MB in memory · 340 GIFs loaded this session");
    assert.equal(cacheSummary({ ...numbers, loaded: 1 }), "About 1.5 MB in memory · 1 GIF loaded this session");
    const rows = cacheStatRows(numbers);
    assert.deepEqual(rows.map(r => r.label), [
        "Loaded this session", "Remembered across restarts (two weeks)", "Klipy favourites looked up",
        "Small search previews", "Previews that failed (kept a week)", "Memory used",
    ]);
    assert.equal(rows[0].value, "340 of 1000");
    // Build-specific rows only when the build has them
    const mobile = cacheStatRows({ ...numbers, tenorSaved: 5 }).map(r => r.label);
    assert.ok(mobile.includes("Tenor favourites looked up"));
    const desktop = cacheStatRows({ ...numbers, frames: { count: 3, bytes: 2048, budget: 24 * 1024 * 1024 } });
    assert.equal(desktop.find(r => r.label === "Still frames")?.value, "3 (2 KB of 24.0 MB)");
});

test("patch summary", () => {
    clearPatches();
    assert.equal(summarizePatches(), "Enable the plugin to see its patches");
    expectPatch("a", "A", "x");
    expectPatch("b", "B", "y");
    expectPatch("c", "C", "z");
    assert.equal(summarizePatches(), "3 not seen yet");
    patchWorks("a");
    patchFailed("c", "gone");
    assert.equal(summarizePatches(), "1 working, 1 not seen yet, 1 failed");
    patchWorks("b");
    patchWorks("c");
    assert.equal(summarizePatches(), "All 3 working");
    clearPatches();
});

test("every preview size and setting has words", () => {
    assert.deepEqual(QUALITY_CHOICES.map(c => c.value), ["xs", "s", "sd", "auto", "original"]);
    for (const c of QUALITY_CHOICES) assert.ok(c.label && c.short && c.detail);
    for (const [key, t] of Object.entries(TEXT)) assert.ok(t.title && t.description, key);
});
