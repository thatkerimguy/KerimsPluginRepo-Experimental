/*
 * GIFs+ — one tile's load lifecycle: its queue ticket, cache shortcuts, timeouts
 * and fallbacks.
 * Shared between the Vencord and Valenced builds (keep both copies in sync).
 *
 * It's a hook that gets React's hooks as an argument, because each build reaches
 * React differently (Vencord's webpack common, React Native's `react`), and the
 * Valenced build may not touch React when the script is evaluated.
 *
 * - queued: waiting for a turn in the load queue
 * - resolving: looking up the small Klipy / Tenor URL before loading
 * - loading: the chosen URL is loading
 * - done: loaded, failed for good, or shown from cache
 */

import { wait } from "./klipy";
import type { LoadQueue, Ticket } from "./queue";

export type Phase = "queued" | "resolving" | "loading" | "done";

/** The React hooks the loader uses (pass React's own) */
export interface ReactHooks {
    useState<S>(initial: S | (() => S)): [S, (value: S | ((prev: S) => S)) => void];
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
    useRef<T>(initial: T): { current: T; };
}

/** The build's shared state the loader works with */
export interface TileEnv {
    queue: LoadQueue;
    /** Loaded this session: shown at once without a turn in the queue */
    isCached(url: string): boolean;
    /** Precached or loaded in an earlier session: first in the queue, no spinner */
    isPrecached(url: string): boolean;
    markLoaded(url: string): void;
    /** A URL that failed: remembered as failed and forgotten as loaded */
    markFailed(url: string): void;
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
    /** Seconds before a slow GIF frees its queue slot */
    loadTimeout: number;
    /** Whether a new tile counts as on screen until the build reports otherwise */
    initiallyVisible: boolean;
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
}

export function useTileLoader(react: ReactHooks, env: TileEnv, opts: TileLoaderOptions) {
    const { useState, useEffect, useRef } = react;
    const { original, still, enabled = true, loadTimeout } = opts;
    // pick() and lookup() close over the latest props
    const optsRef = useRef(opts);
    optsRef.current = opts;

    // The first pick decides the first render (cached, precached), and the queue reuses it
    const [initial] = useState(() => {
        const url = opts.pick();
        const cached = env.isCached(url);
        return { url, cached, precached: !cached && env.isPrecached(url) };
    });
    const firstPick = useRef<string | null>(initial.cached ? null : initial.url);
    /** The URL being shown or loaded, null until the tile's turn */
    const [chosen, setChosen] = useState<string | null>(initial.cached ? initial.url : null);
    const [phase, setPhase] = useState<Phase>(initial.cached ? "done" : "queued");
    /** Set before the first paint, so precached tiles never flash the queued dot */
    const [precached, setPrecached] = useState(initial.precached);
    const [progress, setProgress] = useState<number | null>(null);

    const ticketRef = useRef<Ticket | null>(null);
    const indexRef = useRef(opts.index);
    indexRef.current = opts.index;
    const visibleRef = useRef(opts.initiallyVisible);

    /** On-screen changes, for the queue's priority */
    const setVisible = (visible: boolean) => {
        visibleRef.current = visible;
        const ticket = ticketRef.current;
        if (ticket && ticket.visible !== visible) {
            ticket.visible = visible;
            env.queue.kick();
        }
    };

    /** Back to waiting for a turn, giving up the current ticket */
    const restart = () => {
        env.drop(ticketRef.current);
        setChosen(null);
        setProgress(null);
        setPhase("queued");
    };

    // Wait for a turn in the load queue
    useEffect(() => {
        if (phase !== "queued" || !enabled) return;

        const url = firstPick.current ?? optsRef.current.pick();
        firstPick.current = null;
        // Loaded recently (or came back on screen): show it from cache right away
        if (env.isCached(url)) {
            setChosen(url);
            setPhase("done");
            return;
        }
        const priority = env.isPrecached(url);
        setPrecached(priority);

        let started = false;
        const begin = () => {
            const next = optsRef.current.pick();
            setChosen(next);
            setProgress(null);
            if (env.isCached(next)) {
                env.queue.finish(ticket);
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
                    const lookup = optsRef.current.lookup();
                    if (!lookup) return begin();
                    setPhase("resolving");
                    // A lookup never holds a tile longer than the load timeout
                    Promise.race([lookup, wait(loadTimeout * 1000)])
                        .catch(() => { })
                        .then(() => !env.isDropped(ticket) && begin());
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

        // Still on the device from an earlier session: show it now instead of waiting
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

    // The still favourites setting changed: pick the URL again
    const stillRef = useRef(still);
    useEffect(() => {
        if (stillRef.current === still) return;
        stillRef.current = still;
        // Still waiting: the queue effect above already re-ran for the new setting and
        // queued a fresh ticket. Dropping it here would leave the tile waiting forever.
        if (phase !== "queued") restart();
    }, [still]);

    // Nothing to swap any more (mobile: Discord's tile lost its Image) while a lookup
    // or load holds a ticket: give it up and wait again. Queued tickets are dropped by
    // the queue effect's cleanup, and it queues again once `enabled` is back.
    useEffect(() => {
        if (!enabled && (phase === "resolving" || phase === "loading")) restart();
    }, [enabled]);

    // Release the slot after the timeout so one slow GIF doesn't hold everything up
    useEffect(() => {
        if (phase !== "loading" && phase !== "resolving") return;
        const timer = setTimeout(() => ticketRef.current && env.queue.finish(ticketRef.current), loadTimeout * 1000);
        return () => clearTimeout(timer);
    }, [phase, chosen]);

    // Unmounted while loading: free the slot
    useEffect(() => () => env.drop(ticketRef.current), []);

    /** The shown URL loaded (also when shown from cache) */
    const done = () => {
        if (chosen) env.markLoaded(chosen);
        if (phase !== "loading") return;
        if (ticketRef.current) env.queue.finish(ticketRef.current);
        setPhase("done");
    };

    /** The shown URL failed: try the next best one, then the original */
    const error = () => {
        if (chosen && chosen !== original) {
            env.markFailed(chosen);
            setProgress(null);
            const next = optsRef.current.pick();
            setChosen(next !== chosen ? next : original);
            // Also when shown from cache ("done"): the URL may not load any more
            if (phase === "done") setPhase("loading");
            return;
        }
        if (ticketRef.current) env.queue.finish(ticketRef.current);
        setPhase("done");
    };

    // Stall fallback (see `stallFallback`)
    const errorRef = useRef(error);
    errorRef.current = error;
    const progressAt = useRef(0);
    useEffect(() => {
        if (!opts.stallFallback || phase !== "loading" || !chosen || chosen === original) return;
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

    /** Download progress, while loading */
    const reportProgress = (loadedBytes: number, total: number) => {
        progressAt.current = Date.now();
        if (phase === "loading" && total > 0) setProgress(loadedBytes / total);
    };

    return { phase, chosen, precached, progress, setVisible, done, error, reportProgress };
}
