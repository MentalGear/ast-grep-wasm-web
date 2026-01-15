# ast-grep WASM

A WebAssembly build of [ast-grep](https://ast-grep.github.io/) for browser and WASI environments.

## Overview

This repository provides multiple ways to use ast-grep in web/WASM environments:

| Package | Description | Use Case |
|---------|-------------|----------|
| `packages/ag-wasm` | Browser WASM module | In-browser AST searching |
| `crates/sg-wasi-full` | Full WASI CLI | wasmer/wasmtime, WebContainers |
| `playground/` | Vue 3 browser demo | Interactive web playground |
| `playground-node/` | Node.js demo | Server-side usage |
| `playground-wasi/` | WASI CLI examples | CLI usage with wasmer |

## Quick Start

### WASI CLI (Recommended for WebContainers)

```bash
# Build the WASI binary
cd crates/sg-wasi-full
./download-wasi-sdk.sh  # First time only
cargo build --target wasm32-wasip1 --release

# Run with wasmer
wasmer run --mapdir /app:. target/wasm32-wasip1/release/sg.wasm -- \
  'console.log($$$ARGS)' /app/src
```

### Browser WASM

```bash
pnpm install
pnpm run build
```

## WASI CLI Usage

The WASI CLI works like the native ast-grep CLI:

```bash
# Shorthand pattern search
sg 'console.log($$$ARGS)' ./src
sg 'const $X = $Y' ./src

# Search and replace
sg 'var $X = $Y' -r 'let $X = $Y' -U ./src

# Scan with YAML rules
sg scan -c rules.yml ./src

# Parse and show AST
sg parse ./file.ts
```

### Metavariables

| Pattern | Description |
|---------|-------------|
| `$VAR` | Match single AST node |
| `$$$VAR` | Match multiple nodes (variadic) |
| `$_` | Anonymous single match |
| `$$$` | Anonymous variadic match |

### Supported Languages

Default build: **JavaScript, TypeScript, HTML, CSS, JSON, YAML**

Add more languages by editing `crates/sg-wasi-full/Cargo.toml` (see [playground-wasi/README.md](playground-wasi/README.md)).

## Playgrounds

### WASI Playground

```bash
cd playground-wasi
./run.sh  # Runs demo examples
```

See [playground-wasi/README.md](playground-wasi/README.md) for detailed examples.

### Node.js Playground

```bash
cd playground-node
node playground.js
```

### Browser Playground

```bash
cd playground
pnpm install
pnpm run dev
```

## Building

### Prerequisites

- Rust and Cargo
- wasm-pack (`cargo install wasm-pack`)
- Node.js and pnpm
- WASI SDK (for WASI builds)

### Build Commands

```bash
# Build browser WASM
pnpm run build

# Build WASI CLI
cd crates/sg-wasi-full
./download-wasi-sdk.sh
cargo build --target wasm32-wasip1 --release
```

## WebContainer Integration

For WebContainer environments (StackBlitz, etc.), use the WASI binary with wasmer-js:

```javascript
import { init, WASI } from "@aspect-build/wasmer-js";

await init();
const wasi = new WASI({
  args: ["sg", "console.log($$$)", "/app"],
  preopens: { "/app": "/workspace" }
});

const wasm = await WebAssembly.compile(wasmBytes);
const instance = await WebAssembly.instantiate(wasm, wasi.getImports(wasm));
wasi.start(instance);
```

## Project Structure

```
ast-grep-wasm-web/
├── crates/
│   └── sg-wasi-full/     # Full WASI CLI with tree-sitter
├── packages/
│   └── ag-wasm/          # Browser WASM package
├── playground/           # Vue 3 browser playground
├── playground-node/      # Node.js playground
├── playground-wasi/      # WASI CLI examples
├── src/                  # Rust WASM source
└── scripts/              # Build scripts
```

## License

[MIT](./LICENSE)

## Credits

Based on the unpublished `ast-grep-wasm` from [ast-grep.github.io](https://github.com/ast-grep/ast-grep.github.io).
