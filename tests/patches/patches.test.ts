/*
 * Checks the Vencord patches against Discord's current code, from the datamined
 * client at github.com/Wumpus-Central/discrapper-canary (downloaded, not kept here).
 * Each `find` must be in its chunk, and each replacement must match exactly once
 * and leave valid JavaScript, like Vencord's patcher needs.
 *
 * DISCORD_REF picks the datamine commit (default: main, Discord's latest canary).
 * Chunk ids usually stay the same between builds; when a find string isn't in its
 * chunk any more, search the datamine for it and update CHUNKS.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { transform } from "esbuild";

import { patches } from "../../vencord/gifPickerOptimizer/patches.ts";

const REF = process.env.DISCORD_REF ?? "main";
/** find string -> datamined chunk id */
const CHUNKS: Record<string, string> = {
    "renderEmptyFavorite": "884037",
    '"GIF_PICKER_QUERY_SUCCESS",query:': "497685",
    "hideFavoritesTile:": "649529",
};

/** Vencord's canonicalizeMatch for `\i` (src/utils/patches.ts) */
function canonicalize(match: RegExp) {
    const source = match.source.replaceAll(/(\\*)\\i/g, (m, escapes: string) =>
        escapes.length % 2 === 0 ? `${escapes}(?:[A-Za-z_$][\\w$]*)` : m.slice(1));
    return new RegExp(source, match.flags);
}

/** The chunk as Discord ships it: the datamine is pretty-printed, so minify the whitespace back */
async function chunk(id: string) {
    const res = await fetch(`https://raw.githubusercontent.com/Wumpus-Central/discrapper-canary/${REF}/chunks/${id}.js`);
    assert.ok(res.ok, `chunk ${id}: HTTP ${res.status}`);
    const { code } = await transform(await res.text(), { minifyWhitespace: true, loader: "js" });
    return code;
}

for (const patch of patches) {
    const find = String(patch.find);
    test(`patch "${find}"`, async () => {
        const id = CHUNKS[find];
        assert.ok(id, `no chunk listed for find ${find}`);
        let code = await chunk(id);
        assert.ok(code.includes(find), `find ${find} isn't in chunk ${id} any more`);

        const replacements = Array.isArray(patch.replacement) ? patch.replacement : [patch.replacement];
        for (const { match, replace } of replacements) {
            const re = canonicalize(match as RegExp);
            const count = [...code.matchAll(new RegExp(re.source, `${re.flags.replace("g", "")}g`))].length;
            assert.equal(count, 1, `${match} matches ${count} times in chunk ${id}`);
            code = code.replace(re, (replace as string).replaceAll("$self", "Vencord.Plugins.plugins[\"GIFs+\"]"));
        }
        // The patched module must still parse
        await transform(code, { loader: "js" });
    });
}
