/*
 * Social Embeds text: entities, linkifying per platform, Reddit Markdown, truncation.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeEntities, linkify, plainText, redditMarkdown, shortenUrl, truncate } from "../../valenced/social-embeds/js/core/text.ts";

test("decodeEntities", () => {
    assert.equal(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x1F600; &bogus;"), "a & b <c> \"d\" 'e' 😀 &bogus;");
    assert.equal(decodeEntities("plain"), "plain");
});

test("linkify: X", () => {
    assert.deepEqual(linkify("Hi @harbourlight, see #film and https://example.com/a/b.\nBye", "x"), [
        { type: "text", text: "Hi " },
        { type: "mention", text: "@harbourlight", url: "https://x.com/harbourlight" },
        { type: "text", text: ", see " },
        { type: "hashtag", text: "#film", url: "https://x.com/hashtag/film" },
        { type: "text", text: " and " },
        { type: "link", text: "example.com/a/b", url: "https://example.com/a/b" },
        { type: "text", text: "." },
        { type: "break" },
        { type: "text", text: "Bye" },
    ]);
    // Emails and r/ names aren't entities on X
    assert.deepEqual(linkify("mail a@b.com r/test", "x"), [{ type: "text", text: "mail a@b.com r/test" }]);
    // Non-Latin hashtags
    assert.equal(linkify("#写真 ok", "x")[0].type, "hashtag");
});

test("linkify: Reddit names", () => {
    assert.deepEqual(linkify("thanks u/grainwise and r/analog @nobody", "reddit"), [
        { type: "text", text: "thanks " },
        { type: "mention", text: "u/grainwise", url: "https://www.reddit.com/user/grainwise" },
        { type: "text", text: " and " },
        { type: "mention", text: "r/analog", url: "https://www.reddit.com/r/analog" },
        { type: "text", text: " @nobody" },
    ]);
});

test("redditMarkdown", () => {
    const rich = redditMarkdown("# Title\n\nShot on a **Mamiya**, *Portra* ~~400~~ `iso`.\n\n* one\n* [lab](https://example.com/lab)\n> quoted\n\n---\n1. first");
    assert.equal(plainText(rich), "Title\n\nShot on a Mamiya, Portra 400 iso.\n\n• one\n• lab\nquoted\n\n1. first");
    assert.deepEqual(rich.find(s => s.type === "text" && s.text === "Title"), { type: "text", text: "Title", bold: true });
    assert.ok(rich.some(s => s.type === "text" && s.text === "Portra" && s.italic));
    assert.ok(rich.some(s => s.type === "text" && s.text === "400" && s.strike));
    assert.ok(rich.some(s => s.type === "text" && s.text === "iso" && s.code));
    assert.ok(rich.some(s => s.type === "link" && s.url === "https://example.com/lab" && s.text === "lab"));
    assert.ok(rich.some(s => s.type === "text" && s.text === "quoted" && s.italic));
    assert.deepEqual(redditMarkdown(""), []);
    // snake_case words aren't italic
    assert.equal(plainText(redditMarkdown("a my_var_name b")), "a my_var_name b");
    assert.ok(!redditMarkdown("a my_var_name b").some(s => s.type === "text" && s.italic));
});

test("shortenUrl and truncate", () => {
    assert.equal(shortenUrl("https://www.example.com/a"), "example.com/a");
    assert.equal(shortenUrl("https://example.com/" + "x".repeat(50)).length, 30);
    const rich = linkify("one two three four five six seven", "x");
    assert.deepEqual(truncate(rich, 100), { text: rich, cut: false });
    const cut = truncate(rich, 15);
    assert.equal(cut.cut, true);
    assert.equal(plainText(cut.text), "one two three…");
});
