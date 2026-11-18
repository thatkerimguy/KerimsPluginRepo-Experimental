/*
 * The webpack patches, kept apart from index.tsx as plain data so the tests can
 * check them against Discord's code (tests/patches.test.ts) without Vencord.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Patch } from "@utils/types";

export const patches: Omit<Patch, "plugin">[] = [
    {
        // GIF picker results list (masonry of GIF tiles)
        find: "renderEmptyFavorite",
        replacement: {
            match: /(\(0,\i\.jsx\)\()(\i),\{(?=item:(\i),index:\i,format:\3\.format,src:\3\.src)/,
            replace: "$1$self.GifTile,{Result:$2,resultType:this?.props?.resultType,",
        },
    },
    {
        // GIF picker actions: search (`y`, debounced 250 ms) and trending GIFs (`Z4`).
        // The low resolution request for Klipy previews starts together with Discord's.
        // Without this patch, it's sent once Discord's results arrive (LowResPages.arrived).
        find: '"GIF_PICKER_QUERY_SUCCESS",query:',
        replacement: [
            {
                match: /(?=\i\.\i\.get\(\{url:\i\.\i\.GIFS_SEARCH,query:\{q:(\i),media_format:[^}]*?limit:(\i)\})/,
                replace: "$self.lowResStarted($1,$2),",
            },
            {
                match: /(?=\i\.\i\.get\(\{url:\i\.\i\.GIFS_TRENDING_GIFS,query:\{media_format:[^}]*?limit:(\i)\})/,
                replace: "$self.lowResStarted(void 0,$1),",
            },
        ],
    },
];
