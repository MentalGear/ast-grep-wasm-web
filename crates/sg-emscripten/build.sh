#!/bin/bash
# Build ast-grep with Emscripten for WebContainer/Node.js
#
# Prerequisites:
#   1. Install Emscripten SDK: https://emscripten.org/docs/getting_started/downloads.html
#      git clone https://github.com/emscripten-core/emsdk.git
#      cd emsdk && ./emsdk install latest && ./emsdk activate latest
#      source ./emsdk_env.sh
#
#   2. Add Rust target:
#      rustup target add wasm32-unknown-emscripten

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check for emcc
if ! command -v emcc &> /dev/null; then
    echo "Error: emcc not found. Please install and activate Emscripten SDK:"
    echo "  git clone https://github.com/emscripten-core/emsdk.git"
    echo "  cd emsdk && ./emsdk install latest && ./emsdk activate latest"
    echo "  source ./emsdk_env.sh"
    exit 1
fi

# Check for Rust target
if ! rustup target list --installed | grep -q wasm32-unknown-emscripten; then
    echo "Adding Rust target wasm32-unknown-emscripten..."
    rustup target add wasm32-unknown-emscripten
fi

echo "Building ast-grep with Emscripten..."

# Set Emscripten flags for NODEFS support
export EMCC_CFLAGS="-s NODERAWFS=1 -s FORCE_FILESYSTEM=1"

# Build with Emscripten target
cargo build --target wasm32-unknown-emscripten --release

echo ""
echo "Build complete!"
echo "Output: target/wasm32-unknown-emscripten/release/sg.js"
echo ""
echo "Run with Node.js:"
echo "  node target/wasm32-unknown-emscripten/release/sg.js 'console.log(\$\$\$)' ./src"
