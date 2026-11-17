/*
 * GIFs+ — small async helpers.
 * Shared between the Vencord and Valenced builds (keep both copies in sync).
 */

/** Runs at most `max` tasks at once; a finished task frees its place `spacingMs` later */
export class Limiter {
    private running = 0;
    private waiters: (() => void)[] = [];

    constructor(private max: number, private spacingMs: number) { }

    async run<T>(task: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await task();
        } finally {
            setTimeout(() => this.release(), this.spacingMs);
        }
    }

    private acquire(): Promise<void> {
        if (this.running < this.max) {
            this.running++;
            return Promise.resolve();
        }
        return new Promise(resolve => this.waiters.push(resolve));
    }

    /** Hands the place to the next task in line, or frees it */
    private release() {
        const next = this.waiters.shift();
        if (next) next();
        else this.running--;
    }
}

export function wait(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}
