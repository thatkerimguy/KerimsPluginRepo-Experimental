/*
 * The GIF tile. Discord's own tile is always rendered (it uses hooks), and its
 * Image is swapped for a placeholder while the tile waits for its turn, or for
 * the preview once it may load.
 */

import { Tokens } from "@valenced/discord/common/tokens";
import { Design } from "@valenced/discord/design";
import { isValidElement, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { wait } from "./klipy";
import { normalizeUrl } from "./lowres";
import { isNativeCached } from "./nativeCache";
import { lookupFor, pickSrc } from "./previews";
import type { Ticket } from "./queue";
import { useSettings } from "./settingsStore";
import type { GifItem } from "./state";
import { drop, failed, forgetLoaded, isCached, isDropped, isFavoriteItem, isPrecached, markLoaded, queue, runtime } from "./state";
import { replaceInTree } from "./tree";
import { useVisibleIndex } from "./viewport";

/**
 * - queued: waiting for a turn in the load queue
 * - resolving: looking up the small Tenor or Klipy URL before loading
 * - loading: the chosen URL is loading
 * - done: loaded, failed for good, or shown from cache
 */
type Phase = "queued" | "resolving" | "loading" | "done";

export interface ItemProps {
    item: GifItem;
    index: number;
    height: number;
    selected?: boolean;
    onPressGIF(item: GifItem, index: number): void;
}

function Indicator({ state, progress }: { state: "queued" | "loading"; progress: number | null; }) {
    const themed = useThemedStyles();
    if (state === "queued") {
        return (
            <View style={styles.overlay} pointerEvents="none">
                <View style={themed.queuedDot} />
            </View>
        );
    }
    const p = progress == null ? null : Math.min(1, Math.max(0, progress));
    return (
        <View style={styles.overlay} pointerEvents="none">
            <ActivityIndicator size="small" color={themed.spinner.color} />
            {p != null && (
                <>
                    <View style={themed.track}>
                        <View style={[themed.bar, { width: `${Math.round(p * 100)}%` }]} />
                    </View>
                    <Text style={themed.pct}>{Math.round(p * 100)}%</Text>
                </>
            )}
        </View>
    );
}

interface LoaderOptions {
    item: GifItem;
    index: number;
    /** Prefer a still image over the animated GIF */
    still: boolean;
    sequential: boolean;
    concurrency: number;
    loadTimeout: number;
}

/**
 * The load lifecycle of one tile: queue ticket, visibility, timeouts and fallbacks.
 * Tiles that scroll away are unmounted (and recycled) by Discord's FlashList.
 */
function useTileLoader({ item, index, still, sequential, concurrency, loadTimeout }: LoaderOptions) {
    /** The URL being shown or loaded, null until the tile's turn */
    const [chosen, setChosen] = useState<string | null>(() => {
        const url = pickSrc(item, still);
        return isCached(url) ? url : null;
    });
    const [phase, setPhase] = useState<Phase>(() => (chosen ? "done" : "queued"));
    const [progress, setProgress] = useState<number | null>(null);
    /** Precached: first in the queue and no spinner (it normally comes straight from the cache) */
    const [precached, setPrecached] = useState(false);

    const ticketRef = useRef<Ticket | null>(null);
    const indexRef = useRef(index);
    indexRef.current = index;
    const visibleRef = useRef(true);

    useVisibleIndex(index, visible => {
        visibleRef.current = visible;
        const ticket = ticketRef.current;
        if (ticket && ticket.visible !== visible) {
            ticket.visible = visible;
            queue.kick();
        }
    });

    // Wait for a turn in the load queue
    useEffect(() => {
        if (phase !== "queued") return;

        // Loaded recently: show it from cache right away
        const cached = pickSrc(item, still);
        if (isCached(cached)) {
            setChosen(cached);
            setPhase("done");
            return;
        }

        queue.concurrency = sequential ? concurrency : 64;
        queue.prioritizeVisible = true;
        const priority = isPrecached(cached);
        setPrecached(priority);

        let started = false;
        const begin = () => {
            const url = pickSrc(item, still);
            setChosen(url);
            setProgress(null);
            if (isCached(url)) {
                queue.finish(ticket);
                setPhase("done");
            } else {
                setPhase("loading");
            }
        };
        const ticket: Ticket = {
            visible: visibleRef.current,
            priority,
            order: () => indexRef.current ?? 0,
            start: () => {
                started = true;
                try {
                    const lookup = lookupFor(item);
                    if (!lookup) return begin();
                    setPhase("resolving");
                    // A lookup never holds a tile longer than the load timeout
                    Promise.race([lookup, wait(loadTimeout * 1000)])
                        .catch(() => { })
                        .then(() => !isDropped(ticket) && begin());
                } catch (e) {
                    runtime.logger?.error?.("Couldn't start loading a GIF", e);
                    setChosen(normalizeUrl(item.src));
                    setProgress(null);
                    setPhase("loading");
                }
            },
        };
        ticketRef.current = ticket;
        queue.enqueue(ticket);
        // Still on the device from an earlier session: show it now instead of waiting
        void isNativeCached(cached).then(hit => {
            if (!hit || started || isDropped(ticket)) return;
            drop(ticket);
            setChosen(cached);
            setPhase("done");
        });
        // Once started, the slot is freed by finishing or unmounting instead
        return () => {
            if (!started) drop(ticket);
        };
    }, [phase, still]);

    // The still previews setting changed: pick the URL again
    const stillRef = useRef(still);
    useEffect(() => {
        if (stillRef.current === still) return;
        stillRef.current = still;
        drop(ticketRef.current);
        setChosen(null);
        setProgress(null);
        setPhase("queued");
    }, [still]);

    // Release the slot after the timeout so one slow GIF doesn't hold everything up
    useEffect(() => {
        if (phase !== "loading" && phase !== "resolving") return;
        const timer = setTimeout(() => ticketRef.current && queue.finish(ticketRef.current), loadTimeout * 1000);
        return () => clearTimeout(timer);
    }, [phase, chosen]);

    // Unmounted while loading: free the slot
    useEffect(() => () => drop(ticketRef.current), []);

    const original = normalizeUrl(item.src);

    const done = () => {
        if (chosen) markLoaded(chosen);
        if (ticketRef.current) queue.finish(ticketRef.current);
        setPhase("done");
    };

    const error = () => {
        if (chosen && chosen !== original) {
            // Still / preview not available: try the next best one, then the original
            failed.add(chosen);
            forgetLoaded(chosen);
            setProgress(null);
            const next = pickSrc(item, still);
            setChosen(next !== chosen ? next : original);
            if (phase === "done") setPhase("loading");
            return;
        }
        if (ticketRef.current) queue.finish(ticketRef.current);
        setPhase("done");
    };

    // A preview that neither loads nor fails (some image views never report either)
    // falls back to the next option instead of spinning forever. One that's still
    // downloading (progress events keep coming) is only slow: it keeps loading.
    const errorRef = useRef(error);
    errorRef.current = error;
    const progressAt = useRef(0);
    useEffect(() => {
        if (phase !== "loading" || !chosen || chosen === original) return;
        progressAt.current = 0;
        const quietLimit = loadTimeout * 1000;
        let timer: ReturnType<typeof setTimeout>;
        const check = () => {
            const quiet = Date.now() - progressAt.current;
            if (progressAt.current && quiet < quietLimit) {
                timer = setTimeout(check, quietLimit - quiet);
                return;
            }
            errorRef.current();
        };
        timer = setTimeout(check, loadTimeout * 2000);
        return () => clearTimeout(timer);
    }, [phase, chosen]);

    /** Progress event from the Image, while loading */
    const reportProgress = (loadedBytes: number, total: number) => {
        progressAt.current = Date.now();
        if (total > 0) setProgress(loadedBytes / total);
    };

    /** Gives up the queue slot (the tile can't be optimized) */
    const cancel = () => drop(ticketRef.current);

    return { phase, chosen, precached, progress, original, done, error, reportProgress, cancel };
}

export function OptimizedItem({ props, render }: { props: ItemProps; render: (p: ItemProps) => any; }) {
    const { item, index } = props;
    const { sequential, concurrency, loadTimeout, showProgress, stillFavorites } = useSettings();

    // Discord's own tile. Always rendered (it uses hooks) and with the original item,
    // so tapping sends and long-press favourites the full resolution GIF.
    const tree = render(props);
    const still = stillFavorites && isFavoriteItem(item);

    const { phase, chosen, precached, progress, original, done, error, reportProgress, cancel } = useTileLoader({
        item, index, still, sequential, concurrency, loadTimeout,
    });

    const isImage = (n: any) => isValidElement(n) && normalizeUrl((n.props as any)?.source?.uri ?? "") === original;

    const [result, hit] = replaceInTree(tree, isImage, (img: any) => {
        const imgProps = img.props;

        // Waiting for its turn or being looked up: an empty frame, no image in memory
        if (phase === "queued" || phase === "resolving") {
            return (
                <View style={[imgProps.style, styles.frame]}>
                    {showProgress && !precached && <Indicator state={phase === "resolving" ? "loading" : "queued"} progress={null} />}
                </View>
            );
        }

        const shown = chosen ?? original;
        const image = {
            ...img,
            key: shown,
            props: {
                ...imgProps,
                source: { ...imgProps.source, uri: shown },
                style: [imgProps.style, styles.fill],
                onLoad: (...a: any[]) => {
                    imgProps.onLoad?.(...a);
                    if (phase === "loading") done();
                    else if (chosen) markLoaded(chosen);
                },
                onError: (...a: any[]) => {
                    imgProps.onError?.(...a);
                    // Also when shown from cache ("done"): the URL may not load any more
                    if (phase === "loading" || phase === "done") error();
                },
                onProgress: (e: any) => {
                    imgProps.onProgress?.(e);
                    const ev = e?.nativeEvent ?? e;
                    if (phase === "loading") reportProgress(ev?.loaded, ev?.total);
                },
            },
        };

        return (
            <View style={[imgProps.style, styles.frame]}>
                {image}
                {phase === "loading" && showProgress && !precached && <Indicator state="loading" progress={progress} />}
            </View>
        );
    });

    // Unknown tree shape: leave Discord's tile alone and don't hold up the queue
    useEffect(() => {
        if (!hit) cancel();
    }, [hit]);

    return hit ? result : tree;
}

const styles = StyleSheet.create({
    frame: {
        overflow: "hidden",
    },
    fill: {
        ...StyleSheet.absoluteFillObject,
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: "center",
        justifyContent: "center",
    },
});

/** Colours from Discord's theme tokens (resolved for the current theme by the hook) */
const useThemedStyles = Design.createStyles({
    spinner: {
        color: Tokens.default.colors.TEXT_STRONG,
    },
    queuedDot: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 3,
        borderColor: Tokens.default.colors.TEXT_MUTED,
        opacity: 0.4,
    },
    track: {
        marginTop: 6,
        width: "55%",
        maxWidth: 80,
        height: 3,
        borderRadius: 2,
        backgroundColor: Tokens.default.colors.BORDER_SUBTLE,
        overflow: "hidden",
    },
    bar: {
        height: "100%",
        backgroundColor: Tokens.default.colors.BACKGROUND_BRAND,
    },
    pct: {
        marginTop: 3,
        fontSize: 10,
        fontWeight: "600",
        color: Tokens.default.colors.TEXT_STRONG,
        textShadowColor: Tokens.default.colors.BACKGROUND_BASE_LOWER,
        textShadowRadius: 3,
    },
});
