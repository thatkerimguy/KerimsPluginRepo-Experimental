/*
 * The Discord mobile modules Chat Islands relies on still exist, with the
 * exports it patches, in Discord's current mobile code
 * (github.com/Wumpus-Central/discord-mobile-datamining). Run with
 * `npm run test:patches`; DISCORD_MOBILE_REF picks another commit.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

const REF = process.env.DISCORD_MOBILE_REF ?? "main";

async function source(path: string) {
    const res = await fetch(`https://raw.githubusercontent.com/Wumpus-Central/discord-mobile-datamining/${REF}/discord_app/${path}`);
    assert.equal(res.status, 200, `${path} is missing (HTTP ${res.status})`);
    return res.text();
}

// [module path as getModuleWithImportedPath sees it, pattern that must be in it]
const MODULES: [string, RegExp][] = [
    ["modules/messages/native/renderer/MessageWithContent.tsx", /export function generateMessageRowData\(/],
    ["modules/messages/native/renderer/MessageWithContent.tsx", /message: createMessageContentDefault\(/],
    ["modules/messages/native/hooks/useRowManager.tsx", /\bupdateRows,/],
    ["modules/messages/native/hooks/useRowManager.tsx", /export default function/],
    ["modules/messages/native/long_press/showLongPressMessageActionSheet.tsx", /export (default )?function/],
    // Placeholders are image embeds: transformEmbeds must still read a thumbnail's proxyURL, width and height
    ["modules/messages/native/renderer/transformEmbeds.tsx", /null != type\.thumbnail/],
    ["modules/messages/native/renderer/transformEmbeds.tsx", /\(\{ proxyURL, width, height \} = thumbnail\)/],
];

for (const [path, pattern] of MODULES) {
    test(`${path}: ${pattern.source}`, async () => {
        assert.match(await source(path), pattern);
    });
}
