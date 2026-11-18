/** @jsxRuntime classic */
/** @jsx valenced.react.React.createElement */
/** @jsxFrag valenced.react.React.Fragment */
/*
 * A test island for checking Chat Islands on a device (TESTING.md, phase 0):
 * any message containing "[island test]" gets one. It shows its width and
 * whether it's on screen, a sideways-scrolling row (swipes inside chat), and a
 * counter whose value survives scrolling away and back (useIslandState).
 */

import { Tokens } from "@valenced/discord/common/tokens";
import { Design } from "@valenced/discord/design";
import { Pressable, ScrollView, Text, View } from "react-native";

import type { IslandProps, IslandProvider } from "./api";
import { lazy } from "./lazy";
import { useIslandState, useIslandVisible } from "./runtime";

export const DEMO_TRIGGER = "[island test]";

const TILES = Array.from({ length: 12 }, (_, i) => i + 1);

/** Colours from Discord's theme tokens, resolved for the current theme by the hook */
const useStyles = lazy(() => Design.createStyles({
    card: {
        borderRadius: 12,
        padding: 12,
        gap: 10,
        backgroundColor: Tokens.default.colors.BACKGROUND_BASE_LOWER,
        borderWidth: 1,
        borderColor: Tokens.default.colors.BORDER_SUBTLE,
    },
    title: { color: Tokens.default.colors.TEXT_STRONG, fontSize: 16, fontWeight: "600" },
    detail: { color: Tokens.default.colors.TEXT_MUTED, fontSize: 13 },
    tile: {
        width: 96,
        height: 72,
        marginRight: 8,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: Tokens.default.colors.BACKGROUND_MOD_NORMAL,
    },
    tileText: { color: Tokens.default.colors.TEXT_DEFAULT, fontSize: 18, fontWeight: "600" },
    button: {
        minHeight: 44,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: Tokens.default.colors.BACKGROUND_MOD_STRONG,
    },
    buttonText: { color: Tokens.default.colors.TEXT_STRONG, fontSize: 15, fontWeight: "600" },
}));

function DemoIsland({ islandKey, width, measuring }: IslandProps<null>) {
    const styles = useStyles()();
    const [count, setCount] = useIslandState(islandKey, "count", 0);
    const visible = useIslandVisible(islandKey);
    return (
        <View style={styles.card}>
            <Text style={styles.title}>Chat Islands works</Text>
            <Text style={styles.detail}>
                {`${width} dp wide · ${measuring ? "measuring" : visible ? "on screen" : "off screen"}`}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={104} decelerationRate="fast">
                {TILES.map(n => (
                    <View key={n} style={styles.tile}>
                        <Text style={styles.tileText}>{n}</Text>
                    </View>
                ))}
            </ScrollView>
            <Pressable style={styles.button} accessibilityRole="button" onPress={() => setCount(n => n + 1)}>
                <Text style={styles.buttonText}>{count ? `Tapped ${count} times` : "Tap me"}</Text>
            </Pressable>
        </View>
    );
}

export const demoProvider: IslandProvider<null> = {
    id: "chat-islands-test",
    match: m => (m.content.includes(DEMO_TRIGGER) ? [{ id: "test", replacesEmbed: null, data: null }] : null),
    component: DemoIsland,
};
