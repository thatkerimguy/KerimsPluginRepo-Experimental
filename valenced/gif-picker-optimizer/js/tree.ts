import { isValidElement } from "react";

/**
 * Replaces the first node matching `pred` anywhere in a React element tree.
 * Returns the new tree and whether a node was replaced. Elements on the path
 * are copied, the rest is shared.
 */
export function replaceInTree(node: any, pred: (n: any) => boolean, replace: (n: any) => any): [any, boolean] {
    if (pred(node)) return [replace(node), true];
    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
            const [res, hit] = replaceInTree(node[i], pred, replace);
            if (hit) {
                const copy = node.slice();
                copy[i] = res;
                return [copy, true];
            }
        }
        return [node, false];
    }
    if (isValidElement(node) && (node.props as any)?.children != null) {
        const [children, hit] = replaceInTree((node.props as any).children, pred, replace);
        if (hit) return [{ ...node, props: { ...(node.props as any), children } }, true];
    }
    return [node, false];
}
