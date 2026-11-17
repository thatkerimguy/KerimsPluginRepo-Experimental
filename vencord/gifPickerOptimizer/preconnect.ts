/*
 * Opens a connection to a GIF host a moment before the first download from it, so
 * that download doesn't also wait for the connection and TLS handshake (often
 * 100-300 ms). The browser ignores the hint when it's connected already.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Browsers close an unused preconnected socket after about 10 s; asking again sooner does nothing */
const AGAIN_AFTER_MS = 10_000;

/** origin -> when it was last asked for */
const asked = new Map<string, number>();

export function preconnect(url: string) {
    const origin = /^https:\/\/[^/?#]+/i.exec(url)?.[0]?.toLowerCase();
    if (!origin || typeof document === "undefined") return;
    const now = Date.now();
    if (now - (asked.get(origin) ?? 0) < AGAIN_AFTER_MS) return;
    asked.set(origin, now);

    // No crossorigin attribute: GIF tiles load without CORS, and the connection has to match
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = origin;
    document.head.appendChild(link);
    setTimeout(() => link.remove(), AGAIN_AFTER_MS);
}
