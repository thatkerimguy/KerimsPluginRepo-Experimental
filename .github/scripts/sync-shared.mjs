// Copies the files both builds share from the Vencord folder to the Valenced one.
// Edit the shared files in vencord/gifPickerOptimizer, then run this (any OS):
//
//   node .github/scripts/sync-shared.mjs            copy Vencord -> Valenced
//   node .github/scripts/sync-shared.mjs --from-valenced   copy Valenced -> Vencord
//   node .github/scripts/sync-shared.mjs --check    fail if they differ (CI)
//
// This list is the only place that says which files are shared.
import { copyFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SHARED = [
    "cache.ts",
    "diagnostics.ts",
    "klipy.ts",
    "lowres.ts",
    "persist.ts",
    "queue.ts",
    "saved.ts",
    "settingsText.ts",
    "tileLoader.ts",
    "tracking.ts",
    "transfer.ts",
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const desktop = join(root, "vencord", "gifPickerOptimizer");
const mobile = join(root, "valenced", "gif-picker-optimizer", "js");

const args = process.argv.slice(2);
const check = args.includes("--check");
const [from, to] = args.includes("--from-valenced") ? [mobile, desktop] : [desktop, mobile];

const read = path => {
    try {
        return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
    } catch {
        return null;
    }
};

let differ = 0;
for (const file of SHARED) {
    const source = read(join(from, file));
    if (source == null) {
        console.error(`missing: ${join(from, file)}`);
        process.exitCode = 1;
        continue;
    }
    if (source === read(join(to, file))) continue;
    differ++;
    if (check) {
        console.error(`::error file=valenced/gif-picker-optimizer/js/${file}::${file} differs between the Vencord and Valenced builds. Run node .github/scripts/sync-shared.mjs`);
        process.exitCode = 1;
    } else {
        copyFileSync(join(from, file), join(to, file));
        console.log(`copied ${file}`);
    }
}
if (!differ) console.log(`${SHARED.length} shared files in sync`);
