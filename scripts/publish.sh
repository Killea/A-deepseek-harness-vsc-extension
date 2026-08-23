#!/usr/bin/env bash
# Build, auto-bump patch version, package VSIX, and optionally publish.
#
# Prerequisites:
#   - vsce logged in:  vsce login Killea   (only needed for --publish)
#   - ovsx logged in:  ovsx login Killea   (only needed for --publish --ovsx)
#
# Usage:
#   ./scripts/publish.sh                # bump patch, build, package VSIX (default)
#   ./scripts/publish.sh --no-bump      # keep current version, build, package
#   ./scripts/publish.sh --bump minor   # bump minor version instead of patch
#   ./scripts/publish.sh --bump major   # bump major version instead of patch
#   ./scripts/publish.sh --publish      # also publish to VS Code Marketplace
#   ./scripts/publish.sh --publish --ovsx  # also publish to Open VSX
#   ./scripts/publish.sh --publish --vsce  # publish to VS Code Marketplace only

set -euo pipefail

cd "$(dirname "$0")/.."

PUBLISHER="Killea"
EXT_ID="deepseek-gold-harness"
BUMP="patch"
DO_BUMP=true
DO_PUBLISH=false
DO_VSCE=true
DO_OVSX=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-bump)    DO_BUMP=false; shift ;;
    --bump)       BUMP="$2"; shift 2 ;;
    --publish)    DO_PUBLISH=true; shift ;;
    --vsce)       DO_OVSX=false; shift ;;
    --ovsx)       DO_VSCE=false; DO_OVSX=true; shift ;;
    *)            echo "Unknown option: $1"; exit 1 ;;
  esac
done

# --- Step 0: Bump version -------------------------------------------------
if $DO_BUMP; then
  OLD_VERSION=$(node -p "require('./package.json').version")
  case "$BUMP" in
    patch|minor|major) ;;
    *) echo "ERROR: --bump must be patch|minor|major, got '$BUMP'"; exit 1 ;;
  esac
  npm version "$BUMP" --no-git-tag-version --silent
  VERSION=$(node -p "require('./package.json').version")
  echo "==> Version: ${OLD_VERSION} -> ${VERSION}"
else
  VERSION=$(node -p "require('./package.json').version")
  echo "==> Version: ${VERSION} (no bump)"
fi

VSIX="${EXT_ID}-${VERSION}.vsix"
echo "==> Extension: ${PUBLISHER}.${EXT_ID} v${VERSION}"
echo "==> VSIX: ${VSIX}"

# --- Step 1: Build --------------------------------------------------------
echo "==> Building..."
pnpm run build

# --- Step 2: Package ------------------------------------------------------
echo "==> Packaging..."
npx vsce package --no-dependencies
if [[ ! -f "$VSIX" ]]; then
  echo "ERROR: ${VSIX} not found after packaging"
  exit 1
fi
echo "==> Packaged: ${VSIX}"

# --- Step 3: Publish (optional) -------------------------------------------
if ! $DO_PUBLISH; then
  echo "==> Done (dry run): ${VSIX}"
  echo "    To publish: ./scripts/publish.sh --publish"
  exit 0
fi

if $DO_VSCE; then
  echo "==> Publishing to VS Code Marketplace..."
  npx vsce publish --no-dependencies
  echo "    VS Code Marketplace: done"
fi

if $DO_OVSX; then
  echo "==> Publishing to Open VSX Registry..."
  ovsx publish "$VSIX"
  echo "    Open VSX: done"
fi

echo "==> All done: v${VERSION}"
