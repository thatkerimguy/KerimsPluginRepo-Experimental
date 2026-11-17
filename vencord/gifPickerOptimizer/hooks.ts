/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "@webpack/common";

import { usePrecacheUpdates as usePrecacheUpdatesWith } from "./precache";
import { runtime } from "./state";

/** Re-renders when precaching progresses (hooks read at render time, see CLAUDE.md) */
export function usePrecacheUpdates() {
    usePrecacheUpdatesWith({ useState, useEffect }, runtime.precache);
}
