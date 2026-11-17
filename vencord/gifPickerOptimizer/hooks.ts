/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "@webpack/common";

import { runtime } from "./state";

/** Re-renders when precaching progresses */
export function usePrecacheUpdates() {
    const [, setTick] = useState(0);
    const { precache } = runtime;
    useEffect(() => precache?.subscribe(() => setTick(n => n + 1)), [precache]);
}
