/*
 * Social Embeds resolvers against the fixtures in tests/fixtures/social
 * (see its README: hand-made until recorded), plus media picking, layouts and
 * the resolver entry point (cache, short links, kill switch).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parseLink } from "../../valenced/social-embeds/js/core/detect.ts";
import { createHttpClient, NotFoundError, type FetchResponse } from "../../valenced/social-embeds/js/core/fetcher.ts";
import { FAILURES_TO_DISABLE } from "../../valenced/social-embeds/js/core/health.ts";
import { mediaHeight, mediaLayout } from "../../valenced/social-embeds/js/core/layout.ts";
import { isSafeMediaUrl, pickImage, pickVideo } from "../../valenced/social-embeds/js/core/media.ts";
import type { Media } from "../../valenced/social-embeds/js/core/model.ts";
import { createResolver } from "../../valenced/social-embeds/js/core/resolvers/index.ts";
import { parseThread } from "../../valenced/social-embeds/js/core/resolvers/reddit.ts";
import { parseStatus, photoVariants } from "../../valenced/social-embeds/js/core/resolvers/x.ts";
import { plainText } from "../../valenced/social-embeds/js/core/text.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/social/${name}.json`, import.meta.url), "utf8"));

const ok = (body: unknown, url = ""): FetchResponse => ({
    status: 200, url, headers: { get: () => null }, text: async () => JSON.stringify(body),
});

test("X: 20 photos with sizes, author, stats, entities", () => {
    const post = parseStatus(fixture("fxtwitter-20-photos").tweet);
    assert.equal(post.id, "1858000000000000020");
    assert.equal(post.url, "https://x.com/noralind/status/1858000000000000020");
    assert.deepEqual(post.author, {
        name: "Nora Lindqvist", handle: "noralind", url: "https://x.com/noralind", verified: true,
        avatar: "https://pbs.twimg.com/profile_images/1500000000000000001/abc_200x200.jpg",
    });
    assert.equal(post.media.length, 20);
    assert.ok(post.media.every(m => m.kind === "photo"));
    const first = post.media[0];
    assert.equal(first.alt, "Cliffs at sunrise");
    assert.equal(first.url, "https://pbs.twimg.com/media/GcPhoto01?format=jpg&name=orig");
    assert.deepEqual(first.variants.map(v => v.width), [680, 1200, 2048]);
    assert.equal(first.thumbnail, "https://pbs.twimg.com/media/GcPhoto01?format=jpg&name=small");
    assert.deepEqual(post.stats, { replies: 214, reposts: 1200, likes: 9800, bookmarks: 310, views: 412000 });
    assert.equal(post.createdAt, 1794819600000);
    assert.deepEqual(post.text.filter(s => s.type !== "text").map(s => s.type), ["hashtag", "mention", "link"]);
});

test("X: video variants, HLS, quote with decoded text, finished poll, reply", () => {
    const post = parseStatus(fixture("fxtwitter-video-quote-poll").tweet);
    const [video] = post.media;
    assert.equal(video.kind, "video");
    assert.deepEqual(video.variants.map(v => [v.width, v.height, v.bitrate]), [[320, 568, 632000], [480, 852, 950000], [720, 1280, 2176000]]);
    assert.equal(video.hls, "https://video.twimg.com/ext_tw_video/1858/pu/pl/playlist.m3u8?tag=12");
    assert.equal(video.durationMs, 34500);
    assert.equal(pickVideo(video, 720).url, video.variants[2].url);
    assert.equal(pickVideo(video, 600).url, video.variants[1].url);
    assert.equal(pickVideo(video, 360).url, video.variants[0].url);
    assert.equal(pickVideo(video, 1080, true).url, video.variants[0].url);
    assert.equal(post.quote?.author.handle, "harbourlight");
    assert.equal(plainText(post.quote!.text), "Tide tables for the whole coast are up & free. Plan your sunrise shots.");
    assert.equal(post.quote?.media.length, 1);
    assert.equal(post.quote?.quote, undefined);
    assert.deepEqual(post.poll, {
        options: [{ label: "Cliffs", votes: 60, percent: 60 }, { label: "Harbour", votes: 40, percent: 40 }],
        totalVotes: 100, endsAt: Date.parse("2026-11-10T12:00:00.000Z"), ended: true,
    });
    assert.equal(post.replyingTo, "noralind");
});

test("X: unsafe media URLs are dropped, photo variants for other hosts", () => {
    const status = fixture("fxtwitter-20-photos").tweet;
    status.media.all = [{ type: "photo", url: "http://pbs.twimg.com/media/a.jpg", width: 1, height: 1 }, { type: "photo", url: "https://evil.example/a.jpg", width: 1, height: 1 }];
    assert.equal(parseStatus(status).media.length, 0);
    assert.deepEqual(photoVariants("https://pbs.twimg.com/media/Abc?format=png&name=orig", 500, 300).map(v => v.url), ["https://pbs.twimg.com/media/Abc?format=png&name=orig"]);
});

test("Reddit: gallery order, failed items skipped, animated item, text, comments tree", () => {
    const { post, comments, moreComments } = parseThread(fixture("reddit-gallery-comments"));
    assert.equal(post.title, "Developed my first roll of 120 film, would love feedback");
    assert.equal(post.community, "analogphotography");
    assert.equal(post.flair, "Feedback");
    assert.equal(post.url, "https://www.reddit.com/r/analogphotography/comments/1gx2abc/developed_my_first_roll/");
    assert.equal(post.media.length, 12);
    assert.equal(post.media[1].alt, "Frame two");
    const gif = post.media[4];
    assert.equal(gif.kind, "gif");
    assert.equal(gif.url, "https://preview.redd.it/m05abc.gif?format=mp4&s=x");
    const photo = post.media[0];
    assert.equal(photo.url, "https://preview.redd.it/m01abc.jpg?width=3024&format=pjpg&auto=webp&s=d");
    assert.equal(pickImage(photo, 100, 100, 1), "https://preview.redd.it/m01abc.jpg?width=108&crop=smart&auto=webp&s=a");
    assert.equal(pickImage(photo, 300, 300, 2), "https://preview.redd.it/m01abc.jpg?width=640&crop=smart&auto=webp&s=c");
    assert.ok(plainText(post.text).startsWith("Shot on a Mamiya RB67, Portra 400."));
    assert.deepEqual(post.stats, { score: 3400, comments: 286, upvoteRatio: 0.98 });
    assert.equal(comments?.length, 3);
    assert.equal(moreComments, 240);
    const [top, second, mod] = comments!;
    assert.equal(top.author.handle, "grainwise");
    assert.equal(top.replies[0].isOp, true);
    assert.equal(top.replies[0].moreReplies, 3);
    assert.equal(top.replies[0].depth, 1);
    assert.equal(plainText(second.text), "What stock is this? The greens are > lovely.");
    assert.equal(mod.pinned, true);
});

test("Reddit: video with HLS and still, spoiler flag", () => {
    const { post } = parseThread(fixture("reddit-video"));
    assert.equal(post.spoiler, true);
    assert.equal(post.media.length, 1);
    const [v] = post.media;
    assert.equal(v.kind, "video");
    assert.equal(v.hls, "https://v.redd.it/abc123/HLSPlaylist.m3u8?a=1&v=1");
    assert.equal(v.thumbnail, "https://external-preview.redd.it/thumb.png?width=640&s=4");
    assert.equal(v.durationMs, 42000);
    assert.equal(pickImage(v, 100, 100), v.thumbnail);
});

test("layouts like the apps", () => {
    const m = (w: number, h: number): Media => ({ kind: "photo", width: w, height: h, url: "https://x", variants: [] });
    assert.deepEqual(mediaLayout([], "x"), { kind: "none" });
    assert.deepEqual(mediaLayout([m(1000, 3000)], "x"), { kind: "single", aspect: 0.8 });
    assert.deepEqual(mediaLayout([m(3000, 1000)], "x"), { kind: "single", aspect: 1.91 });
    const three = mediaLayout([m(1, 1), m(1, 1), m(1, 1)], "x");
    assert.equal(three.kind, "grid");
    assert.deepEqual(three.kind === "grid" && three.cells.map(c => [c.x, c.y, c.w, c.h]), [[0, 0, 0.5, 1], [0.5, 0, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]]);
    assert.deepEqual(mediaLayout(Array.from({ length: 20 }, () => m(4, 5)), "x"), { kind: "carousel", aspect: 0.8, count: 20 });
    assert.deepEqual(mediaLayout([m(16, 9), m(1, 1)], "reddit"), { kind: "carousel", aspect: 16 / 9, count: 2 });
    assert.equal(mediaHeight({ kind: "single", aspect: 2 }, 400), 200);
    assert.equal(mediaLayout([m(9, 16)], "tiktok", 9 / 16).kind === "single" && mediaLayout([m(9, 16)], "tiktok", 9 / 16).aspect, 9 / 16);
});

test("isSafeMediaUrl", () => {
    assert.ok(isSafeMediaUrl("https://i.redd.it/a.jpg", ["i.redd.it"]));
    assert.ok(isSafeMediaUrl("https://scontent.cdninstagram.com/a.jpg", ["cdninstagram.com"]));
    assert.ok(!isSafeMediaUrl("https://i.redd.it.evil.com/a.jpg", ["i.redd.it"]));
    assert.ok(!isSafeMediaUrl("https://user@i.redd.it/a.jpg", ["i.redd.it"]));
    assert.ok(!isSafeMediaUrl("javascript:alert(1)", ["i.redd.it"]));
    assert.ok(!isSafeMediaUrl(undefined, ["i.redd.it"]));
});

test("resolver: cache, short links, not found, kill switch", async () => {
    const calls: string[] = [];
    let xBody: unknown = fixture("fxtwitter-20-photos");
    const http = createHttpClient(async (url, init) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.startsWith("https://www.reddit.com/r/a/s/")) return ok("", "https://www.reddit.com/r/a/comments/1gx2abc/slug/");
        if (url.startsWith("https://www.reddit.com/comments/1gx2abc")) return ok(fixture("reddit-gallery-comments"));
        if (url.endsWith("/i/status/404")) return { status: 404, url, headers: { get: () => null }, text: async () => "{}" };
        return ok(xBody);
    }, { sleep: async () => { } });
    const r = createResolver(http);
    const x = parseLink("https://x.com/noralind/status/1858000000000000020")!;
    assert.ok(r.handles(x));
    assert.ok(!r.handles(parseLink("https://www.instagram.com/p/Cx_ab12-Z_/")!));
    assert.equal(r.peek(x), undefined);
    const thread = await r.resolve(x);
    assert.equal(thread.post.media.length, 20);
    assert.equal(r.peek(x), thread);
    await r.resolve(x);
    assert.equal(calls.filter(c => c.includes("api.fxtwitter.com")).length, 1);

    const share = parseLink("https://www.reddit.com/r/a/s/AbCdEf123")!;
    assert.equal((await r.resolve(share)).post.id, "1gx2abc");
    assert.ok(calls.includes("HEAD https://www.reddit.com/r/a/s/AbCdEf123"));

    await assert.rejects(r.resolve(parseLink("https://x.com/a/status/404")!), NotFoundError);
    assert.ok(r.handles(x), "a missing post doesn't count against the parser");

    xBody = { code: 200, tweet: { id: "broken" } };
    for (let i = 0; i < FAILURES_TO_DISABLE; i++) {
        await assert.rejects(r.resolve(parseLink(`https://x.com/a/status/${900 + i}`)!));
    }
    assert.equal(r.health.get("x").disabled, true);
    assert.ok(!r.handles(x));
});
