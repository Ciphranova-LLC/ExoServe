#!/bin/bash

# Stop execution if any command fails
set -e

RELEASE_DIR="release"

echo "Building production release in './$RELEASE_DIR'..."

# Clean up any previous build
rm -rf $RELEASE_DIR
mkdir -p $RELEASE_DIR

# Copy the backend and unminified frontend into the release folder
echo "Copying files..."
cp exoserve.py $RELEASE_DIR/
cp -r src/ $RELEASE_DIR/
cp -r templates/ $RELEASE_DIR/
cp -r static/ $RELEASE_DIR/

# Minify JavaScript
echo "Minifying JavaScript..."
for js_file in $RELEASE_DIR/static/js/*.js; do
    esbuild "$js_file" --minify --allow-overwrite --log-level=warning --outfile="$js_file"
done

# Minify the Service Worker
if [ -f "$RELEASE_DIR/static/sw.js" ]; then
    esbuild "$RELEASE_DIR/static/sw.js" --minify --allow-overwrite --log-level=warning --outfile="$RELEASE_DIR/static/sw.js"
fi

# Minify CSS
echo "Minifying CSS..."
for css_file in $RELEASE_DIR/static/css/*.css; do
    esbuild "$css_file" --minify --allow-overwrite --log-level=warning --outfile="$css_file"
done

# Strip HTML comments
echo "Stripping HTML comments..."
find $RELEASE_DIR/templates -type f -name "*.html" -exec sed -i.bak -e 's/<!--.*-->//g' -e '/<!--/,/-->/d' {} \;
find $RELEASE_DIR/templates -type f -name "*.bak" -delete

echo "Build completed in '$RELEASE_DIR'"
