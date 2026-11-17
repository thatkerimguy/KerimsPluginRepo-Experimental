/* Low resolution and still URLs (lowres.ts). Expected values follow the codes in CLAUDE.md. */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    isTenorPageGif, klipyPageQuery, lowResMediaFormat, pageKey, rewriteUrl, stillUrl, tenorMediaFromSrc, unwrapProxyUrl,
} from "../../vencord/gifPickerOptimizer/lowres.ts";

const TENOR_GIF = "https://media.tenor.com/abcdefAAAAC/cat.gif";
const TENOR_MP4 = "https://media.tenor.com/abcdefAAAPo/cat.mp4";

test("Tenor: size code in the media id, same media type unless imagesOnly", () => {
    assert.equal(rewriteUrl(TENOR_GIF, "xs"), "https://media.tenor.com/abcdefAAAA2/cat.webp");
    assert.equal(rewriteUrl(TENOR_MP4, "s"), "https://media.tenor.com/abcdefAAAP1/cat.mp4");
    assert.equal(rewriteUrl(TENOR_MP4, "s", undefined, { imagesOnly: true }), "https://media.tenor.com/abcdefAAAA1/cat.webp");
    assert.equal(rewriteUrl(TENOR_GIF, "original"), null);
    // Proxied Tenor favourites use Tenor's own renditions
    assert.equal(rewriteUrl("https://images-ext-2.discordapp.net/external/sig/https/media.tenor.com/abcdefAAAPo/x.mp4", "xs"), "https://media.tenor.com/abcdefAAAP2/x.mp4");
});

test("Giphy renditions", () => {
    assert.equal(rewriteUrl("https://media.giphy.com/media/v1.Y2lk/ABC123/giphy.gif", "sd"), "https://media.giphy.com/media/ABC123/480w.webp");
    assert.equal(rewriteUrl("https://media.giphy.com/media/ABC123/giphy.mp4", "xs"), "https://media.giphy.com/media/ABC123/100w.mp4");
});

test("Discord media proxy: resized, never bigger than the original, videos only as images", () => {
    assert.equal(
        rewriteUrl("https://cdn.discordapp.com/attachments/1/2/cat.gif?ex=1", "s", { width: 480, height: 240 }),
        "https://media.discordapp.net/attachments/1/2/cat.gif?ex=1&width=240&height=120&format=webp&animated=true",
    );
    assert.equal(rewriteUrl("https://media.discordapp.net/attachments/1/2/cat.png", "s", { width: 100, height: 100 }), null, "already small");
    assert.equal(rewriteUrl("https://cdn.discordapp.com/attachments/1/2/a.mp4", "s"), null, "the proxy can't shrink a video into a video");
    assert.equal(
        rewriteUrl("https://images-ext-1.discordapp.net/external/sig/https/example.com/a.mp4", "s", undefined, { imagesOnly: true }),
        "https://images-ext-1.discordapp.net/external/sig/https/example.com/a.mp4?width=240&format=webp&animated=true",
    );
    assert.equal(rewriteUrl("https://pbs.twimg.com/media/ABC?format=jpg&name=orig", "xs"), "https://pbs.twimg.com/media/ABC?format=jpg&name=240x240");
    assert.equal(rewriteUrl("https://static.klipy.com/a.gif", "s"), null, "Klipy needs a lookup");
});

test("still renditions", () => {
    assert.equal(stillUrl(TENOR_MP4, "s"), "https://media.tenor.com/abcdefAAAAN/cat.png");
    assert.equal(stillUrl("https://media.giphy.com/media/ABC/giphy.gif", "sd"), "https://media.giphy.com/media/ABC/480w_s.jpg");
    assert.equal(stillUrl("https://video.twimg.com/tweet_video/XYZ.mp4", "s"), "https://pbs.twimg.com/tweet_video_thumb/XYZ.jpg");
    assert.equal(
        stillUrl("https://media.discordapp.net/attachments/1/2/a.mp4?animated=true", "xs", { width: 300, height: 300 }),
        "https://media.discordapp.net/attachments/1/2/a.mp4?width=128&height=128&format=jpeg",
    );
    assert.equal(stillUrl("https://static.klipy.com/a.gif", "s"), null, "captured from a frame instead");
});

test("Klipy media_format for small previews", () => {
    assert.equal(lowResMediaFormat("tinywebp", "s"), null, "already tiny");
    assert.equal(lowResMediaFormat("tinywebp", "xs"), "nanowebp");
    assert.equal(lowResMediaFormat("mp4", "s"), "tinymp4");
    assert.equal(lowResMediaFormat("webm", "xs"), "nanowebm");
    assert.equal(lowResMediaFormat("mp4", "sd"), null);
});

test("URL helpers", () => {
    assert.equal(unwrapProxyUrl("https://images-ext-1.discordapp.net/external/sig/https/media.tenor.com/a%20b.gif"), "https://media.tenor.com/a b.gif");
    assert.equal(klipyPageQuery("https://klipy.com/gifs/guh-lexa-fortnite"), "guh lexa fortnite");
    assert.equal(pageKey("HTTPS://www.Klipy.com/gifs/x/?a=1"), "klipy.com/gifs/x");
    assert.equal(isTenorPageGif("https://tenor.com/view/cat-1.gif"), true);
    assert.equal(isTenorPageGif("http://tenor.com/view/cat-1.gif"), false, "https only");
    assert.equal(tenorMediaFromSrc("https://images-ext-1.discordapp.net/external/s/https/media.tenor.com/abcdefAAAPo/x.mp4"), "https://media.tenor.com/abcdefAAAPo/x.mp4");
});
