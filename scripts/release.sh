#!/bin/bash
set -e

VERSION=$(node -p "require('./package.json').version")
PACKAGE_NAME=$(node -p "require('./package.json').name")

case "${1:-npm}" in
  npm)
    ;;
  *)
    echo "Usage: $0 [npm]"
    exit 1
    ;;
esac

echo "========================================="
echo "Publish ${PACKAGE_NAME}@${VERSION}"
echo "========================================="

if ! npm whoami &>/dev/null; then
  echo "Error: not logged in to npm. Run: npm login"
  exit 1
fi

echo "Building package..."
pnpm build

echo "Checking package contents..."
npm pack --dry-run

echo "Publishing to npm..."
npm publish

echo ""
echo "✅ Publish successful"
echo "   Package: ${PACKAGE_NAME}@${VERSION}"
