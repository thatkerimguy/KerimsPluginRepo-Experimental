/** @jsxRuntime classic */
/** @jsx valenced.react.React.createElement */
/** @jsxFrag valenced.react.React.Fragment */
/*
 * The picker's main page with "favourites only": the Favorites precache bar
 * and the Favorites tile, without the trending categories.
 */

import { Design } from "@valenced/discord/design";
import { StyleSheet, View } from "react-native";

import { favoriteItems } from "./favorites";
import { lazy } from "./lazy";
import { PrecacheButton, precacheStats, usePrecacheUpdates } from "./favoritesUi";
import { pickerModules } from "./modules";
import { runtime } from "./state";

export interface CategoriesPageProps {
    columns?: number;
    favoritesCategory?: { type: unknown; name: string; src: string; format?: number; } | null;
    onSelectCategory?: (type: unknown, name: string) => void;
    [k: string]: unknown;
}

/** Sizes like Discord's categories page */
function rowHeight(columns: number) {
    const full = pickerModules.utils?.GIF_PICKER_ITEM_ESIMTATED_HEIGHT ?? 180;
    return columns > 2 ? full : full / 2;
}
const gutter = () => pickerModules.utils?.GIF_PICKER_GUTTER_SPACING ?? 8;

/** "Favorites · 120 GIFs, 80 precached  [Precache]" */
function FavoritesBar() {
    // Read on render: Discord's design module isn't loaded when the script is evaluated (lazy.ts)
    const { Text } = Design;
    usePrecacheUpdates();
    const items = favoriteItems();
    if (!items.length || !runtime.precache) return null;
    return (
        <View style={styles().bar}>
            <View style={styles().flex}>
                <Text variant="text-sm/semibold" color="text-strong">Favorites</Text>
                <Text variant="text-xs/medium" color="text-muted">{precacheStats(items)}</Text>
            </View>
            <PrecacheButton label="Favorites" items={items} />
        </View>
    );
}

/**
 * One row with Discord's tile for Favorites (same height and gutter as
 * Discord's page). Discord's page would pad one category with 20 rows of
 * loading skeletons, so it isn't reused.
 */
export function MainPage({ props }: { props: CategoriesPageProps; }) {
    const { Text } = Design;
    const CategoryView = pickerModules.categoryView!.default;
    const columns = Math.max(1, props.columns || 2);

    if (!props.favoritesCategory) {
        return (
            <View style={styles().hint}>
                <Text variant="text-md/medium" color="text-muted">Search for GIFs above.</Text>
            </View>
        );
    }

    return (
        <View style={styles().flex}>
            <FavoritesBar />
            <View style={{ height: rowHeight(columns), flexDirection: "row", gap: gutter() }}>
                <CategoryView item={props.favoritesCategory} onSelectCategory={props.onSelectCategory} />
                {Array.from({ length: columns - 1 }, (_, c) => <View key={c} style={styles().flex} />)}
            </View>
        </View>
    );
}

/** Whether `MainPage` can replace Discord's page */
export function canShowMainPage(props: CategoriesPageProps) {
    return typeof pickerModules.categoryView?.default === "function" && typeof props.onSelectCategory === "function";
}

const styles = lazy(() => StyleSheet.create({
    flex: {
        flex: 1,
    },
    bar: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingBottom: 8,
    },
    hint: {
        flex: 1,
        alignItems: "center",
        paddingTop: 48,
        paddingHorizontal: 24,
    },
}));
