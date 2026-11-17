/*
 * GIFs+ — which of the plugin's hooks into Discord are working, for the
 * "Patches" section in settings. Discord changes its code often; when a patch
 * stops matching, the plugin falls back quietly (only a console warning), so
 * this shows it where people look.
 * Shared between the Vencord and Valenced builds (keep both copies in sync).
 */

export type PatchState = "waiting" | "ok" | "failed";

export interface PatchStatus {
    label: string;
    state: PatchState;
    /** What it needs to be seen (waiting), or what went wrong (failed) */
    detail?: string;
}

const statuses = new Map<string, PatchStatus>();

/** Registers a patch that hasn't been seen working yet. `hint` says what makes it run. */
export function expectPatch(id: string, label: string, hint: string) {
    statuses.set(id, { label, state: "waiting", detail: hint });
}

/** The patch ran (cheap: call it from hot paths) */
export function patchWorks(id: string) {
    const status = statuses.get(id);
    if (status && status.state !== "ok") {
        status.state = "ok";
        status.detail = undefined;
    }
}

export function patchFailed(id: string, detail: string) {
    const status = statuses.get(id);
    if (status) {
        status.state = "failed";
        status.detail = detail;
    }
}

export function patchStatuses(): PatchStatus[] {
    return [...statuses.values()];
}

export function clearPatches() {
    statuses.clear();
}

/** One line for settings: "Working", "Not seen yet: open the GIF picker", "Failed: ..." */
export function describePatch({ state, detail }: PatchStatus) {
    if (state === "ok") return "Working";
    if (state === "failed") return `Failed: ${detail ?? "unknown"}`;
    return `Not seen yet${detail ? `: ${detail}` : ""}`;
}
