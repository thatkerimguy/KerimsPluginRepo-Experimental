/*
 * "Favourites only": the picker's main page keeps the Favorites tile but drops
 * Trending GIFs and the other featured categories, and doesn't fetch them.
 * These functions are called from the patched categories component (as $self).
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { patchWorks } from "./diagnostics";
import { settings } from "./settings";

/** Stable empty list, so memoized category data doesn't change on every render */
const NO_CATEGORIES: never[] = [];

/** Discord's "fetch trending categories" action, from the open picker's main page */
let fetchCategories: (() => void) | undefined;
let categoriesRequested = false;

/** Whether featured categories should be shown but aren't loaded yet */
function categoriesMissing(categories: unknown[] | undefined) {
    return !settings.store.favoritesOnly && (categories?.length ?? 0) === 0;
}

/** Tiles after Favorites on the picker's main page: the featured categories (none with "Favourites only") */
export function featured<T>(categories: T[]) {
    patchWorks("categories");
    return settings.store.favoritesOnly ? NO_CATEGORIES as T[] : categories;
}

/** The main page mounted: fetch featured categories unless they're hidden or loaded */
export function mountCategories(categories: unknown[] | undefined, fetch: () => void) {
    fetchCategories = fetch;
    categoriesRequested = false;
    if (categoriesMissing(categories)) {
        categoriesRequested = true;
        fetch();
    }
}

/**
 * Whether the main page waits (loading skeleton) for featured categories.
 * When they're needed but were skipped on mount (the option was turned off
 * while the picker was open), this starts the fetch.
 */
export function needsCategories(categories: unknown[] | undefined): boolean {
    const missing = categoriesMissing(categories);
    if (missing && !categoriesRequested && fetchCategories) {
        categoriesRequested = true;
        const fetch = fetchCategories;
        // Not during render: fetching dispatches
        setTimeout(() => fetch(), 0);
    }
    return missing;
}
