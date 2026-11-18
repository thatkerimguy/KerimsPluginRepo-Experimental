/*
 * Post text → RichText (styled runs and entities). Both UIs render the runs as
 * text components; nothing here is ever treated as HTML.
 */

import type { Platform, RichText, Segment } from "./model";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'", "#x27": "'", "#x2F": "/" };

/** Decodes the HTML entities APIs leave in text (&amp;, &#8217;, …). */
export function decodeEntities(s: string): string {
    if (s.indexOf("&") === -1) return s;
    return s.replace(/&(#x?[0-9a-f]+|[a-z]+\d*);/gi, (m, name: string) => {
        if (name in ENTITIES) return ENTITIES[name];
        if (name[0] === "#") {
            const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
            if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
        }
        return m;
    });
}

const PROFILE_URL: Record<Platform, (handle: string) => string> = {
    x: h => `https://x.com/${h}`,
    reddit: h => `https://www.reddit.com/user/${h}`,
    tiktok: h => `https://www.tiktok.com/@${h}`,
    instagram: h => `https://www.instagram.com/${h}/`,
};

const TAG_URL: Record<Platform, (tag: string) => string> = {
    x: t => `https://x.com/hashtag/${encodeURIComponent(t)}`,
    reddit: t => `https://www.reddit.com/search/?q=${encodeURIComponent("#" + t)}`,
    tiktok: t => `https://www.tiktok.com/tag/${encodeURIComponent(t)}`,
    instagram: t => `https://www.instagram.com/explore/tags/${encodeURIComponent(t)}/`,
};

// One pass over plain text: URLs, @mentions / u/ and r/ names, #hashtags, line breaks.
// Hashtag letters are listed as ranges, not \p{L}: Hermes' support for Unicode property escapes isn't guaranteed.
const TAG_CHARS = "\\w\\u00C0-\\u024F\\u0370-\\u03FF\\u0400-\\u04FF\\u0590-\\u06FF\\u0E00-\\u0E7F\\u3040-\\u30FF\\u3400-\\u9FFF\\uAC00-\\uD7AF";
const TOKEN_RE = new RegExp(
    "(https?:\\/\\/[^\\s<>\"]+[^\\s<>\".,!?:;)\\]}'])" +
    "|(^|[^\\w@/])@([A-Za-z0-9_.]{1,30})" +
    "|(^|[^\\w/])(\\/?u\\/[A-Za-z0-9_-]{2,30}|\\/?r\\/[A-Za-z0-9_]{2,30})" +
    `|(^|[^\\w&#])#([${TAG_CHARS}]{1,100})` +
    "|(\\n)",
    "g",
);

function pushText(out: Segment[], text: string, style?: Omit<Extract<Segment, { type: "text"; }>, "type" | "text">) {
    if (!text) return;
    const last = out[out.length - 1];
    if (last?.type === "text" && !style && !last.bold && !last.italic && !last.strike && !last.code) {
        last.text += text;
        return;
    }
    out.push(style ? { type: "text", text, ...style } : { type: "text", text });
}

/** Plain text with entities turned into links (X, TikTok and Instagram captions, Reddit titles). */
export function linkify(text: string, platform: Platform, out: Segment[] = []): RichText {
    let last = 0;
    TOKEN_RE.lastIndex = 0;
    for (let m = TOKEN_RE.exec(text); m; m = TOKEN_RE.exec(text)) {
        let start = m.index;
        if (m[1]) {
            pushText(out, text.slice(last, start));
            out.push({ type: "link", text: shortenUrl(m[1]), url: m[1] });
        } else if (m[3] !== undefined) {
            start += m[2].length;
            pushText(out, text.slice(last, start));
            if (platform === "reddit") pushText(out, `@${m[3]}`); // Reddit has no @mentions
            else out.push({ type: "mention", text: `@${m[3]}`, url: PROFILE_URL[platform](m[3]) });
        } else if (m[5] !== undefined && platform !== "reddit") {
            pushText(out, text.slice(last, m.index + m[0].length));
        } else if (m[5] !== undefined) {
            start += m[4].length;
            pushText(out, text.slice(last, start));
            const name = m[5].replace(/^\//, "");
            const url = name.startsWith("r/") ? `https://www.reddit.com/${name}` : PROFILE_URL.reddit(name.slice(2));
            out.push({ type: "mention", text: name, url });
        } else if (m[7] !== undefined) {
            start += m[6].length;
            pushText(out, text.slice(last, start));
            out.push({ type: "hashtag", text: `#${m[7]}`, url: TAG_URL[platform](m[7]) });
        } else {
            pushText(out, text.slice(last, start));
            out.push({ type: "break" });
        }
        last = m.index + m[0].length;
    }
    pushText(out, text.slice(last));
    return out;
}

/** "https://www.example.com/a/very/long/path" → "example.com/a/very/long/pa…", like the apps show links. */
export function shortenUrl(url: string, max = 30): string {
    const bare = url.replace(/^https?:\/\/(www\.)?/i, "");
    return bare.length > max ? `${bare.slice(0, max - 1)}…` : bare;
}

interface Style { bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean; }

// Inline Markdown as Reddit writes it (raw_json=1, so no HTML entities except in old posts).
const MD_INLINE = /\[([^\]\n]{1,300})\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|`([^`\n]+)`|\*([^*\n]+)\*|(^|[^\w])_([^_\n]+)_(?!\w)|>!([^\n]+?)!</g;

function inlineMarkdown(text: string, out: Segment[], style: Style = {}) {
    let last = 0;
    // A fresh regex per call: this recurses for nested styles, and a shared global regex's lastIndex would be reset under the outer loop
    const re = new RegExp(MD_INLINE.source, "g");
    const plain = (s: string) => {
        if (!s) return;
        const hasStyle = style.bold || style.italic || style.strike || style.code;
        if (!hasStyle) {
            linkify(s, "reddit", out);
            return;
        }
        pushText(out, s, style);
    };
    for (let m = re.exec(text); m; m = re.exec(text)) {
        let start = m.index;
        if (m[8] !== undefined) start += m[8].length;
        plain(text.slice(last, start));
        if (m[1] !== undefined) out.push({ type: "link", text: m[1], url: m[2] });
        else if (m[3] !== undefined || m[4] !== undefined) inlineMarkdown(m[3] ?? m[4], out, { ...style, bold: true });
        else if (m[5] !== undefined) inlineMarkdown(m[5], out, { ...style, strike: true });
        else if (m[6] !== undefined) pushText(out, m[6], { ...style, code: true });
        else if (m[7] !== undefined || m[9] !== undefined) inlineMarkdown(m[7] ?? m[9], out, { ...style, italic: true });
        else if (m[10] !== undefined) pushText(out, m[10], { ...style, italic: true }); // spoiler: shown as italic text
        last = m.index + m[0].length;
    }
    plain(text.slice(last));
}

/** Reddit Markdown (posts and comments) → RichText. Headings become bold, list items get a bullet, quotes are italic. */
export function redditMarkdown(md: string): RichText {
    const out: Segment[] = [];
    const lines = decodeEntities(md).replace(/\r\n?/g, "\n").split("\n");
    let blank = 0;
    for (const raw of lines) {
        const line = raw.replace(/\s+$/, "");
        if (!line.trim()) {
            blank++;
            continue;
        }
        if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) continue;
        if (out.length) {
            out.push({ type: "break" });
            if (blank) out.push({ type: "break" });
        }
        blank = 0;
        let m: RegExpExecArray | null;
        if ((m = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line))) inlineMarkdown(m[1], out, { bold: true });
        else if ((m = /^\s*[*+-]\s+(.*)$/.exec(line))) {
            pushText(out, "• ");
            inlineMarkdown(m[1], out);
        } else if ((m = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(line))) {
            pushText(out, `${m[1]}. `);
            inlineMarkdown(m[2], out);
        } else if ((m = /^\s*>\s?(.*)$/.exec(line))) inlineMarkdown(m[1], out, { italic: true });
        else inlineMarkdown(line, out);
    }
    return out;
}

/** The text without styles, for accessibility labels and length checks. */
export function plainText(rich: RichText): string {
    return rich.map(s => (s.type === "break" ? "\n" : s.text)).join("");
}

/**
 * Cuts rich text to about `max` characters on a word boundary (for "Show more"). Returns the input when it already fits.
 */
export function truncate(rich: RichText, max: number): { text: RichText; cut: boolean; } {
    let used = 0;
    const out: Segment[] = [];
    for (const seg of rich) {
        const len = seg.type === "break" ? 1 : seg.text.length;
        if (used + len <= max) {
            out.push(seg);
            used += len;
            continue;
        }
        if (seg.type === "text") {
            const room = max - used;
            let cut = seg.text.slice(0, room);
            const space = cut.lastIndexOf(" ");
            if (space > room * 0.6) cut = cut.slice(0, space);
            out.push({ ...seg, text: `${cut.trimEnd()}…` });
        } else if (out.length) {
            const last = out[out.length - 1];
            if (last.type === "text") out[out.length - 1] = { ...last, text: `${last.text.trimEnd()}…` };
            else out.push({ type: "text", text: "…" });
        }
        return { text: out, cut: true };
    }
    return { text: rich, cut: false };
}
