#!/usr/bin/env bash
# Build, auto-bump patch version, package VSIX, update README with the latest
# version + download link, and optionally publish to GitHub Releases.
#
# Prerequisites:
#   - gh CLI authenticated:  gh auth status   (only needed for --publish)
#
# Usage:
#   ./scripts/publish.sh                # bump patch, build, package VSIX, update README (default)
#   ./scripts/publish.sh --no-bump      # keep current version, build, package, update README
#   ./scripts/publish.sh --bump minor   # bump minor version instead of patch
#   ./scripts/publish.sh --bump major   # bump major version instead of patch
#   ./scripts/publish.sh --publish      # also publish to GitHub Releases
#   ./scripts/publish.sh --git-commit   # git add + commit the version bump and README update

set -euo pipefail

cd "$(dirname "$0")/.."

PUBLISHER="AgentChatBus"
EXT_ID="deepseek-gold-harness"
BUMP="patch"
DO_BUMP=true
DO_PUBLISH=false
DO_GIT_COMMIT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-bump)    DO_BUMP=false; shift ;;
    --bump)       BUMP="$2"; shift 2 ;;
    --publish)    DO_PUBLISH=true; shift ;;
    --git-commit) DO_GIT_COMMIT=true; shift ;;
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

# --- Step 3: Update README with latest version + download link -------------
echo "==> Updating README with version ${VERSION}..."
README="README.md"
REPO_URL="https://github.com/Killea/A-deepseek-harness-vsc-extension"
DOWNLOAD_URL="${REPO_URL}/releases/download/v${VERSION}/${VSIX}"

# The badge block sits between the first <img> line and the first ## heading.
# We replace everything from the <!-- LATEST-RELEASE --> marker (or insert one)
# up to the next blank line.
if ! grep -q '<!-- LATEST-RELEASE -->' "$README"; then
  # Insert the marker block right after the title line (first # heading).
  # The title line is the first line starting with "# ".
  python3 -c "
import re, sys
content = open('$README', 'r').read()
block = '''<!-- LATEST-RELEASE -->
> **Latest build: v${VERSION}** — [Download VSIX](${DOWNLOAD_URL})
<!-- /LATEST-RELEASE -->'''
# Insert after the first '# ' heading line
lines = content.split('\n')
for i, line in enumerate(lines):
    if line.startswith('# '):
        lines.insert(i + 1, '')
        lines.insert(i + 2, block)
        break
open('$README', 'w').write('\n'.join(lines))
"
else
  # Replace the existing marker block
  python3 -c "
import re
content = open('$README', 'r').read()
pattern = r'<!-- LATEST-RELEASE -->.*?<!-- /LATEST-RELEASE -->'
replacement = '''<!-- LATEST-RELEASE -->
> **Latest build: v${VERSION}** — [Download VSIX](${DOWNLOAD_URL})
<!-- /LATEST-RELEASE -->'''
new_content = re.sub(pattern, replacement, content, flags=re.DOTALL)
open('$README', 'w').write(new_content)
"
fi
echo "    README updated: v${VERSION} → ${DOWNLOAD_URL}"

# --- Step 4: Git commit (optional) ----------------------------------------
if $DO_GIT_COMMIT; then
  echo "==> Git commit..."
  git add package.json README.md "$VSIX"
  git commit -m "chore: release v${VERSION}"
  echo "    Committed: v${VERSION}"
fi

# --- Step 5: Publish to GitHub Releases (optional) ------------------------
if ! $DO_PUBLISH; then
  echo "==> Done (dry run): ${VSIX}"
  echo "    To publish: ./scripts/publish.sh --publish"
  exit 0
fi

echo "==> Publishing to GitHub Releases..."
if ! gh release create "v${VERSION}" "$VSIX" \
  --title "v${VERSION}" \
  --notes "DeepSeek Gold Harness v${VERSION}

Download the VSIX below and install with:
\`\`\`bash
code --install-extension ${VSIX}
\`\`\`"; then
  echo "ERROR: gh release create failed (is gh authenticated?)"
  exit 1
fi
echo "    GitHub Release: v${VERSION} published"

echo "==> All done: v${VERSION}"
