/*
 * The GIF tab: a faster switch to it, and the main page with "favourites only".
 */

import { useEffect, useState } from "react";
import { ActivityIndicator, InteractionManager, StyleSheet, View } from "react-native";

import type { CategoriesPageProps } from "./mainPage";
import { canShowMainPage, MainPage } from "./mainPage";
import type { AnyComponent } from "./modules";
import { pickerModules } from "./modules";
import { useSettings } from "./settingsStore";

// Rendered as their own components (not called inline), so their hooks don't
// change the wrapper's hook order when it switches between them.
const PickerInner: AnyComponent = p => pickerModules.picker!(p);
const CategoriesPageInner: AnyComponent = p => pickerModules.categoriesPage!(p);

/** Longest the picker waits before building, even if the tab switch is still animating */
const MAX_DEFER_MS = 300;

/**
 * Discord builds the whole GIF picker (search, categories, trending requests,
 * animated category previews) in the same frame the tab switches, so the tab
 * freezes until it's done. This renders an empty frame first, so the tab
 * switch shows at once, and builds the picker right after.
 */
export function DeferredPicker({ props }: { props: Record<string, unknown>; }) {
    const { fastTabSwitch } = useSettings();
    const [ready, setReady] = useState(!fastTabSwitch);

    useEffect(() => {
        if (ready) return;
        let done = false;
        const go = () => {
            if (done) return;
            done = true;
            setReady(true);
        };
        // Wait for the tab switch to paint (and any animation), but never long
        const raf = requestAnimationFrame(() => setTimeout(go, 0));
        const task = InteractionManager.runAfterInteractions(go);
        const cap = setTimeout(go, MAX_DEFER_MS);
        return () => {
            done = true;
            cancelAnimationFrame(raf);
            task?.cancel?.();
            clearTimeout(cap);
        };
    }, [ready]);

    if (!ready) return <View style={styles.pickerPlaceholder}><ActivityIndicator /></View>;
    return <PickerInner {...props} />;
}

/** The picker's main page: only Favorites with "favourites only", else Discord's own page */
export function CategoriesPage({ props }: { props: CategoriesPageProps; }) {
    const { favoritesOnly } = useSettings();
    if (!favoritesOnly || !canShowMainPage(props)) return <CategoriesPageInner {...props} />;
    return <MainPage props={props} />;
}

const styles = StyleSheet.create({
    pickerPlaceholder: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
});
