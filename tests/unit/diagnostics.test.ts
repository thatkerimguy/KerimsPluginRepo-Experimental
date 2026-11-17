/* The "Patches" section's registry (diagnostics.ts) */

import assert from "node:assert/strict";
import { test } from "node:test";

import { clearPatches, describePatch, expectPatch, patchFailed, patchStatuses, patchWorks } from "../../vencord/gifPickerOptimizer/diagnostics.ts";

test("patches go from waiting to working or failed", () => {
    clearPatches();
    expectPatch("a", "Tiles", "open the GIF picker");
    expectPatch("b", "Search", "search for GIFs");
    patchWorks("a");
    patchWorks("unknown");
    patchFailed("b", "not found");
    assert.deepEqual(patchStatuses().map(describePatch), ["Working", "Failed: not found"]);
    expectPatch("c", "Main page", "open it");
    assert.equal(describePatch(patchStatuses()[2]), "Not seen yet: open it");
    clearPatches();
    assert.deepEqual(patchStatuses(), []);
});
