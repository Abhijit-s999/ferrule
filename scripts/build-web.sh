#!/usr/bin/env bash
# Assemble the web version into site/, ready for GitHub Pages.
#
# The web build is the desktop frontend (ferrule/static) plus an in-page
# backend (web/) and SQLite compiled to WebAssembly. No bundler: the files
# are copied as they are, the same way the desktop app serves them.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f node_modules/sql.js/dist/sql-wasm.wasm ] || {
  echo "sql.js is missing; run npm install first" >&2; exit 1; }

rm -rf site
mkdir -p site/lib site/vendor
cp web/index.html web/main.js site/
cp web/lib/*.js site/lib/
cp ferrule/static/app.js ferrule/static/charts.js ferrule/static/style.css site/
cp node_modules/sql.js/dist/sql-wasm.js node_modules/sql.js/dist/sql-wasm.wasm site/vendor/
cp desktop/icon.svg desktop/icon-256.png site/
cp LICENSE ATTRIBUTION.md site/
# Serve files as they are rather than through Jekyll.
touch site/.nojekyll

echo "site/ ready: $(find site -type f | wc -l) files, $(du -sh site | cut -f1)"
