/*
 * Vencord fills `@webpack/common` exports (React hooks, stores, RestAPI, ...) in
 * with `waitFor` once Discord's modules load, after plugins are evaluated. A value
 * read at module level is still undefined then, and the plugin breaks silently (the
 * first shared tile loader copied the hooks into a module-level object: every tile
 * fell back to Discord's own). This finds such reads in the Vencord build.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import ts from "typescript";

const DIR = join(import.meta.dirname, "..", "..", "vencord", "gifPickerOptimizer");

/** `file:line name` for each module-level read of an `@webpack/common` value in `source` */
export function moduleLevelReads(file: string, source: string): string[] {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const names = new Set<string>();
    for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || (st.moduleSpecifier as ts.StringLiteral).text !== "@webpack/common") continue;
        const clause = st.importClause;
        if (!clause || clause.isTypeOnly) continue;
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
            for (const el of bindings.elements) if (!el.isTypeOnly) names.add(el.name.text);
        } else if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
    }
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
        // Code in functions runs later (render / call time), and types are erased
        if (ts.isFunctionLike(node) || ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return;
        if (ts.isClassLike(node)) {
            // Only static field initializers run when the module is evaluated
            for (const m of node.members) if (ts.isPropertyDeclaration(m) && m.initializer && m.modifiers?.some(x => x.kind === ts.SyntaxKind.StaticKeyword)) visit(m.initializer);
            return;
        }
        if (ts.isIdentifier(node) && names.has(node.text)) {
            const p = node.parent;
            const isMemberName = (ts.isPropertyAccessExpression(p) && p.name === node) || (ts.isPropertyAssignment(p) && p.name === node);
            if (!isMemberName) found.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${node.text}`);
        }
        ts.forEachChild(node, visit);
    };
    for (const st of sf.statements) if (!ts.isImportDeclaration(st)) visit(st);
    return found;
}

test("no @webpack/common value is read at module level", () => {
    const files = readdirSync(DIR).filter(f => /\.tsx?$/.test(f));
    assert.ok(files.length > 5);
    const reads = files.flatMap(f => moduleLevelReads(f, readFileSync(join(DIR, f), "utf8")));
    assert.deepEqual(reads, [], "read these at render / call time instead");
});

test("the check finds the reads it's meant to", () => {
    const src = `import { useState, useEffect, React } from "@webpack/common";
import type { X } from "@webpack/common";
const hooks = { useState, useEffect };
const r = React.version;
export const fine = () => useState(0);
function alsoFine() { return useEffect; }
class C { static s = useState; m() { return useState; } }
const obj = { useState: 1 };
type T = typeof useState;`;
    assert.deepEqual(moduleLevelReads("x.ts", src), ["x.ts:3 useState", "x.ts:3 useEffect", "x.ts:4 React", "x.ts:7 useState"]);
});
