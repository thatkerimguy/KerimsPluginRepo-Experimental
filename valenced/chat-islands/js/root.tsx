/** @jsxRuntime classic */
/** @jsx valenced.react.React.createElement */
/** @jsxFrag valenced.react.React.Fragment */
/*
 * The React root every island surface runs (AppRegistry module "ChatIsland").
 * Native starts a surface with props { islandKey, width, measuring } and reuses
 * surfaces between islands by changing islandKey.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AppRegistry, View } from "react-native";

import { getModuleWithImportedPath } from "@valenced/discord/utils/modules/finders";

import { lazy } from "./lazy";
import { reportHeight } from "./measure";
import { hooks, useIsland } from "./runtime";
import { works } from "./status";

export const SURFACE_MODULE = "ChatIsland";

interface RootProps {
    islandKey?: string;
    /** dp */
    width?: number;
    measuring?: boolean;
}

// Made on first use: React isn't loaded when the script is evaluated (lazy.ts)
const Boundary = lazy(() => class IslandBoundary extends Component<{ islandKey: string; children: ReactNode; }, { error: boolean; }> {
    state = { error: false };
    static getDerivedStateFromError() {
        return { error: true };
    }
    componentDidCatch(error: unknown, info: ErrorInfo) {
        hooks.log("error", `Island ${this.props.islandKey} crashed`, error, info?.componentStack);
    }
    componentDidUpdate(prev: { islandKey: string; }) {
        // A reused surface showing another island starts clean
        if (prev.islandKey !== this.props.islandKey && this.state.error) this.setState({ error: false });
    }
    render() {
        return this.state.error ? null : this.props.children;
    }
});

/**
 * Discord's root theme provider (reads the theme, contrast and saturation from its stores).
 * An island surface is a separate React root, outside Discord's provider, so without this
 * `Design.createStyles` resolves tokens for the default (light) theme: seen on the device in
 * 0.1.0.25 (a light card in dark mode).
 */
const THEME_PROVIDER_PATH = "modules/themes/RootThemeContextProvider.native.tsx";
let ThemeProvider: ((props: { children: ReactNode; }) => ReactNode) | null = null;

function IslandRoot(props: RootProps) {
    const content = <IslandContent {...props} />;
    // The boundary is outside the theme provider too: a throw there would otherwise unmount the
    // whole surface silently (an empty surface was seen on the device in 0.1.0.26)
    const ErrorBoundary = Boundary();
    return (
        <ErrorBoundary islandKey={props.islandKey ?? ""}>
            {ThemeProvider ? <ThemeProvider>{content}</ThemeProvider> : content}
        </ErrorBoundary>
    );
}

/** Which island each surface showed last (for the diagnostics: one line per change). */
const lastRendered = new Map<string, string>();

function IslandContent({ islandKey = "", width = 0, measuring = false }: RootProps) {
    const island = useIsland(islandKey);
    const what = `${islandKey}|${width}|${measuring}|${island ? island.phase : "none"}`;
    const surfaceId = `${measuring ? "measure" : "show"}:${islandKey}`;
    if (lastRendered.get(surfaceId) !== what) {
        lastRendered.set(surfaceId, what);
        if (lastRendered.size > 200) lastRendered.clear();
        hooks.log("warn", `diag: island root ${islandKey} (${measuring ? "measuring" : "showing"}, ${width} dp): ${island ? `phase ${island.phase}` : "not in the store"}`);
    }
    if (!island || !width) return null;
    works("surfaces");
    const Island = island.provider.component;
    const ErrorBoundary = Boundary();
    return (
        <View
            // Keyed by island: a reused surface gets a new view, so onLayout fires for every island.
            // Without it, a surface pointed at another island of the same size never reported a
            // height and measuring timed out (0.1.0.26 on the device).
            key={islandKey}
            // Measuring renders at the requested width; a shown island fills its host, which Discord
            // may have made narrower than that (it scales the placeholder down to fit the chat).
            style={measuring ? { width } : { width: "100%" }}
            collapsable={false}
            onLayout={measuring ? e => reportHeight(islandKey, width, e.nativeEvent.layout.height) : undefined}
        >
            <ErrorBoundary islandKey={islandKey}>
                <Island islandKey={islandKey} slot={island.slot} message={island.message} width={width} measuring={measuring} />
            </ErrorBoundary>
        </View>
    );
}

let registered = false;

/** Registers the surface module (once per app run: AppRegistry has no unregister). */
export function registerRoot() {
    if (registered) return;
    getModuleWithImportedPath<{ RootThemeContextProvider?: typeof ThemeProvider; }>(THEME_PROVIDER_PATH, mod => {
        if (typeof mod?.RootThemeContextProvider === "function") ThemeProvider = mod.RootThemeContextProvider;
        else hooks.log("warn", "Discord's RootThemeContextProvider not found: islands use the default theme");
    });
    AppRegistry.registerComponent(SURFACE_MODULE, () => IslandRoot);
    registered = true;
}
