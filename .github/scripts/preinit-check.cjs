// Evaluates a built Valenced plugin like Valenced's createOptionsFactory does at
// the pre-init stage of app boot: Discord APIs throw (the index module isn't
// initialized yet) and React / React Native / the JSX runtime aren't loaded.
// A plugin whose script throws there is turned off by Valenced after every
// restart, and stays broken until it's reinstalled. See
// valenced/gif-picker-optimizer/js/lazy.ts.
// Usage: node preinit-check.cjs <built index.js>
const fs = require("fs");
const script = fs.readFileSync(process.argv[2], "utf8");

const reads = [];
function guarded(name) {
    return new Proxy({}, {
        get(_, key) {
            reads.push(`${name}.${String(key)}`);
            throw new Error(`Cannot access ${name} API before the init phase`);
        },
    });
}

const valenced = {
    react: { React: undefined, ReactNative: undefined, ReactJSXRuntime: undefined },
    jsonStorage: {
        getJsonStorage: () => ({ get: async () => undefined, set: async () => { } }),
        pluginStoragePathFor: (id, f) => `${id}/${f}`,
    },
    patcher: { instead: () => () => { } },
    get discord() {
        return {
            get design() { return guarded("Discord.design"); },
            get actions() { return guarded("Discord.actions"); },
            get flux() { return guarded("Discord.flux"); },
            common: { get tokens() { return guarded("Discord.common.tokens"); } },
            utils: { modules: { finders: guarded("Discord.utils.modules.finders") } },
        };
    },
    modules: { finders: guarded("modules.finders") },
    externals: guarded("externals"),
    components: guarded("Components"),
};

try {
    const opts = new Function("valenced", "plugin", `return ${script}`)(valenced, o => o)?.default;
    if (typeof opts !== "object" || opts === null) throw new Error("Plugin options must be an object");
    for (const key of ["preInit", "init", "start", "stop"]) {
        if (opts[key] !== undefined && typeof opts[key] !== "function") throw new Error(`${key} must be a function`);
    }
    console.log(`OK at pre-init: options ${Object.keys(opts).join(", ")}`);
} catch (e) {
    console.log(`FAILS at pre-init: ${e.message}`);
    if (reads.length) console.log(`  read: ${[...new Set(reads)].join(", ")}`);
    process.exitCode = 1;
}
