#!/bin/bash
# Build script with explicit memory allocation

cd "$(dirname "$0")"

echo "Building GUI with increased memory allocation..."
NODE_OPTIONS="--max-old-space-size=4096" npm run build

if [ $? -eq 0 ]; then
  echo "GUI build completed successfully"
  exit 0
else
  echo "GUI build failed"
  exit 1
fi
