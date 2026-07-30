#!/usr/bin/env bash
# Bun resolves imports relative to each workspace package directory.
# After install, point every workspace package's node_modules at the root
# install so deps like hono / postgres / drizzle-orm always resolve.
set -euo pipefail

ROOT="${1:-/app}"
cd "$ROOT"

if [ ! -d "$ROOT/node_modules" ]; then
  echo "error: $ROOT/node_modules missing — run bun install first" >&2
  exit 1
fi

link_pkg() {
  local dir="$1"
  [ -f "$dir/package.json" ] || return 0
  rm -rf "$dir/node_modules"
  ln -sfn "$ROOT/node_modules" "$dir/node_modules"
  echo "linked $dir/node_modules -> $ROOT/node_modules"
}

# packages/*
for d in "$ROOT"/packages/*; do
  [ -d "$d" ] && link_pkg "$d"
done

# apps/*
for d in "$ROOT"/apps/*; do
  [ -d "$d" ] && link_pkg "$d"
done

# Sanity checks for runtime deps we hit in production images
for dep in hono postgres drizzle-orm; do
  if [ ! -e "$ROOT/node_modules/$dep" ] && [ ! -e "$ROOT/node_modules/@types/$dep" ]; then
    # allow missing optional ones per image — warn only
    echo "note: root node_modules/$dep not present (ok if unused in this image)"
  fi
done

echo "workspace node_modules links ready"
