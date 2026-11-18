/*
 * Which parts are seen working, for the settings page and bug reports.
 */

export type Part = "rows" | "rowManager" | "longPress" | "native" | "surfaces";

export interface PartStatus {
    state: "waiting" | "works" | "failed";
    detail?: string;
}

const parts = new Map<Part, PartStatus>();
const listeners = new Set<() => void>();

const emit = () => { for (const l of listeners) l(); };

export function works(part: Part) {
    if (parts.get(part)?.state === "works") return;
    parts.set(part, { state: "works" });
    emit();
}

export function failed(part: Part, detail: string) {
    parts.set(part, { state: "failed", detail });
    emit();
}

export function partStatus(part: Part): PartStatus {
    return parts.get(part) ?? { state: "waiting" };
}

export function allParts(): [Part, PartStatus][] {
    return (["native", "rows", "rowManager", "surfaces", "longPress"] as Part[]).map(p => [p, partStatus(p)]);
}

export function onPartsChange(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function resetParts() {
    parts.clear();
    emit();
}
