/*
 * Discord's GIF favourites (frecency user settings), for export / import.
 */

import { runtime } from "./state";
import { createFavoritesBackend } from "./transfer";

export const favoritesBackend = createFavoritesBackend(
    () => runtime.frecency,
    () => runtime.logger?.warn?.("Discord's favourites aren't loaded yet, nothing was changed"),
);
