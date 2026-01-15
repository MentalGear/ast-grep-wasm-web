# readme ast-grep wasm

## How to use

install rust & cargo

install wasm-pack

## Build AST-GREP CLI (WASI/WASM)

cd crates/sg-wasi-full

### install wasi-sdk

run download bash script
`crates/sg-wasi-full/download-wasi-sdk.sh`

### add the ast-grep languages you need:

1. crates/sg-wasi-full/Cargo.toml
2. update crate: `cargo update`

### Build

`cd crates/sg-wasi-full`
`cargo build --target wasm32-wasip1 --release`

# Build

pnpm run build

# set env

PARSER_DIR=./parsers

# Run playground

node playground-node/playground.js

---

# ag-wasm

A forked version of the unpublished `ast-grep-wasm` in the [ast-grep.github.io](https://github.com/ast-grep/ast-grep.github.io).

## License

[MIT](./LICENSE)
