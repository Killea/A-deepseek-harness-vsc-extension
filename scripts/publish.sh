#!/usr/bin/env bash
# Build, auto-bump patch version, package VSIX, update README with a
# raw.githubusercontent.com download link, then git add + commit everything
# so the VSIX is directly downloadable from the repo's main branch.
#
# Prerequisites:
#   - git repo with push access to origin/main
#   - pnpm, vsce
#
# Usage:
#   ./scripts/publish.sh                # bump patch, build, commit VSIX + README + package.json (default)
#   ./scripts/publish.sh --no-bump      # keep current version, build, commit
#   ./scripts/publish.sh --bump minor   # bump minor version instead of patch
#   ./scripts/publish.sh --bump major   # bump major version instead of patch
#   ./scripts/publish.sh --push         # also git push to origin after commit

set -euo pipefail

cd "$(dirname "$0")/.."

PUBLISHER="AgentChatBus"
EXT_ID="deepseek-gold-harness"
BUMP="patch"
DO_BUMP=true
DO_PUSH=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-bump) DO_BUMP=false; shift ;;
    --bump)    BUMP="$2"; shift 2 ;;
    --push)    DO_PUSH=true; shift ;;
    *)         echo "Unknown option: $1"; exit 1 ;;
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

# --- Step 3: Remove old VSIX files (keep only the latest) -----------------
echo "==> Cleaning old VSIX files..."
OLD_VSIXES=$(git ls-files '*.vsix' | grep -v "^${VSIX}$" || true)
if [[ -n "$OLD_VSIXES" ]]; then
  echo "$OLD_VSIXES" | xargs -r git rm --quiet
  echo "$OLD_VSIXES" | xargs -r rm -f
  echo "    Removed: $(echo "$OLD_VSIXES" | tr '\n' ' ')"
fi

# --- Step 4: Update README with raw download link --------------------------
echo "==> Updating README with version ${VERSION}..."
README="README.md"
BRANCH="main"
RAW_URL="https://raw.githubusercontent.com/Killea/A-deepseek-harness-vsc-extension/${BRANCH}/${VSIX}"

if ! grep -q '<!-- LATEST-RELEASE -->' "$README"; then
  python3 -c "
content = open('$README', 'r').read()
block = '''<!-- LATEST-RELEASE -->
> **Latest build: v${VERSION}** — [Download VSIX](${RAW_URL})
<!-- /LATEST-RELEASE -->'''
lines = content.split('\n')
for i, line in enumerate(lines):
    if line.startswith('# '):
        lines.insert(i + 1, '')
        lines.insert(i + 2, block)
        break
open('$README', 'w').write('\n'.join(lines))
"
else
  python3 -c "
import re
content = open('$README', 'r').read()
pattern = r'<!-- LATEST-RELEASE -->.*?<!-- /LATEST-RELEASE -->'
replacement = '''<!-- LATEST-RELEASE -->
> **Latest build: v${VERSION}** — [Download VSIX](${RAW_URL})
<!-- /LATEST-RELEASE -->'''
new_content = re.sub(pattern, replacement, content, flags=re.DOTALL)
open('$README', 'w').write(new_content)
"
fi
echo "    README updated: v${VERSION} → ${RAW_URL}"

# --- Step 5: Git add + commit ---------------------------------------------
echo "==> Git commit..."
git add package.json README.md "$VSIX"
git commit -m "chore: release v${VERSION}

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>"
echo "    Committed: v${VERSION}"

# --- Step 6: Push (optional) ----------------------------------------------
if $DO_PUSH; then
  echo "==> Pushing to origin..."
  git push origin HEAD
  echo "    Pushed: v${VERSION}"
  echo ""
  echo "    Download URL: ${RAW_URL}"
else
  echo "==> Done (local commit): v${VERSION}"
  echo "    To push: ./scripts/publish.sh --push  (or: git push origin HEAD)"
  echo "    Download URL (after push): ${RAW_URL}"
fi

echo "==> All done: v${VERSION}"
