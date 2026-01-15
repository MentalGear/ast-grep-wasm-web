# ast-grep WASI CLI vs Native CLI Comparison

This document compares the WASI CLI (`sg-wasi-full`) with the native ast-grep CLI.

## Compatibility Summary

**Overall: ~90-95% compatible for typical LLM code search/manipulation workflows**

## Feature Comparison

| Feature                             | Native CLI | WASI CLI | Status |
| ----------------------------------- | ---------- | -------- | ------ |
| **Pattern Search**                  | ✅         | ✅       | Same   |
| Pattern matching (`$VAR`, `$$$VAR`) | ✅         | ✅       | Same   |
| Search and replace (`-r`)           | ✅         | ✅       | Same   |
| Apply fixes (`-U`)                  | ✅         | ✅       | Same   |
| **JSON Output**                     | ✅         | ✅       | Same   |
| Range (line/column/offset)          | ✅         | ✅       | Same   |
| ruleId, severity, message, fix      | ✅         | ✅       | Same   |
| **YAML Rules**                      | ✅         | ✅       | Same   |
| Scan with rules file                | ✅         | ✅       | Same   |
| Rule fix patterns                   | ✅         | ✅       | Same   |
| **Severity Levels**                 | ✅         | ✅       | Same   |
| error/warning/info/hint             | ✅         | ✅       | Same   |
| Colored output                      | ✅         | ✅       | Same   |
| **Config Discovery**                | ✅         | ✅       | Same   |
| Auto-find sgconfig.yml              | ✅         | ✅       | Same   |
| ruleDirs support                    | ✅         | ✅       | Same   |
| **Language Support**                | ✅         | ✅       | Same\* |
| Tree-sitter parsing                 | ✅         | ✅       | Same   |
| Auto language detection             | ✅         | ✅       | Same   |
| **Parse/AST Display**               | ✅         | ✅       | Same   |
| **CLI Args (clap)**                 | ✅         | ✅       | Same   |
| --help auto-generation              | ✅         | ✅       | Same   |

### Differences

| Feature              | Native CLI | WASI CLI    | Notes                        |
| -------------------- | ---------- | ----------- | ---------------------------- |
| **Multi-threading**  | ✅         | ❌          | WASI runs single-threaded    |
| **Interactive mode** | ✅         | ❌          | No TTY in WASM sandbox       |
| **Stdin processing** | ✅         | Limited     | WASI stdin is limited        |
| **LSP server**       | ✅         | ❌          | Not implemented              |
| **All languages**    | 25+        | 6 default\* | Configurable at compile time |

_\*Language support is configurable by editing `Cargo.toml` and rebuilding._

## Performance Notes

- **Single-threaded**: WASI doesn't support multi-threading, so file scanning is sequential
- **No JIT**: WASM execution is typically slower than native, but still fast for most use cases
- **Binary size**: ~37MB with default 6 languages (grows with more languages)

## Use Cases

### ✅ Excellent for:

- LLM-driven code search and manipulation
- WebContainer environments (StackBlitz, CodeSandbox)
- Browser-based code analysis
- Sandboxed execution environments
- Pattern matching workflows
- Rule-based linting

### ⚠️ Not ideal for:

- Very large codebases (no multi-threading)
- Interactive terminal workflows
- LSP integration
- Real-time file watching

## API Compatibility

### Pattern Search

```bash
# Both work identically
sg 'console.log($$$ARGS)' ./src
sg run -p 'const $X = $Y' -l typescript ./src
```

### Search and Replace

```bash
# Both work identically
sg 'var $X = $Y' -r 'let $X = $Y' -U ./src
```

### YAML Rule Scanning

```bash
# Both work identically
sg scan -c rules.yml ./src
sg scan ./src  # Auto-discovers sgconfig.yml
```

### JSON Output

```bash
# Both produce same JSON format
sg 'pattern' --json ./src
sg scan --json ./src
```

Output format:

```json
{
  "file": "/path/to/file.ts",
  "range": {
    "start": { "line": 4, "column": 0, "offset": 79 },
    "end": { "line": 4, "column": 28, "offset": 107 }
  },
  "text": "console.log(\"Hello\")",
  "ruleId": "no-console-log",
  "severity": "warning",
  "message": "Avoid console.log",
  "fix": "// console.log($$$ARGS)",
  "language": "typescript"
}
```

## Adding Languages

Edit `crates/sg-wasi-full/Cargo.toml`:

```toml
ast-grep-language = { version = "0.40.5", default-features = false, features = [
  "tree-sitter-javascript",
  "tree-sitter-typescript",
  "tree-sitter-python",    # Add Python
  "tree-sitter-rust",      # Add Rust
  "tree-sitter-go",        # Add Go
  # ... see ast-grep-language for full list
] }
```

Then rebuild:

```bash
cargo build --target wasm32-wasip1 --release
```

## Conclusion

The WASI CLI provides nearly complete feature parity with the native CLI for pattern matching, rule scanning, and code rewriting. The main limitations are:

1. **No multi-threading** - fine for most use cases
2. **No interactive mode** - not needed for LLM workflows
3. **Language subset by default** - easily configurable

For LLM-driven code search and manipulation, the WASI CLI is fully suitable.
