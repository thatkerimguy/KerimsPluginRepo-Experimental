/*
 * GIFs+ — one tile's load lifecycle: its turn in the load queue, cache shortcuts,
 * the load timeout, retries and fallbacks.
 * Shared between the Vencord and Valenced builds (keep both copies in sync).
 *
 * It's a hook that gets React's hooks as an argument, because each build reaches
 * React differently (Vencord's webpack common, React Native's `react`), and the
 * Valenced build may not touch React when the script is evaluated.
 *
 * Phases:
 * - queued: waiting for a turn in the load queue
 * - lookingUp: finding the small Klipy / Tenor URL. Holds no queue slot; the tile
 *   queues again once it's known, and never loads the original meanwhile.
 * - loading: the chosen URL is loading
 * - done: loaded, shown from cache, or given up after retries (`gaveUp`)
 *
 * A preview that fails is tried again (most failures are a network hiccup), and is
 * never swapped for the full size original: that's the download the plugin is there
 * to avoid. A still image that keeps failing falls back to the animated preview.
 */

import type { LoadQueue, Ticket } from "./queue";
import { RETRY_DELAYS_MS } from "./tuning";

export type Phase = "queued" | "lookingUp" | "loading" | "done";

/** The React hooks the loader uses (pass React's own) */
export interface ReactHooks {
    useState<S>(initial: S | (() => S)): [S, (value: S | ((prev: S) => S)) => void];
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
    useRef<T>(initial: T): { current: T; };
}

/** The build's shared state the loader works with (tracking.ts makes it) */
export interface TileEnv {
    queue: LoadQueue;
    /** Loaded this session: shown at once without a turn in the queue */
    isLoadedThisSession(url: string): boolean;
    /** Loaded in an earlier session: first in the queue, no spinner */
    isSeenBefore(url: string): boolean;
    markLoaded(url: string): void;
    /** A URL that failed every retry: remembered as failed (stills then use the preview) */
    markFailed(url: string): void;
    /** A URL that failed once: no longer counts as loaded, so the retry takes a turn in the queue */
    forgetLoaded(url: string): void;
    /** Whether `url` failed every retry before (it then gets one quick retry) */
    failedBefore(url: string): boolean;
    /** A tile will load `url` soon (desktop: open a connection to its host ahead of time) */
    warmUp?(url: string): void;
    drop(ticket: Ticket | null): void;
    isDropped(ticket: Ticket): boolean;
    onError(message: string, e: unknown): void;
}

export interface TileLoaderOptions {
    /** The original, full resolution URL (normalized) */
    original: string;
    /** Position in reading order */
    index: number;
    /** Show a still image. Changing it picks the URL again. */
    still: boolean;
    /** False while the tile has nothing the plugin can swap: it holds no ticket then */
    enabled?: boolean;
    /** Seconds before a slow GIF gives its queue slot to the next one */
    loadTimeout: number;
    /** Whether a new tile counts as on screen until the build reports otherwise */
    initiallyVisible: boolean;
    /** A search result whose small version comes with the results page (Klipy): waits while it's fetched */
    waitsForLowRes?: boolean;
    /** The URL to show now */
    pick(): string;
    /** A lookup to wait for before picking (Klipy / Tenor), or null */
    lookup(): Promise<unknown> | null;
    /** Whether `url` is already on the device (mobile's native cache): then it's shown without a turn */
    probeCache?(url: string): Promise<boolean>;
    /**
     * A preview that neither loads nor fails falls back to the next option (some
     * mobile image views report neither). One that reports progress keeps loading.
     */
    stallFallback?: boolean;
    /** Waits before each retry of a failed preview (default RETRY_DELAYS_MS) */
    retryDelaysMs?: number[];
}

/**
 * How long to wait before retry number `retriesSoFar + 1` of a failed preview, or
 * null when it's had all its retries. One that failed for good before (probably
 * gone) gets only the first, quick one.
 */
export function retryDelay(retriesSoFar: number, failedBefore: boolean, delays: number[] = RETRY_DELAYS_MS): number | null {
    const allowed = failedBefore ? delays.slice(0, 1) : delays;
    return retriesSoFar < allowed.length ? allowed[retriesSoFar] : null;
}

export function useTileLoader(react: ReactHooks, env: TileEnv, opts: TileLoaderOptions) {
    const { useState, useEffect, useRef } = react;
    const { original, still, enabled = true, loadTimeout } = opts;
    // pick() and lookup() close over the latest props
    const optsRef = useRef(opts);
    optsRef.current = opts;

    /* ---------------------------------- State --------------------------------- */

    // The first pick decides the first render (loaded already? seen before?), and the queue reuses it
    const [initial] = useState(() => {
        const url = opts.pick();
        const loadedAlready = env.isLoadedThisSession(url);
        return { url, loadedAlready, seenBefore: !loadedAlready && env.isSeenBefore(url) };
    });
    const firstPick = useRef<string | null>(initial.loadedAlready ? null : initial.url);
    /** The URL being shown or loaded, null until the tile's turn */
    const [chosen, setChosen] = useState<string | null>(initial.loadedAlready ? initial.url : null);
    const [phase, setPhase] = useState<Phase>(initial.loadedAlready ? "done" : "queued");
    /** Loaded in an earlier session. Known before the first paint, so these tiles never flash the queued dot. */
    const [seenBefore, setSeenBefore] = useState(initial.seenBefore);
    const [progress, setProgress] = useState<number | null>(null);
    /** Bumped on each retry. Builds put it in the image's key, so the same URL loads again. */
    const [attempt, setAttempt] = useState(0);
    /** Every retry failed and there's no other preview: the tile waits (no full size download) */
    const [gaveUp, setGaveUp] = useState(false);

    const ticketRef = useRef<Ticket | null>(null);
    const indexRef = useRef(opts.index);
    indexRef.current = opts.index;
    const visibleRef = useRef(opts.initiallyVisible);
    /** The lookup already ran for this pick, so queueing again doesn't start another one */
    const lookedUp = useRef(false);
    /** When the current load started, to tell cache hits (instant) from downloads */
    const loadStartedAt = useRef(0);
    const retries = useRef(0);
    const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const cancelRetry = () => {
        clearTimeout(retryTimer.current);
        retryTimer.current = undefined;
    };

    /** Back to waiting for a turn, giving up the current ticket */
    const restart = () => {
        cancelRetry();
        retries.current = 0;
        lookedUp.current = false;
        setGaveUp(false);
        env.drop(ticketRef.current);
        setChosen(null);
        setProgress(null);
        setPhase("queued");
    };

    /** On-screen changes, for the queue's order */
    const setVisible = (visible: boolean) => {
        visibleRef.current = visible;
        const ticket = ticketRef.current;
        if (ticket && ticket.visible !== visible) {
            ticket.visible = visible;
            env.queue.kick();
        }
    };

    /* ------------------------------ A turn in the queue ------------------------------ */

    useEffect(() => {
        if (phase !== "queued" || !enabled) return;

        const url = firstPick.current ?? optsRef.current.pick();
        firstPick.current = null;
        // Loaded this session (it scrolled back, say): show it from cache right away
        if (env.isLoadedThisSession(url)) {
            setChosen(url);
            setPhase("done");
            return;
        }
        env.warmUp?.(url);
        const wasSeen = env.isSeenBefore(url);
        setSeenBefore(wasSeen);

        let started = false;
        const ticket: Ticket = {
            visible: visibleRef.current,
            seenBefore: wasSeen,
            waitsForLowRes: optsRef.current.waitsForLowRes,
            order: () => indexRef.current ?? 0,
            start: () => {
                started = true;
                try {
                    const lookup = lookedUp.current ? null : optsRef.current.lookup();
                    if (lookup) lookUpThenQueueAgain(ticket, lookup);
                    else startLoading(ticket);
                } catch (e) {
                    env.onError("Couldn't start loading a GIF", e);
                    setChosen(original);
                    setProgress(null);
                    setPhase("loading");
                }
            },
        };
        ticketRef.current = ticket;
        env.queue.enqueue(ticket);

        // Still on the device from an earlier session (mobile): show it now instead of waiting
        optsRef.current.probeCache?.(url).then(hit => {
            if (!hit || started || env.isDropped(ticket)) return;
            env.drop(ticket);
            setChosen(url);
            setPhase("done");
        }, () => { });

        // Once started, the slot is freed by finishing, a restart or unmounting instead
        return () => {
            if (!started) env.drop(ticket);
        };
    }, [phase, still, enabled]);

    /** The ticket's turn: show the URL picked now (a lookup may have found a smaller one) */
    const startLoading = (ticket: Ticket) => {
        const url = optsRef.current.pick();
        setChosen(url);
        setProgress(null);
        if (env.isLoadedThisSession(url)) {
            env.queue.finish(ticket);
            setPhase("done");
        } else {
            loadStartedAt.current = Date.now();
            setPhase("loading");
        }
    };

    /**
     * A lookup isn't a download: give the slot to the next GIF meanwhile, and queue
     * again once the small URL is known (or the lookup gave up)
     */
    const lookUpThenQueueAgain = (ticket: Ticket, lookup: Promise<unknown>) => {
        lookedUp.current = true;
        env.queue.finish(ticket);
        setPhase("lookingUp");
        lookup.catch(() => { }).then(() => {
            if (!env.isDropped(ticket)) setPhase("queued");
        });
    };

    /* ------------------------------ Outside changes ------------------------------ */

    // The still favourites setting changed: pick the URL again
    const stillRef = useRef(still);
    useEffect(() => {
        if (stillRef.current === still) return;
        stillRef.current = still;
        // Still waiting: the queue effect above already re-ran for the new setting and
        // queued a fresh ticket. Dropping it here would leave the tile waiting forever.
        if (phase !== "queued") restart();
    }, [still]);

    // Nothing to swap any more (mobile: Discord's tile lost its Image) during a lookup
    // or load: give it up and wait again. Queued tickets are dropped by the queue
    // effect's cleanup, and it queues again once `enabled` is back.
    useEffect(() => {
        if (!enabled && (phase === "lookingUp" || phase === "loading")) restart();
    }, [enabled]);

    // After the timeout a slow GIF gives its slot to the next one and carries on in
    // the background (counted as overtime, so slow ones can't pile up)
    useEffect(() => {
        if (phase !== "loading") return;
        const timer = setTimeout(() => ticketRef.current && env.queue.release(ticketRef.current), loadTimeout * 1000);
        return () => clearTimeout(timer);
    }, [phase, chosen]);

    // Unmounted: free the slot
    useEffect(() => () => {
        cancelRetry();
        env.drop(ticketRef.current);
    }, []);

    /* -------------------------------- Load outcome -------------------------------- */

    /** The shown URL loaded (also when shown from cache) */
    const done = () => {
        if (chosen) env.markLoaded(chosen);
        // It loaded after all (the image element retried by itself): no failed mark
        if (gaveUp) setGaveUp(false);
        if (phase !== "loading") return;
        if (ticketRef.current) env.queue.finish(ticketRef.current, Date.now() - loadStartedAt.current);
        setPhase("done");
    };

    /** The shown URL failed (also when shown from cache: it may not load any more) */
    const error = () => {
        // Already waiting to try again
        if (retryTimer.current) return;
        if (!chosen || chosen === original) {
            // Discord's own tile handles the original
            if (ticketRef.current) env.queue.finish(ticketRef.current);
            setPhase("done");
            return;
        }
        setProgress(null);

        const delay = retryDelay(retries.current, env.failedBefore(chosen), optsRef.current.retryDelaysMs);
        if (delay != null) {
            retryLater(chosen, delay);
            return;
        }

        // Out of retries: another preview if there is one (a still image falls back to the animated preview)
        env.markFailed(chosen);
        const next = optsRef.current.pick();
        if (next !== chosen && next !== original) {
            retries.current = 0;
            setChosen(next);
            setAttempt(a => a + 1);
            if (phase === "done") setPhase("loading");
            return;
        }

        // Give up for now. The tile tries again when it comes back on screen or the picker reopens.
        if (ticketRef.current) env.queue.finish(ticketRef.current);
        setGaveUp(true);
        setPhase("done");
    };

    /** Queues the same URL again after `delay`, without holding a queue slot meanwhile */
    const retryLater = (failedUrl: string, delay: number) => {
        retries.current++;
        if (ticketRef.current) env.queue.finish(ticketRef.current);
        retryTimer.current = setTimeout(() => {
            retryTimer.current = undefined;
            env.forgetLoaded(failedUrl);
            env.drop(ticketRef.current);
            setChosen(null);
            setAttempt(a => a + 1);
            setPhase("queued");
        }, delay);
    };

    const noteProgress = useStallFallback(react, {
        active: !!opts.stallFallback && phase === "loading" && !!chosen && chosen !== original,
        restartKey: chosen,
        loadTimeout,
        onStall: error,
    });

    /** Download progress, while loading */
    const reportProgress = (loadedBytes: number, total: number) => {
        noteProgress();
        if (phase === "loading" && total > 0) setProgress(loadedBytes / total);
    };

    return { phase, chosen, seenBefore, progress, attempt, gaveUp, setVisible, done, error, reportProgress };
}

/**
 * Calls `onStall` when a load reports nothing for a while: first after twice the
 * load timeout, then after a load timeout without progress. Returns the function
 * to call on each progress event.
 */
function useStallFallback(react: ReactHooks, o: { active: boolean; restartKey: unknown; loadTimeout: number; onStall(): void; }) {
    const { useEffect, useRef } = react;
    const onStall = useRef(o.onStall);
    onStall.current = o.onStall;
    const lastProgress = useRef(0);

    useEffect(() => {
        if (!o.active) return;
        lastProgress.current = 0;
        const quietLimit = o.loadTimeout * 1000;
        let timer: ReturnType<typeof setTimeout>;
        const check = () => {
            const quiet = Date.now() - lastProgress.current;
            if (lastProgress.current && quiet < quietLimit) {
                timer = setTimeout(check, quietLimit - quiet);
                return;
            }
            onStall.current();
        };
        timer = setTimeout(check, o.loadTimeout * 2000);
        return () => clearTimeout(timer);
    }, [o.active, o.restartKey]);

    return () => {
        lastProgress.current = Date.now();
    };
}
