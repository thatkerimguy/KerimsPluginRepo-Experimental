/*
 * Per-platform kill switch. A resolver that keeps failing to parse (the site
 * changed its format) turns itself off for the session, so cards stop trying and
 * Discord's embeds stay; settings show why. Network errors and missing posts
 * don't count: they say nothing about the parser.
 */

import { NotFoundError, ParseError } from "./fetcher";
import type { Platform } from "./model";

export const FAILURES_TO_DISABLE = 5;

export interface PlatformHealth {
    ok: number;
    failedInARow: number;
    disabled: boolean;
    lastError?: string;
}

export class Health {
    private readonly state = new Map<Platform, PlatformHealth>();
    onChange?: (platform: Platform, health: PlatformHealth) => void;

    get(platform: Platform): PlatformHealth {
        let s = this.state.get(platform);
        if (!s) this.state.set(platform, s = { ok: 0, failedInARow: 0, disabled: false });
        return s;
    }

    usable(platform: Platform) {
        return !this.get(platform).disabled;
    }

    success(platform: Platform) {
        const s = this.get(platform);
        s.ok++;
        s.failedInARow = 0;
        this.onChange?.(platform, s);
    }

    failure(platform: Platform, error: unknown) {
        if (error instanceof NotFoundError || !(error instanceof ParseError)) return;
        const s = this.get(platform);
        s.failedInARow++;
        s.lastError = error.message;
        if (s.failedInARow >= FAILURES_TO_DISABLE) s.disabled = true;
        this.onChange?.(platform, s);
    }

    reset() {
        this.state.clear();
    }
}
