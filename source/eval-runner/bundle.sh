#!/bin/bash
# Bundle the eval runner Lambda package (no Docker required).
# Run this before `cdk deploy VoiceAgentDemosStack`.
#
# Creates source/eval-runner/bundled/ with all dependencies + harness code.
#
# The nova-sonic-eval-harness is vendored alongside this script at
# source/eval-runner/nova-sonic-eval-harness/ (MIT-0, from
# https://github.com/aws-samples/sample-amazon-nova-sonic-eval-harness).
# No clone or network fetch of the harness is required.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUNDLE_DIR="$SCRIPT_DIR/bundled"
HARNESS_DIR="$SCRIPT_DIR/nova-sonic-eval-harness"

if [ ! -d "$HARNESS_DIR" ]; then
    echo "❌ Vendored harness not found at: $HARNESS_DIR"
    echo "   The nova-sonic-eval-harness should be committed under source/eval-runner/."
    exit 1
fi

echo "🧹 Cleaning previous bundle..."
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR"

echo "📦 Installing eval harness dependencies..."
# Filter out packages not needed in Lambda or that have platform-specific binaries
grep -v -E "^(streamlist|plotly|pandas)" "$HARNESS_DIR/requirements.txt" > /tmp/eval-requirements-filtered.txt

# Install pure-python packages normally
grep -v -E "^(awscrt)" /tmp/eval-requirements-filtered.txt > /tmp/eval-requirements-pure.txt
pip install -r /tmp/eval-requirements-pure.txt \
    websockets pyyaml python-dotenv \
    -t "$BUNDLE_DIR" \
    --quiet 2>&1 | grep -v "already satisfied" || true

# Install awscrt with Linux platform (it's a C extension)
pip install awscrt \
    -t "$BUNDLE_DIR" \
    --platform manylinux2014_x86_64 \
    --implementation cp \
    --python-version 3.12 \
    --only-binary=:all: \
    --quiet 2>&1 || true

# Add pandas stub (pandas is only used for CSV reporting, not needed for eval execution)
mkdir -p "$BUNDLE_DIR/pandas"
cat > "$BUNDLE_DIR/pandas/__init__.py" << 'EOF'
"""Stub pandas module — not needed for Lambda eval execution."""
class DataFrame:
    def __init__(self, *args, **kwargs): pass
    def to_csv(self, *args, **kwargs): pass
EOF

echo "📁 Copying eval harness source..."
# Copy the vendored harness into the bundle (exclude VCS/dev-only dirs and caches)
rsync -a \
    --exclude='.git' \
    --exclude='.kiro' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    "$HARNESS_DIR/" "$BUNDLE_DIR/nova-sonic-eval-harness/"

echo "📁 Copying runner entry point + adapter..."
cp "$SCRIPT_DIR/eval_runner.py" "$BUNDLE_DIR/"
cp "$SCRIPT_DIR/agentcore_adapter.py" "$BUNDLE_DIR/"

# Clean up unnecessary files from the bundle
rm -rf "$BUNDLE_DIR/nova-sonic-eval-harness/results"
find "$BUNDLE_DIR" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
find "$BUNDLE_DIR" -name "*.pyc" -delete 2>/dev/null || true

SIZE=$(du -sh "$BUNDLE_DIR" | cut -f1)
echo "✅ Bundle ready: $BUNDLE_DIR ($SIZE)"
echo "   Now run: cd deployment && cdk deploy VoiceAgentDemosStack"
