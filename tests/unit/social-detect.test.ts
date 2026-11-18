/*
 * Social Embeds link detection: every supported URL form, canonical links,
 * short links, spoilers, suppressed links, code, duplicates.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { findLinks, parseLink, refKey } from "../../valenced/social-embeds/js/core/detect.ts";

const id = (url: string) => {
    const r = parseLink(url);
    return r && { platform: r.platform, id: r.id, canonical: r.canonicalUrl, short: !!r.shortLink, comment: r.commentId };
};

test("X links", () => {
    const want = (u: string, user = "noralind") => assert.deepEqual(id(u), {
        platform: "x", id: "1858000000000000020", canonical: `https://x.com/${user}/status/1858000000000000020`, short: false, comment: undefined,
    }, u);
    want("https://x.com/noralind/status/1858000000000000020");
    want("https://twitter.com/noralind/status/1858000000000000020?s=20");
    want("https://www.twitter.com/noralind/status/1858000000000000020/photo/3");
    want("https://mobile.twitter.com/noralind/status/1858000000000000020");
    want("https://fxtwitter.com/noralind/status/1858000000000000020");
    want("https://fixupx.com/noralind/status/1858000000000000020");
    want("https://vxtwitter.com/noralind/status/1858000000000000020");
    want("https://x.com/i/status/1858000000000000020", "i");
    want("https://x.com/i/web/status/1858000000000000020", "i");
    assert.equal(parseLink("https://x.com/noralind"), null);
    assert.equal(parseLink("https://x.com/noralind/status/abc"), null);
    assert.equal(parseLink("https://notx.com/a/status/1"), null);
});

test("Reddit links", () => {
    const want = (u: string, comment?: string) => assert.deepEqual(id(u), {
        platform: "reddit", id: "1gx2abc",
        canonical: comment ? `https://www.reddit.com/comments/1gx2abc/_/${comment}` : "https://www.reddit.com/comments/1gx2abc",
        short: false, comment,
    }, u);
    want("https://www.reddit.com/r/analogphotography/comments/1gx2abc/developed_my_first_roll/");
    want("https://old.reddit.com/r/analogphotography/comments/1gx2abc/");
    want("https://reddit.com/comments/1gx2abc");
    want("https://redd.it/1gx2abc");
    want("https://rxddit.com/r/analogphotography/comments/1gx2abc/x/");
    want("https://www.reddit.com/r/analogphotography/comments/1gx2abc/developed/c1abc/", "c1abc");
    assert.deepEqual(id("https://www.reddit.com/r/analogphotography/s/AbCdEf123"), {
        platform: "reddit", id: "", canonical: "https://www.reddit.com/r/analogphotography/s/AbCdEf123", short: true, comment: undefined,
    });
    assert.equal(parseLink("https://www.reddit.com/r/analogphotography/"), null);
});

test("TikTok links", () => {
    assert.deepEqual(id("https://www.tiktok.com/@saltandsea/video/7300000000000000001?lang=en"), {
        platform: "tiktok", id: "7300000000000000001", canonical: "https://www.tiktok.com/@saltandsea/video/7300000000000000001", short: false, comment: undefined,
    });
    assert.equal(id("https://www.tiktok.com/@saltandsea/photo/7300000000000000002")?.canonical, "https://www.tiktok.com/@saltandsea/photo/7300000000000000002");
    assert.equal(id("https://vxtiktok.com/@saltandsea/video/7300000000000000001")?.id, "7300000000000000001");
    assert.equal(id("https://vm.tiktok.com/ZMabc123/")?.short, true);
    assert.equal(id("https://www.tiktok.com/t/ZTabc123/")?.short, true);
    assert.equal(id("https://www.tiktok.com/embed/v2/7300000000000000001")?.id, "7300000000000000001");
    assert.equal(parseLink("https://www.tiktok.com/@saltandsea"), null);
});

test("Instagram links", () => {
    assert.deepEqual(id("https://www.instagram.com/p/Cx_ab12-Z_/?igsh=abc"), {
        platform: "instagram", id: "Cx_ab12-Z_", canonical: "https://www.instagram.com/p/Cx_ab12-Z_/", short: false, comment: undefined,
    });
    assert.equal(id("https://instagram.com/reel/Cy1234567/")?.canonical, "https://www.instagram.com/reel/Cy1234567/");
    assert.equal(id("https://www.instagram.com/reels/Cy1234567/")?.canonical, "https://www.instagram.com/reel/Cy1234567/");
    assert.equal(id("https://ddinstagram.com/p/Cx_ab12-Z_")?.id, "Cx_ab12-Z_");
    assert.equal(id("https://www.instagram.com/lumen.studio/p/Cx_ab12-Z_/")?.id, "Cx_ab12-Z_");
    assert.equal(parseLink("https://www.instagram.com/lumen.studio/"), null);
});

test("findLinks: order, duplicates, limits", () => {
    const content = "look https://x.com/a/status/1 and https://fxtwitter.com/a/status/1 then https://redd.it/abc, and https://example.com";
    assert.deepEqual(findLinks(content).map(refKey), ["x:1", "reddit:abc"]);
    assert.deepEqual(findLinks("https://x.com/a/status/1 https://x.com/a/status/2 https://x.com/a/status/3", 2).map(refKey), ["x:1", "x:2"]);
    assert.deepEqual(findLinks(""), []);
    assert.deepEqual(findLinks(null), []);
});

test("findLinks: suppressed, code, spoilers, markdown links, trailing punctuation", () => {
    assert.deepEqual(findLinks("no embed <https://x.com/a/status/1>"), []);
    assert.deepEqual(findLinks("`https://x.com/a/status/1` and ```\nhttps://x.com/a/status/2\n```"), []);
    const [s] = findLinks("||https://x.com/a/status/5||");
    assert.equal(s.spoiler, true);
    assert.equal(findLinks("https://x.com/a/status/6")[0].spoiler, undefined);
    assert.equal(findLinks("[my post](https://x.com/a/status/7)")[0].id, "7");
    assert.equal(findLinks("(see https://redd.it/abc).")[0].id, "abc");
    assert.equal(findLinks("wow https://www.instagram.com/p/Cx_ab12-Z_!")[0].id, "Cx_ab12-Z_");
});
