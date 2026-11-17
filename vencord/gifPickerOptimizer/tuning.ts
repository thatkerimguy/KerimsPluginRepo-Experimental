/*
 * GIFs+ — the numbers that decide how GIFs load, in one place. Most of them are
 * educated guesses that real use in Discord should confirm or adjust.
 * Shared between the Vencord and Valenced builds (keep both copies in sync).
 */

const SECOND = 1000;
const DAY = 24 * 60 * 60 * SECOND;

/** Waits before each retry of a failed preview. One that failed for good before only gets the first. */
export const RETRY_DELAYS_MS = [1 * SECOND, 3 * SECOND, 9 * SECOND];

/** A seen-before GIF that loaded this fast came from the cache: the fast lane opens */
export const CACHE_HIT_MS = 150;
/** One that took this long really downloaded: the fast lane closes */
export const CACHE_MISS_MS = 400;
/** Extra seen-before GIFs that may load at once while the fast lane is open */
export const FAST_LANE_EXTRA = 8;

/** Slow GIFs past the load timeout may add up to this many times "GIFs at the same time" */
export const OVERTIME_FACTOR = 1;
/** An overtime download stops counting after this long, even if it never reported back */
export const OVERTIME_MAX_MS = 60 * SECOND;

/** Longest Klipy search tiles wait for the small versions of their results page */
export const LOW_RES_WAIT_MS = 3 * SECOND;
/** A small-versions request that worked is reused for the same page within this long */
export const LOW_RES_REUSE_MS = 5 * 60 * SECOND;

/** Klipy favourite lookups running at once */
export const LOOKUP_CONCURRENCY = 2;
/** A lookup frees its place this long after it ended (spreads requests out) */
export const LOOKUP_SPACING_MS = 300;
/** Longest one lookup search may take */
export const LOOKUP_TIMEOUT_MS = 8 * SECOND;

/** Saved lists are written at most this often (a write replaces the whole list) */
export const SAVE_DELAY_MS = 15 * SECOND;

/** GIFs remembered across restarts, and for how long */
export const SEEN_MAX = 5000;
export const SEEN_MAX_AGE_MS = 14 * DAY;
/** Previews remembered as failed, and for how long */
export const FAILED_MAX = 600;
export const FAILED_MAX_AGE_MS = 7 * DAY;
