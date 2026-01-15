#!/bin/bash
# WASI Playground Runner
# This script helps run ast-grep WASI CLI examples

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
WASM_FILE="$ROOT_DIR/crates/sg-wasi-full/target/wasm32-wasip1/release/sg.wasm"

# Check if WASM file exists
if [ ! -f "$WASM_FILE" ]; then
    echo -e "${YELLOW}WASM binary not found. Building...${NC}"
    cd "$ROOT_DIR/crates/sg-wasi-full"

    # Check for WASI SDK
    if [ ! -d "/opt/wasi-sdk" ]; then
        echo -e "${YELLOW}WASI SDK not found. Installing...${NC}"
        ./download-wasi-sdk.sh
    fi

    cargo build --target wasm32-wasip1 --release
    echo -e "${GREEN}Build complete!${NC}"
fi

# Source wasmer if available
if [ -f ~/.wasmer/wasmer.sh ]; then
    source ~/.wasmer/wasmer.sh
fi

# Check for wasmer
if ! command -v wasmer &> /dev/null; then
    echo -e "${YELLOW}wasmer not found. Installing...${NC}"
    curl https://get.wasmer.io -sSfL | sh
    source ~/.wasmer/wasmer.sh
fi

echo -e "${BLUE}=== ast-grep WASI Playground ===${NC}"
echo -e "Supported languages: JavaScript, TypeScript, HTML, CSS, JSON, YAML"
echo ""

# Function to run sg command (--dir=/ grants full filesystem access)
run_sg() {
    echo -e "${GREEN}> sg $@${NC}"
    wasmer run --dir=/ "$WASM_FILE" -- "$@"
    echo ""
}

# Demo commands
echo -e "${BLUE}1. Find all console.log calls:${NC}"
run_sg 'console.log($$$ARGS)' "$SCRIPT_DIR/examples"

echo -e "${BLUE}2. Find all const declarations:${NC}"
run_sg 'const $NAME = $VALUE' "$SCRIPT_DIR/examples"

echo -e "${BLUE}3. Find all var declarations (to refactor):${NC}"
run_sg 'var $NAME = $VALUE' "$SCRIPT_DIR/examples"

echo -e "${BLUE}4. Find all async functions:${NC}"
run_sg 'async function $NAME($$$PARAMS) { $$$BODY }' "$SCRIPT_DIR/examples"

echo -e "${BLUE}5. Scan with YAML rules:${NC}"
run_sg scan -c "$SCRIPT_DIR/rules.yml" "$SCRIPT_DIR/examples"

echo -e "${BLUE}6. Parse and show AST of sample.ts:${NC}"
wasmer run --dir=/ "$WASM_FILE" -- parse "$SCRIPT_DIR/examples/sample.ts" 2>&1 | head -30
echo "..."
echo ""

echo -e "${GREEN}Done! Try your own patterns:${NC}"
echo "  wasmer run --dir=/ $WASM_FILE -- 'YOUR_PATTERN' /path/to/code"
