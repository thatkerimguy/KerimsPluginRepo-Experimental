#!/usr/bin/env bash
# Sets up the Valenced plugin template in $1 (default: template), with every Valenced
# dependency pinned. The template has no lockfile, so a plain `bun install` would
# take the plugin CLI and types from their default branches, and a change there
# could break or change a build without any change here. Bump the commits below
# on purpose (and check a build) to update.
#
# Needs git, bun and Node 22.18 or newer (the CLI runs its TypeScript source).
set -euo pipefail

TEMPLATE_REF=9a4f9187137a75d86fe552d0e594889a6e6fd7e5   # valenced-plugin-template
CLI_REF=9ea9f9bfc91319e2b18c6b1c9ac0b993f8600c1d        # valenced-plugin-cli, 2026-10-29
TYPES_REF=c67dd726d1ec28b38d8ac93862fdd3b6029b1d29      # valenced-types, 2026-10-31
THEMES_REF=f329610cc80004417564c8058249b957631b32b0     # valenced-themes-types, 2026-10-24

dest="${1:-template}"

checkout() { # repo dir ref
    git init -q "$2"
    git -C "$2" fetch -q --depth 1 "https://github.com/Valenced/$1.git" "$3"
    git -C "$2" checkout -q FETCH_HEAD
}

checkout valenced-plugin-template "$dest" "$TEMPLATE_REF"
deps="$(cd "$dest" && pwd)/.valenced-deps"
checkout valenced-types "$deps/types" "$TYPES_REF"
checkout valenced-themes-types "$deps/themes-types" "$THEMES_REF"
checkout valenced-plugin-cli "$deps/plugin-cli" "$CLI_REF"

# Point every git dependency on a Valenced repo at the pinned checkouts
for pkg in "$dest/package.json" "$deps/plugin-cli/package.json" "$deps/themes-types/package.json"; do
    sed -i \
        -e "s#git+https://github.com/Valenced/valenced-plugin-cli.git#file:$deps/plugin-cli#" \
        -e "s#git+https://github.com/Valenced/valenced-types.git#file:$deps/types#" \
        -e "s#git+https://github.com/Valenced/valenced-themes-types.git#file:$deps/themes-types#" \
        "$pkg"
done
if grep -q "github.com/Valenced" "$dest/package.json" "$deps"/*/package.json; then
    echo "::error::an unpinned Valenced dependency is left" >&2
    exit 1
fi

# Only our plugins get built
find "$dest/plugins" "$dest/themes" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

(cd "$deps/plugin-cli" && bun install)
(cd "$dest" && bun install)
# bun copies a file: dependency without its own node_modules: link the CLI instead
rm -rf "$dest/node_modules/@valenced/plugin-cli"
ln -s "$deps/plugin-cli" "$dest/node_modules/@valenced/plugin-cli"
