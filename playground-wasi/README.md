# ast-grep WASI Playground

This playground demonstrates how to use the ast-grep WASI CLI with wasmer/wasmtime.

## Prerequisites

1. **Build the WASI binary** (if not already built):
   ```bash
   cd ../crates/sg-wasi-full
   ./download-wasi-sdk.sh  # Install WASI SDK (first time only)
   cargo build --target wasm32-wasip1 --release
   ```

2. **Install wasmer** (or wasmtime):
   ```bash
   curl https://get.wasmer.io -sSfL | sh
   source ~/.wasmer/wasmer.sh
   ```

## Quick Start

```bash
# Run from repository root
cd ..

# Search for console.log calls
wasmer run --mapdir /app:. crates/sg-wasi-full/target/wasm32-wasip1/release/sg.wasm -- \
  'console.log($$$ARGS)' /app/playground-wasi/examples

# Or use the explicit syntax
wasmer run --mapdir /app:. crates/sg-wasi-full/target/wasm32-wasip1/release/sg.wasm -- \
  run -p 'console.log($$$ARGS)' -l javascript /app/playground-wasi/examples
```

## Usage Examples

### Pattern Search (Shorthand)

```bash
# Find all console.log calls
sg 'console.log($$$ARGS)' ./examples

# Find all const declarations
sg 'const $NAME = $VALUE' ./examples

# Find all function declarations
sg 'function $NAME($$$PARAMS) { $$$BODY }' ./examples
```

### Pattern Search with Explicit Options

```bash
# Search with explicit language
sg run -p 'console.log($$$)' -l typescript ./examples

# Search with debug output
sg run -p 'const $X = $Y' --debug ./examples
```

### Search and Replace (Rewrite)

```bash
# Replace var with let (preview)
sg 'var $X = $Y' -r 'let $X = $Y' ./examples

# Replace var with let (apply changes)
sg 'var $X = $Y' -r 'let $X = $Y' -U ./examples

# Replace console.log with console.debug
sg 'console.log($$$ARGS)' -r 'console.debug($$$ARGS)' -U ./examples
```

### Scan with YAML Rules

```bash
# Scan using rules file
sg scan -c ./rules.yml ./examples
```

### Parse and Show AST

```bash
# Show AST structure of a file
sg parse ./examples/sample.ts
```

## Metavariable Reference

| Pattern | Description |
|---------|-------------|
| `$VAR` | Match single AST node |
| `$$$VAR` | Match multiple AST nodes (variadic) |
| `$_` | Anonymous single match (don't capture) |
| `$$$` | Anonymous variadic match |

## Supported Languages

The default build includes: **JavaScript, TypeScript, HTML, CSS, JSON, YAML**

To add more languages, edit `crates/sg-wasi-full/Cargo.toml` and add the tree-sitter features you need:

```toml
ast-grep-language = { version = "0.40.5", default-features = false, features = [
  "tree-sitter-javascript",
  "tree-sitter-typescript",
  "tree-sitter-python",  # Add this for Python
  "tree-sitter-rust",    # Add this for Rust
  # ... see ast-grep-language docs for full list
] }
```

Then rebuild: `cargo build --target wasm32-wasip1 --release`

## WebContainer Usage

For WebContainer environments (like StackBlitz), use wasmer to execute:

```javascript
import { init, WASI } from "@aspect-build/wasmer-js";

await init();
const wasi = new WASI({
  args: ["sg", "console.log($$$)", "/app"],
  env: {},
  preopens: { "/app": "/workspace" }
});

const wasm = await WebAssembly.compile(wasmBytes);
const instance = await WebAssembly.instantiate(wasm, wasi.getImports(wasm));
wasi.start(instance);
```

## Tips

1. **Quoting patterns**: Always quote patterns containing `$` to prevent shell expansion
2. **Path mapping**: Use `--mapdir` to map host directories into the WASM sandbox
3. **Language detection**: The CLI auto-detects language from file extensions
4. **Performance**: The WASM binary includes all tree-sitter grammars (~37MB)
