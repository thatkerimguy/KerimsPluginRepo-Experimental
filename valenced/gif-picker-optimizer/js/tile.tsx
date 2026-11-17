/** @jsxRuntime classic */
/** @jsx valenced.react.React.createElement */
/** @jsxFrag valenced.react.React.Fragment */
/*
 * The GIF tile. Discord's own tile is always rendered (it uses hooks), and its
 * Image is swapped for a placeholder while the tile waits for its turn, or for
 * the preview once it may load. The loading indicator is in indicator.tsx.
 */

import type { ReactElement, ReactNode } from "react";
import * as React from "react";
import { isValidElement } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet, View } from "react-native";

import { patchWorks } from "./diagnostics";
import { Indicator } from "./indicator";
import { type GifItem, isFavoriteItem } from "./items";
import { lazy } from "./lazy";
import { isKlipyUrl, normalizeUrl } from "./lowres";
import { isNativeCached } from "./nativeCache";
import { lookupFor, pickSrc } from "./previews";
import { useSettings } from "./settingsStore";
import { tileEnv } from "./state";
import { useTileLoader } from "./tileLoader";
import { findInTree, replaceAt } from "./tree";
import { useVisibleIndex } from "./viewport";

/** What the plugin reads from and sets on the Image in Discord's tile */
interface ImageProps {
    source?: { uri?: string; [k: string]: unknown; };
    style?: StyleProp<ViewStyle>;
    onLoad?(...args: unknown[]): void;
    onError?(...args: unknown[]): void;
    onProgress?(e: unknown): void;
}
type ImageElement = ReactElement<ImageProps>;

/** RN's onProgress event: `{ nativeEvent: { loaded, total } }` (or the values directly) */
interface ProgressEvent {
    loaded?: number;
    total?: number;
    nativeEvent?: { loaded?: number; total?: number; };
}

export interface ItemProps {
    item: GifItem;
    index: number;
    height: number;
    selected?: boolean;
    onPressGIF(item: GifItem, index: number): void;
}

export function GifTile({ props, render }: { props: ItemProps; render: (p: ItemProps) => ReactNode; }) {
    const { item, index } = props;
    const { loadTimeout, showProgress, stillFavorites } = useSettings();

    // Discord's own tile. Always rendered (it uses hooks) and with the original item,
    // so tapping sends and long-press favourites the full resolution GIF.
    const tree = render(props);
    const still = stillFavorites && isFavoriteItem(item);

    const original = normalizeUrl(item.src);
    const isImage = (n: unknown): n is ImageElement =>
        isValidElement(n) && normalizeUrl((n.props as ImageProps | null)?.source?.uri ?? "") === original;
    // Found once per render; the swap below only walks this path. No Image (unknown tree
    // shape): leave Discord's tile alone and don't hold up the queue.
    const imagePath = findInTree(tree, isImage);
    const hasImage = imagePath != null;

    // Tiles that scroll away are unmounted (and recycled) by Discord's FlashList
    const { phase, chosen, seenBefore, progress, attempt, gaveUp, setVisible, done, error, reportProgress } = useTileLoader(
        // React itself, not `{ useState, ... }`: the build rewrites React names even as object keys
        React,
        tileEnv,
        {
            original,
            index,
            still,
            enabled: hasImage,
            loadTimeout,
            initiallyVisible: true,
            // Klipy search results get their small version with the results page
            waitsForLowRes: !isFavoriteItem(item) && isKlipyUrl(item.src),
            pick: () => pickSrc(item, still),
            lookup: () => lookupFor(item),
            probeCache: isNativeCached,
            stallFallback: true,
        },
    );
    useVisibleIndex(index, setVisible);
    if (!imagePath) return tree;
    patchWorks("tiles");

    return replaceAt<ImageElement>(tree, imagePath, img => {
        const imgProps = img.props;

        // One Indicator at the same place in the frame from queued to loaded, so it animates between states.
        // It's drawn under the image, on the frame's background: the image covers it natively the moment
        // it's drawn, instead of the spinner staying until onLoad reaches JS and the tile re-renders.
        const indicatorState = !showProgress ? null
            : gaveUp ? "failed"
            : phase === "done" ? null
            : seenBefore ? "seen"
            : phase === "queued" ? "queued"
            : "loading";
        const indicator = indicatorState && <Indicator state={indicatorState} progress={phase === "loading" ? progress : null} />;

        // Waiting for its turn or being looked up: an empty frame, no image in memory
        if (phase === "queued" || phase === "lookingUp") {
            return (
                <View style={[imgProps.style, styles().frame]}>
                    {indicator}
                    {null}
                </View>
            );
        }

        const shown = chosen ?? original;
        const image = {
            ...img,
            // A retry of the same URL is a new element, so it loads again
            key: `${attempt}:${shown}`,
            props: {
                ...imgProps,
                source: { ...imgProps.source, uri: shown },
                style: [imgProps.style, styles().fill],
                onLoad: (...a: unknown[]) => {
                    imgProps.onLoad?.(...a);
                    done();
                },
                onError: (...a: unknown[]) => {
                    imgProps.onError?.(...a);
                    // Also when shown from cache ("done"): the URL may not load any more
                    if (phase === "loading" || phase === "done") error();
                },
                onProgress: (e: unknown) => {
                    imgProps.onProgress?.(e);
                    const ev = (e as ProgressEvent | null)?.nativeEvent ?? (e as ProgressEvent | null);
                    if (phase === "loading") reportProgress(ev?.loaded ?? 0, ev?.total ?? 0);
                },
            },
        };

        return (
            <View style={[imgProps.style, styles().frame]}>
                {indicator}
                {image}
            </View>
        );
    }) as ReactNode;
}

const styles = lazy(() => StyleSheet.create({
    frame: {
        overflow: "hidden",
    },
    /** The image covers the frame. Transparent until drawn, so the indicator under it shows (the frame has Discord's background). */
    fill: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "transparent",
    },
}));
