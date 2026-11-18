// Records real API responses for the Social Embeds resolver tests (see README.md).
// Usage: node tests/fixtures/social/record.mjs   (Node 22+, normal internet access)
//
// Fill in the post ids: pick public, long-lived posts that show each case.
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const CASES = [
    // [file name, URL]
    ["fxtwitter-20-photos", "https://api.fxtwitter.com/i/status/REPLACE_WITH_A_20_PHOTO_POST_ID"],
    ["fxtwitter-video-quote-poll", "https://api.fxtwitter.com/i/status/REPLACE_WITH_A_VIDEO_POST_ID"],
    ["fxtwitter-not-found", "https://api.fxtwitter.com/i/status/1"],
    ["reddit-gallery-comments", "https://www.reddit.com/comments/REPLACE_WITH_A_GALLERY_POST_ID.json?raw_json=1&limit=50&depth=6"],
    ["reddit-video", "https://www.reddit.com/comments/REPLACE_WITH_A_VIDEO_POST_ID.json?raw_json=1&limit=50&depth=6"],
];

for (const [name, url] of CASES) {
    if (url.includes("REPLACE_WITH")) {
        console.log(`skip ${name}: no post id set`);
        continue;
    }
    const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "social-embeds-fixture-recorder/1.0" } });
    const text = await res.text();
    let body;
    try {
        body = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
        console.log(`fail ${name}: HTTP ${res.status}, not JSON`);
        continue;
    }
    await writeFile(join(here, `${name}.recorded.json`), `${body}\n`);
    console.log(`ok   ${name}: HTTP ${res.status}`);
}
