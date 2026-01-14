#!/usr/bin/env node

/**
 * ast-grep WASM CLI Playground
 *
 * A CLI-like tool demonstrating ast-grep WASM with Node.js filesystem.
 *
 * Usage:
 *   node cli.js scan <path> --pattern "<pattern>" [--language <lang>] [--fix "<replacement>"]
 *   node cli.js parse <file>
 *   node cli.js languages
 *
 * Examples:
 *   node cli.js scan ./src --pattern "console.log(\$\$\$ARGS)" --language typescript
 *   node cli.js scan ./src --pattern "var \$NAME = \$VALUE" --fix "const \$NAME = \$VALUE"
 *   node cli.js parse ./src/index.ts
 *   node cli.js languages
 *
 * Environment:
 *   PARSER_DIR - Directory containing tree-sitter WASM parser files
 */

import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Parse command line arguments
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    pattern: { type: "string", short: "p" },
    language: { type: "string", short: "l" },
    fix: { type: "string", short: "f" },
    recursive: { type: "boolean", short: "r", default: true },
    json: { type: "boolean", short: "j", default: false },
    help: { type: "boolean", short: "h", default: false },
    "parser-dir": { type: "string" },
  },
})

const PARSER_DIR = values["parser-dir"] || process.env.PARSER_DIR || join(__dirname, "parsers")

function printHelp() {
  console.log(`
ast-grep WASM CLI Playground

USAGE:
  node cli.js <command> [options]

COMMANDS:
  scan <path>       Scan files for pattern matches
  parse <file>      Parse a file and show AST
  languages         List supported languages

OPTIONS:
  -p, --pattern     Pattern to search for (required for scan)
  -l, --language    Language to use (auto-detected if not specified)
  -f, --fix         Replacement pattern for fixes
  -r, --recursive   Scan directories recursively (default: true)
  -j, --json        Output results as JSON
  --parser-dir      Directory containing tree-sitter parser WASM files
  -h, --help        Show this help message

ENVIRONMENT:
  PARSER_DIR        Directory containing tree-sitter parser WASM files

PATTERN SYNTAX:
  \$NAME            Match any single AST node, capture as NAME
  \$\$\$NAME        Match zero or more AST nodes, capture as NAME

EXAMPLES:
  # Find all console.log calls
  node cli.js scan ./src -p "console.log(\$\$\$ARGS)" -l typescript

  # Find and fix var declarations
  node cli.js scan ./src -p "var \$NAME = \$VALUE" -f "const \$NAME = \$VALUE"

  # Parse a file and show AST
  node cli.js parse ./src/index.ts

  # List supported languages
  node cli.js languages
`)
}

async function main() {
  if (values.help || positionals.length === 0) {
    printHelp()
    process.exit(0)
  }

  const command = positionals[0]

  // Dynamically import the module (only when needed)
  let agWasm
  try {
    agWasm = await import("ag-wasm/node-fs")
  } catch (err) {
    console.error("Failed to import ag-wasm/node-fs:", err.message)
    console.error("\nMake sure the package is built: pnpm run build")
    process.exit(1)
  }

  switch (command) {
    case "languages":
      await listLanguages(agWasm)
      break
    case "scan":
      await scanCommand(agWasm)
      break
    case "parse":
      await parseCommand(agWasm)
      break
    default:
      console.error(`Unknown command: ${command}`)
      printHelp()
      process.exit(1)
  }
}

async function listLanguages(agWasm) {
  console.log("Supported languages:\n")
  const languages = agWasm.getSupportedLanguages()
  for (const lang of languages) {
    const exts = agWasm.getExtensions(lang).join(", ")
    console.log(`  ${lang.padEnd(12)} ${exts}`)
  }
}

async function initParser(agWasm) {
  try {
    await agWasm.init(PARSER_DIR)
    return true
  } catch (err) {
    console.error(`Failed to initialize: ${err.message}`)
    console.error(`\nParser directory: ${PARSER_DIR}`)
    console.error("\nTo use this CLI, you need tree-sitter parser WASM files.")
    console.error("Download them from: https://github.com/AstGrep/tree-sitter-wasm")
    console.error("\nSet PARSER_DIR environment variable or use --parser-dir option.")
    return false
  }
}

async function scanCommand(agWasm) {
  const targetPath = positionals[1]
  if (!targetPath) {
    console.error("Error: path is required for scan command")
    process.exit(1)
  }

  const pattern = values.pattern
  if (!pattern) {
    console.error("Error: --pattern is required for scan command")
    process.exit(1)
  }

  if (!(await initParser(agWasm))) {
    process.exit(1)
  }

  const rules = [
    {
      id: "cli-pattern",
      rule: { pattern },
      ...(values.fix && { fix: values.fix }),
    },
  ]

  const options = {
    path: resolve(targetPath),
    language: values.language,
    recursive: values.recursive,
    ignore: ["node_modules", ".git", "dist", "build", "coverage", "__pycache__"],
  }

  console.log(`Scanning: ${options.path}`)
  console.log(`Pattern: ${pattern}`)
  if (values.fix) {
    console.log(`Fix: ${values.fix}`)
  }
  console.log()

  const startTime = Date.now()

  try {
    if (values.fix) {
      // Fix mode
      const results = await agWasm.fixDirectory(options, rules)
      const elapsed = Date.now() - startTime

      let changedCount = 0
      for (const result of results) {
        if (result.changed) {
          changedCount++
          if (values.json) {
            console.log(JSON.stringify(result, null, 2))
          } else {
            console.log(`\n📝 ${result.file}`)
            console.log("--- Original:")
            console.log(result.original.slice(0, 500) + (result.original.length > 500 ? "..." : ""))
            console.log("--- Fixed:")
            console.log(result.fixed.slice(0, 500) + (result.fixed.length > 500 ? "..." : ""))
          }
        }
      }

      console.log(`\n✅ Scanned ${results.length} file(s), ${changedCount} would be changed (${elapsed}ms)`)
      console.log("Note: Files were not modified. Use the API to apply fixes.")
    } else {
      // Scan mode
      const results = await agWasm.scanDirectory(options, rules)
      const elapsed = Date.now() - startTime

      let totalMatches = 0
      for (const result of results) {
        const matches = result.matches["cli-pattern"] || []
        if (matches.length > 0) {
          totalMatches += matches.length

          if (values.json) {
            console.log(JSON.stringify(result, null, 2))
          } else {
            console.log(`\n📄 ${result.file}`)
            for (const match of matches) {
              const loc = match.range
                ? `:${match.range.start.line + 1}:${match.range.start.column + 1}`
                : ""
              console.log(`  ${loc} ${match.text.trim().slice(0, 80)}`)
            }
          }
        }
      }

      if (totalMatches === 0) {
        console.log("No matches found.")
      } else {
        console.log(`\n✅ Found ${totalMatches} match(es) in ${results.length} file(s) (${elapsed}ms)`)
      }
    }
  } catch (err) {
    console.error(`Scan failed: ${err.message}`)
    process.exit(1)
  }
}

async function parseCommand(agWasm) {
  const filePath = positionals[1]
  if (!filePath) {
    console.error("Error: file path is required for parse command")
    process.exit(1)
  }

  if (!(await initParser(agWasm))) {
    process.exit(1)
  }

  try {
    const ast = await agWasm.parseFile(resolve(filePath), values.language)

    if (values.json) {
      console.log(JSON.stringify(ast, null, 2))
    } else {
      console.log(`AST for: ${filePath}\n`)
      printAst(ast, 0)
    }
  } catch (err) {
    console.error(`Parse failed: ${err.message}`)
    process.exit(1)
  }
}

function printAst(node, depth = 0) {
  if (!node) return

  const indent = "  ".repeat(depth)
  const range = node.range
    ? `[${node.range.start.line}:${node.range.start.column}-${node.range.end.line}:${node.range.end.column}]`
    : ""

  const text = node.text ? ` "${node.text.slice(0, 30).replace(/\n/g, "\\n")}"` : ""

  console.log(`${indent}${node.kind || node.type || "node"} ${range}${text}`)

  if (node.children) {
    for (const child of node.children) {
      printAst(child, depth + 1)
    }
  }
}

main().catch((err) => {
  console.error("Error:", err.message)
  process.exit(1)
})
