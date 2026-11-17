/*
 * Asks React Native's image cache (Fresco on Android, the URL cache on iOS)
 * whether a GIF is already on the device, so its tile can skip the load queue.
 * Tiles ask as they mount; the questions are sent together, a frame later.
 */

import { Image } from "react-native";

type QueryCache = (urls: string[]) => Promise<Record<string, string> | null | undefined>;

const BATCH_DELAY_MS = 16;

let waiting = new Map<string, ((cached: boolean) => void)[]>();
let timer: ReturnType<typeof setTimeout> | undefined;

function queryCache(): QueryCache | undefined {
    const query = (Image as unknown as { queryCache?: QueryCache; })?.queryCache;
    return typeof query === "function" ? query.bind(Image) : undefined;
}

function send() {
    timer = undefined;
    const batch = waiting;
    waiting = new Map();
    const answer = (found: Record<string, string> | null | undefined) => {
        for (const [url, callbacks] of batch) {
            // "memory", "disk" or "disk/memory"; missing when it isn't cached
            const cached = typeof found?.[url] === "string";
            for (const cb of callbacks) cb(cached);
        }
    };
    try {
        Promise.resolve(queryCache()?.([...batch.keys()])).then(answer, () => answer(undefined));
    } catch {
        answer(undefined);
    }
}

/** Whether `url` is in the native image cache. False when that can't be asked. */
export function isNativeCached(url: string): Promise<boolean> {
    if (!url || !queryCache()) return Promise.resolve(false);
    return new Promise(resolve => {
        const callbacks = waiting.get(url);
        if (callbacks) callbacks.push(resolve);
        else waiting.set(url, [resolve]);
        if (!timer) timer = setTimeout(send, BATCH_DELAY_MS);
    });
}
