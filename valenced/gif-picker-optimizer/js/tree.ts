import type { ReactElement } from "react";
import { isValidElement } from "react";

/** A step from a node to one of its children: an array index, or an element's `children` prop */
type Step = number | "children";

/** Props of an element whose children the tree functions look into */
interface WithChildren {
    children?: unknown;
}

function childrenOf(node: unknown): unknown {
    return isValidElement(node) ? (node.props as WithChildren | null)?.children : undefined;
}

/**
 * The path to the first node matching `pred` in a React element tree (depth
 * first, like render order), or null when there is none.
 */
export function findInTree<T>(node: unknown, pred: (n: unknown) => n is T): Step[] | null {
    if (pred(node)) return [];
    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
            const path = findInTree(node[i], pred);
            if (path) return [i, ...path];
        }
        return null;
    }
    const children = childrenOf(node);
    if (children == null) return null;
    const path = findInTree(children, pred);
    return path && ["children", ...path];
}

/**
 * Replaces the node at `path` (from `findInTree`). Only the elements and arrays on
 * the path are copied; everything else is shared with the original tree.
 */
export function replaceAt<T>(node: unknown, path: Step[], replace: (n: T) => unknown): unknown {
    if (!path.length) return replace(node as T);
    const [step, ...rest] = path;
    if (step === "children") {
        const el = node as ReactElement<WithChildren>;
        return { ...el, props: { ...el.props, children: replaceAt(el.props.children, rest, replace) } };
    }
    const copy = (node as unknown[]).slice();
    copy[step] = replaceAt(copy[step], rest, replace);
    return copy;
}

/**
 * Replaces the first node matching `pred` anywhere in a React element tree.
 * Returns the new tree and whether a node was replaced.
 */
export function replaceInTree<T>(node: unknown, pred: (n: unknown) => n is T, replace: (n: T) => unknown): [unknown, boolean] {
    const path = findInTree(node, pred);
    return path ? [replaceAt(node, path, replace), true] : [node, false];
}
