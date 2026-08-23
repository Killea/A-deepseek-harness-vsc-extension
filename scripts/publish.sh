#!/usr/bin/env bash
# Publish the extension to VS Code Marketplace and Open VSX Registry.
#
# Prerequisites:
#   - vsce logged in:  vsce login Killea
#   - ovsx logged in:  ovsx login Killea
#
# Usage:
#   ./scripts/publish.sh              # publish current version to both
#   ./scripts/publish.sh --vsce       # VS Code Marketplace only
#   ./scripts/publish.sh --ovsx       # Open VSX only
#   ./scripts/publish.sh --dry-run    # package only, no publish

set -euo pipefail

cd "$(dirname "$0")/.."

PUBLISHER="Killea"
EXT_ID="deepseek-gold-harness"
TARGET=""
DRY_RUN=false
DO_VSCE=true
DO_OVSX=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --vsce)    DO_OVSX=false; shift ;;
    --ovsx)    DO_VSCE=false; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    *)         TARGET="$1"; shift ;;
  esac
done

VERSION=$(node -p "require('./package.json').version")
VSIX="${EXT_ID}-${VERSION}.vsix"

echo "==> Extension: ${PUBLISHER}.${EXT_ID} v${VERSION}"
echo "==> VSIX: ${VSIX}"

# Step 1: Build
echo "==> Building..."
pnpm run build

# Step 2: Package
echo "==> Packaging..."
npx vsce package --no-dependencies
if [[ ! -f "$VSIX" ]]; then
  echo "ERROR: ${VSIX} not found after packaging"
  exit 1
fi

if $DRY_RUN; then
  echo "==> Dry run complete: ${VSIX}"
  exit 0
fi

# Step 3: Publish to VS Code Marketplace
if $DO_VSCE; then
  echo "==> Publishing to VS Code Marketplace..."
  npx vsce publish --no-dependencies
  echo "    VS Code Marketplace: done"
fi

# Step 4: Publish to Open VSX
if $DO_OVSX; then
  echo "==> Publishing to Open VSX Registry..."
  ovsx publish "$VSIX"
  echo "    Open VSX: done"
fi

echo "==> All done: v${VERSION}"
