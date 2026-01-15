# ast-grep Emscripten Build

ast-grep CLI compiled with Emscripten for WebContainer and Node.js environments.

## Why Emscripten?

| Feature          | WASI                            | Emscripten          |
| ---------------- | ------------------------------- | ------------------- |
| **WebContainer** | ❌ Needs wasmer-js (incomplete) | ✅ Native Node.js   |
| **Filesystem**   | WASI syscalls                   | NODEFS (Node.js fs) |
| **Runtime**      | Needs WASI runtime              | Native Node.js      |
| **CLI style**    | Native                          | Requires JS wrapper |

Emscripten provides better WebContainer compatibility by using Node's native filesystem instead of WASI syscalls.

## Prerequisites

1. **Install Emscripten SDK**:

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

2. **Add Rust target**:

```bash
rustup target add wasm32-unknown-emscripten
```

## Build

```bash
./build.sh
```

Or manually:

```bash
export EMCC_CFLAGS="-s NODERAWFS=1 -s FORCE_FILESYSTEM=1"
cargo build --target wasm32-unknown-emscripten --release
```

## Usage

### Direct Node.js execution

```bash
node target/wasm32-unknown-emscripten/release/sg.js 'console.log($$$ARGS)' ./src
```

### With wrapper script

Create `ast-grep`:

```bash
#!/bin/bash
node /path/to/sg.js "$@"
```

Then use:

```bash
ast-grep 'console.log($$$ARGS)' ./src
ast-grep scan -c rules.yml ./src
```

### In WebContainer (StackBlitz, CodeSandbox)

```javascript
// Import the Emscripten module
const createModule = require("./sg.js")

async function runAstGrep(args) {
  const Module = await createModule({
    arguments: args,
    print: (text) => console.log(text),
    printErr: (text) => console.error(text),
  })
}

// Search for console.log
await runAstGrep(["console.log($$$ARGS)", "./src"])

// Scan with rules
await runAstGrep(["scan", "-c", "rules.yml", "./src"])
```

## CLI Reference

```
USAGE:
  sg <PATTERN> [PATH...]           Search for pattern
  sg run -p <PATTERN> [PATH...]    Search for pattern
  sg scan [-c CONFIG] [PATH...]    Scan with rules

OPTIONS:
  -p, --pattern <PATTERN>   AST pattern to search
  -r, --rewrite <REWRITE>   Replacement pattern
  -l, --lang <LANG>         Language (typescript, javascript, etc.)
  -c, --config <FILE>       Rules file (YAML)
  -U, --update-all          Apply all fixes
  --json                    Output as JSON
  -h, --help                Show help

EXAMPLES:
  sg 'console.log($$$ARGS)' ./src
  sg run -p 'var $X = $Y' -r 'let $X = $Y' -U ./src
  sg scan -c rules.yml ./src
```

## Supported Languages

Default build includes: **JavaScript, TypeScript, HTML, CSS, JSON, YAML**

To add more languages, edit `Cargo.toml`:

```toml
ast-grep-language = { version = "0.40.5", default-features = false, features = [
  "tree-sitter-javascript",
  "tree-sitter-typescript",
  "tree-sitter-python",    # Add Python
  "tree-sitter-rust",      # Add Rust
] }
```

## Comparison with WASI Build

| Aspect            | WASI (`sg-wasi-full`)    | Emscripten (`sg-emscripten`) |
| ----------------- | ------------------------ | ---------------------------- |
| **Target**        | `wasm32-wasip1`          | `wasm32-unknown-emscripten`  |
| **Runtime**       | wasmer, wasmtime         | Node.js                      |
| **WebContainer**  | Limited (wasmer-js gaps) | Full support                 |
| **CLI interface** | Clean (`wasmer run`)     | Needs wrapper                |
| **File size**     | ~37MB .wasm              | ~40MB .js + .wasm            |
| **Filesystem**    | WASI preopens            | NODEFS                       |

**Recommendation:**

- Use **WASI** for native CLI usage with wasmer/wasmtime
- Use **Emscripten** for WebContainer environments
