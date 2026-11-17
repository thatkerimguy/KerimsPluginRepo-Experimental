/** @jsxRuntime classic */
/** @jsx valenced.react.React.createElement */
/** @jsxFrag valenced.react.React.Fragment */
/*
 * The GIF tile. Discord's own tile is always rendered (it uses hooks), and its
 * Image is swapped for a placeholder while the tile waits for its turn, or for
 * the preview once it may load.
 */

import { Tokens } from "@valenced/discord/common/tokens";
import { Design } from "@valenced/discord/design";
import { isValidElement, useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

import { wait } from "./klipy";
import { normalizeUrl } from "./lowres";
import { isNativeCached } from "./nativeCache";
import { lookupFor, pickSrc } from "./previews";
import type { Ticket } from "./queue";
import { useSettings } from "./settingsStore";
import type { GifItem } from "./state";
import { drop, failed, forgetLoaded, isCached, isDropped, isFavoriteItem, isPrecached, markLoaded, queue, runtime } from "./state";
import { lazy } from "./lazy";
import { replaceInTree, treeHas } from "./tree";
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

/**
 * - queued: a breathing dot
 * - loading: the dot swells into a spinner, which squashes into a progress line once progress is known
 * - cached (precached / seen, normally straight from the cache): a breathing circle that morphs into a square and back
 * Same shapes and timings as the desktop indicator (vencord styles.css).
 */
type IndicatorState = "queued" | "loading" | "cached";

/**
 * Looping animations shared by every tile, so they all move in step and cost one
 * animation each instead of one per tile. A loop runs while a tile uses it.
 * breathe and spin use the native driver (transforms and opacity only); morph
 * animates the corner radius, which only the JS driver can do.
 */
const loops = lazy(() => {
    const shared = (value: Animated.Value, make: () => Animated.CompositeAnimation) => {
        let users = 0;
        let running: Animated.CompositeAnimation | null = null;
        return {
            value,
            use() {
                if (users++ === 0) {
                    // A native loop repeats from the value it started at: restarting a stopped
                    // spin from 0.6 made every turn go 0.6 → 1 and jump back
                    value.setValue(0);
                    running = Animated.loop(make());
                    running.start();
                }
                return () => {
                    if (--users === 0) {
                        running?.stop();
                        running = null;
                    }
                };
            },
        };
    };
    const ease = Easing.inOut(Easing.ease);
    const there = (value: Animated.Value, toValue: number, duration: number, native: boolean, easing = ease) =>
        Animated.timing(value, { toValue, duration, easing, useNativeDriver: native });
    const back = (value: Animated.Value, half: number, native: boolean) =>
        Animated.sequence([there(value, 1, half, native), there(value, 0, half, native)]);

    const breathe = new Animated.Value(0);
    const spin = new Animated.Value(0);
    const morph = new Animated.Value(0);
    return {
        /** 0 → 1 → 0 in 1.6 s */
        breathe: shared(breathe, () => back(breathe, 800, true)),
        /** 0 → 1 in 0.8 s, one turn */
        spin: shared(spin, () => there(spin, 1, 800, true, Easing.linear)),
        /** circle (0) → square (1) → circle in 2.4 s */
        morph: shared(morph, () => back(morph, 1200, false)),
    };
});

/**
 * Animated's View, made from View. Not `Animated.View`: the Valenced build rewrites
 * React Native names to `valenced.react.ReactNative.<name>` even after a dot, so
 * `Animated.View` became `Animated.valenced.react.ReactNative.View` (undefined) and
 * every tile threw. Never write `<rn export>.<another rn export name>` in mobile code.
 */
const AnimatedView = lazy(() => Animated.createAnimatedComponent(View));

type LoopName = "breathe" | "spin" | "morph";

function useLoops(names: LoopName[]) {
    const key = names.join();
    useEffect(() => {
        const release = names.map(n => loops()[n].use());
        return () => release.forEach(r => r());
    }, [key]);
}

/**
 * A per-tile transition value, 0 or 1, animated when `on` changes. JS driver: it also
 * drives sizes, border widths and corner radii. Only runs during the short change,
 * so it costs nothing while a tile waits.
 */
function useTransition(on: boolean, duration: number, easing: (t: number) => number) {
    const [value] = useState(() => new Animated.Value(on ? 1 : 0));
    const first = useRef(true);
    useEffect(() => {
        if (first.current) {
            first.current = false;
            return;
        }
        const anim = Animated.timing(value, { toValue: on ? 1 : 0, duration: on ? duration : 0, easing, useNativeDriver: false });
        anim.start();
        return () => anim.stop();
    }, [on]);
    return value;
}

/** Interpolation clamped at both ends (opacity and the like) */
const range = (v: Animated.Value, inputRange: number[], outputRange: number[] | string[]) =>
    v.interpolate({ inputRange, outputRange, extrapolate: "clamp" } as any);
/** Interpolation that follows an overshooting easing past the end (sizes) */
const free = (v: Animated.Value, inputRange: number[], outputRange: number[]) =>
    v.interpolate({ inputRange, outputRange, extrapolateLeft: "clamp" } as any);

/** Opacity of the track ring / line (TEXT_MUTED), like desktop's subtle track */
const TRACK_OPACITY = 0.3;

/**
 * Stays mounted from queued to loaded (the tile keeps it at the same place in the tree),
 * so each state turns into the next instead of being swapped.
 *
 * The ring is two views: a faint full track and the brand arc on top, and only the
 * arc spins (a single view with one coloured side drew only the arc on Android).
 */
function Indicator({ state, progress }: { state: IndicatorState; progress: number | null; }) {
    const themed = useThemedStyles();
    const s = styles();
    const AView = AnimatedView();
    const p = state === "loading" && progress != null ? Math.min(1, Math.max(0, progress)) : null;

    useLoops(state === "queued" ? ["breathe"] : state === "cached" ? ["breathe", "morph"] : ["spin"]);
    const { breathe, spin, morph } = { breathe: loops().breathe.value, spin: loops().spin.value, morph: loops().morph.value };

    /** dot (0) → ring (1), with a small overshoot */
    const grow = useTransition(state === "loading", 400, Easing.out(Easing.back(1.6)));
    /** ring (0) → line (1) */
    const flat = useTransition(p != null, 380, Easing.bezier(0.5, 0, 0.2, 1));
    /** cached: wait a moment before showing, so quick cache hits don't flash it (native, own view) */
    const [appear] = useState(() => new Animated.Value(state === "cached" ? 0 : 1));
    useEffect(() => {
        if (state !== "cached") return;
        const anim = Animated.timing(appear, { toValue: 1, duration: 200, delay: 150, useNativeDriver: true });
        anim.start();
        return () => anim.stop();
    }, [state === "cached"]);

    const breathing = {
        opacity: range(breathe, [0, 1], [0.5, 0.95]),
        transform: [{ scale: range(breathe, [0, 1], [0.6, 1]) }],
    };

    if (state === "cached") {
        return (
            <View style={s.overlay} pointerEvents="none">
                <AView style={[s.box, { opacity: appear }]}>
                    <AView style={[s.layer, breathing]}>
                        <AView
                            style={[themed.shape, {
                                borderRadius: range(morph, [0.25, 0.75], [5, 1.5]),
                                transform: [{ rotate: range(morph, [0, 1], ["0deg", "90deg"]) }],
                            }]}
                        />
                    </AView>
                </AView>
            </View>
        );
    }

    // Ring geometry: from the dot while growing, then to the line while flattening
    const ring = p == null
        ? {
            width: free(grow, [0, 1], [10, 22]),
            height: free(grow, [0, 1], [10, 22]),
            borderRadius: free(grow, [0, 1], [5, 11]),
            // Half the width at first: a filled disc the size of the dot
            borderWidth: range(grow, [0, 1], [5, 3]),
        }
        : {
            width: range(flat, [0, 1], [22, 44]),
            height: range(flat, [0, 1], [22, 4]),
            borderRadius: range(flat, [0, 1], [11, 2]),
            borderWidth: range(flat, [0, 1], [3, 2]),
        };

    return (
        <View style={s.overlay} pointerEvents="none">
            <View style={s.box}>
                {/* Track: appears as the dot opens up, and becomes the progress line's track */}
                <View style={s.layer}>
                    <AView style={[themed.track, ring, { opacity: range(grow, [0, 0.5], [0, TRACK_OPACITY]) }]} />
                </View>
                {/* Brand arc: spins; fades out as the ring flattens */}
                <AView style={[s.layer, { opacity: range(flat, [0, 0.5], [1, 0]) }]}>
                    <AView style={{ transform: [{ rotate: range(spin, [0, 1], ["0deg", "360deg"]) }] }}>
                        <AView
                            style={[themed.arc, p == null ? ring : { width: 22, height: 22, borderRadius: 11, borderWidth: 3 }, {
                                opacity: range(grow, [0, 0.4], [0, 1]),
                            }]}
                        />
                    </AView>
                </AView>
                {/*
                  * The dot: swells with the ring and fades, so it looks like it opens up into it.
                  * Only the dot breathes, and its breathing style stays attached in every state:
                  * removing a native-driven style leaves the view at its last value, and when the
                  * whole box breathed, each spinner kept the scale (60–100%) and opacity it had
                  * when its tile started loading.
                  */}
                <AView style={[s.layer, breathing]}>
                    <AView
                        style={[themed.dot, {
                            width: free(grow, [0, 1], [10, 22]),
                            height: free(grow, [0, 1], [10, 22]),
                            borderRadius: free(grow, [0, 1], [5, 11]),
                            opacity: range(grow, [0, 0.5], [1, 0]),
                        }]}
                    />
                </AView>
                {p != null && (
                    <AView style={[s.layer, { opacity: range(flat, [0.6, 1], [0, 1]) }]}>
                        <View style={s.lineBox}>
                            <View style={[themed.lineFill, { width: `${Math.round(p * 100)}%` }]} />
                        </View>
                    </AView>
                )}
            </View>
            {p != null && (
                <AView style={{ opacity: range(flat, [0.6, 1], [0, 1]) }}>
                    <Text style={themed.pct}>{Math.round(p * 100)}%</Text>
                </AView>
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
    /** Discord's tile has an Image the plugin can swap. Without one, the tile doesn't queue. */
    enabled: boolean;
}

/**
 * The load lifecycle of one tile: queue ticket, visibility, timeouts and fallbacks.
 * Tiles that scroll away are unmounted (and recycled) by Discord's FlashList.
 */
function useTileLoader({ item, index, still, sequential, concurrency, loadTimeout, enabled }: LoaderOptions) {
    /** The URL being shown or loaded, null until the tile's turn */
    const [chosen, setChosen] = useState<string | null>(() => {
        const url = pickSrc(item, still);
        return isCached(url) ? url : null;
    });
    const [phase, setPhase] = useState<Phase>(() => (chosen ? "done" : "queued"));
    const [progress, setProgress] = useState<number | null>(null);
    /** Precached: first in the queue, and the cached indicator instead of the spinner (it normally comes straight from the cache) */
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
        if (phase !== "queued" || !enabled) return;

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
    }, [phase, still, enabled]);

    // Discord's tile lost its Image (unknown tree shape): don't hold a queue slot for
    // it. The queue effect above queues again once the Image is back.
    useEffect(() => {
        if (!enabled) drop(ticketRef.current);
    }, [enabled]);

    // The still previews setting changed: pick the URL again
    const stillRef = useRef(still);
    useEffect(() => {
        if (stillRef.current === still) return;
        stillRef.current = still;
        // Still waiting: the queue effect above already re-ran for the new setting and
        // queued a fresh ticket. Dropping it here would leave the tile waiting forever.
        if (phase === "queued") return;
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

    return { phase, chosen, precached, progress, done, error, reportProgress };
}

export function OptimizedItem({ props, render }: { props: ItemProps; render: (p: ItemProps) => any; }) {
    const { item, index } = props;
    const { sequential, concurrency, loadTimeout, showProgress, stillFavorites } = useSettings();

    // Discord's own tile. Always rendered (it uses hooks) and with the original item,
    // so tapping sends and long-press favourites the full resolution GIF.
    const tree = render(props);
    const still = stillFavorites && isFavoriteItem(item);

    const original = normalizeUrl(item.src);
    const isImage = (n: any) => isValidElement(n) && normalizeUrl((n.props as any)?.source?.uri ?? "") === original;
    // Unknown tree shape: leave Discord's tile alone and don't hold up the queue
    const hasImage = treeHas(tree, isImage);

    const { phase, chosen, precached, progress, done, error, reportProgress } = useTileLoader({
        item, index, still, sequential, concurrency, loadTimeout, enabled: hasImage,
    });
    if (!hasImage) return tree;

    const [result] = replaceInTree(tree, isImage, (img: any) => {
        const imgProps = img.props;

        // One Indicator at the same place in the frame from queued to loaded, so it animates between states
        const indicatorState = !showProgress || phase === "done" ? null
            : precached ? "cached"
            : phase === "queued" ? "queued"
            : "loading";
        const indicator = indicatorState && <Indicator state={indicatorState} progress={phase === "loading" ? progress : null} />;

        // Waiting for its turn or being looked up: an empty frame, no image in memory
        if (phase === "queued" || phase === "resolving") {
            return (
                <View style={[imgProps.style, styles().frame]}>
                    {null}
                    {indicator}
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
                style: [imgProps.style, styles().fill],
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
            <View style={[imgProps.style, styles().frame]}>
                {image}
                {indicator}
            </View>
        );
    });

    return result;
}

const styles = lazy(() => StyleSheet.create({
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
    /** The indicator's shapes are layered in here, centred */
    box: {
        width: 44,
        height: 22,
    },
    layer: {
        ...StyleSheet.absoluteFillObject,
        alignItems: "center",
        justifyContent: "center",
    },
    /** The progress line's fill sits on the flattened track */
    lineBox: {
        width: 44,
        height: 4,
        borderRadius: 2,
        overflow: "hidden",
    },
}));

/** Colours from Discord's theme tokens (resolved for the current theme by the hook) */
const themedStyles = lazy(() => Design.createStyles({
    dot: {
        backgroundColor: Tokens.default.colors.TEXT_MUTED,
    },
    shape: {
        width: 10,
        height: 10,
        backgroundColor: Tokens.default.colors.TEXT_MUTED,
    },
    /** Full ring, drawn at TRACK_OPACITY */
    track: {
        borderColor: Tokens.default.colors.TEXT_MUTED,
    },
    /** Only the top side coloured: the spinning arc */
    arc: {
        borderColor: "transparent",
        borderTopColor: Tokens.default.colors.BACKGROUND_BRAND,
    },
    lineFill: {
        height: "100%",
        borderRadius: 2,
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
}));

function useThemedStyles() {
    return themedStyles()();
}
