/*
 * GIFs+ — clearing the caches when the settings or the plugin version change.
 * Shared between the Vencord and Valenced builds (keep both copies in sync).
 *
 * What the plugin remembers (loaded and seen GIFs, failed previews, Klipy and
 * Tenor lookups) depends on the settings (preview size, still favourites...) and
 * on how this version picks and checks previews. So any settings change clears
 * it, and so does starting a different version than the one that saved it.
 * Discord's own image cache isn't touched: GIFs still come from it, they just
 * take their turn in the queue again.
 */

export interface VersionStore {
    /** The version that saved the caches, undefined the first time */
    load(): Promise<string | undefined> | string | undefined;
    save(version: string): void;
}

export interface CacheInvalidationOptions {
    /** Clears every cache, also the saved ones */
    reset(): void;
    /** Why the caches were cleared, for the log */
    onReset?(reason: string): void;
    onError?(e: unknown): void;
}

export function createCacheInvalidation(o: CacheInvalidationOptions) {
    let active = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const reset = (reason: string) => {
        try {
            o.reset();
            o.onReset?.(reason);
        } catch (e) {
            o.onError?.(e);
        }
    };

    return {
        /** Call when the plugin starts (after the saved caches are attached) */
        start() {
            active = true;
        },
        stop() {
            active = false;
            clearTimeout(timer);
            timer = undefined;
        },
        /**
         * A setting changed. Several changes at once (Restore default settings)
         * clear the caches once.
         */
        settingsChanged() {
            if (!active || timer) return;
            timer = setTimeout(() => {
                timer = undefined;
                if (active) reset("settings changed");
            }, 0);
        },
        /** Clears the caches if they were saved by another version (or before versions were saved) */
        async checkVersion(current: string, store: VersionStore) {
            let saved: string | undefined;
            try {
                saved = await store.load();
            } catch (e) {
                o.onError?.(e);
            }
            if (!active || saved === current) return;
            reset(saved == null ? `first start of ${current}` : `version changed from ${saved} to ${current}`);
            try {
                store.save(current);
            } catch (e) {
                o.onError?.(e);
            }
        },
    };
}
