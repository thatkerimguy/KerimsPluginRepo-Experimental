// Copies Social Embeds' shared core (platform-free TypeScript) from the Valenced
// build, its source of truth, to the Vencord build. Separate from GIFs+'s
// sync-shared.mjs: the two plugins share nothing.
//
//   node .github/scripts/sync-social-core.mjs          copy valenced/social-embeds/js/core -> vencord/socialEmbeds/core
//   node .github/scripts/sync-social-core.mjs --check  fail if they differ (CI)
//
// Until the desktop plugin exists (phase 5, SOCIAL_EMBEDS_PLAN.md) there is nothing to sync or check.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const from = join(root, "valenced", "social-embeds", "js", "core");
const desktopPlugin = join(root, "vencord", "socialEmbeds");
const to = join(desktopPlugin, "core");
const check = process.argv.includes("--check");

if (!existsSync(join(desktopPlugin, "index.tsx"))) {
    console.log("No desktop Social Embeds plugin yet: nothing to sync.");
    process.exit(0);
}

const files = dir => existsSync(dir)
    ? readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : [path];
    })
    : [];

const source = new Map(files(from).map(f => [relative(from, f), readFileSync(f)]));
const target = new Map(files(to).map(f => [relative(to, f), readFileSync(f)]));

const differ = [
    ...[...source].filter(([rel, data]) => !target.get(rel)?.equals(data)).map(([rel]) => rel),
    ...[...target.keys()].filter(rel => !source.has(rel)),
];

if (check) {
    if (differ.length) {
        console.error(`Social Embeds core differs between the builds: ${differ.join(", ")}`);
        console.error("Edit valenced/social-embeds/js/core and run: node .github/scripts/sync-social-core.mjs");
        process.exit(1);
    }
    console.log(`Social Embeds core in sync (${source.size} files).`);
} else {
    rmSync(to, { recursive: true, force: true });
    for (const [rel, data] of source) {
        mkdirSync(dirname(join(to, rel)), { recursive: true });
        writeFileSync(join(to, rel), data);
    }
    console.log(`Copied ${source.size} files to ${relative(root, to)}.`);
}
