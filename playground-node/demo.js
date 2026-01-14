/**
 * Demo: ast-grep WASM with Node.js Filesystem (NODEFS)
 *
 * This example demonstrates how to use ast-grep WASM to scan files
 * directly from the Node.js filesystem.
 */

import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  init,
  scanFile,
  parseFile,
  fixFile,
  getSupportedLanguages,
  detectLanguage,
} from "ag-wasm/node-fs"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Path to tree-sitter parser WASM files
// You need to download these from: https://github.com/AstGrep/tree-sitter-wasm
const PARSER_DIR = process.env.PARSER_DIR || join(__dirname, "parsers")

async function main() {
  console.log("🚀 ast-grep WASM Node.js Filesystem Demo\n")

  // Show supported languages
  console.log("📚 Supported languages:")
  console.log(getSupportedLanguages().join(", "))
  console.log()

  // Initialize with parser directory
  try {
    await init(PARSER_DIR)
    console.log(`✅ Initialized with parser directory: ${PARSER_DIR}\n`)
  } catch (err) {
    console.error(`❌ Failed to initialize: ${err.message}`)
    console.log("\nTo use this demo, you need to:")
    console.log("1. Download tree-sitter parser WASM files")
    console.log("2. Set PARSER_DIR environment variable or create a 'parsers' directory")
    console.log("\nExample:")
    console.log("  PARSER_DIR=/path/to/parsers node demo.js")
    process.exit(1)
  }

  // Example: Detect language from file extension
  console.log("🔍 Language detection:")
  const testFiles = ["app.ts", "index.js", "main.py", "lib.rs", "unknown.xyz"]
  for (const file of testFiles) {
    const lang = detectLanguage(file)
    console.log(`  ${file} → ${lang || "unknown"}`)
  }
  console.log()

  // Example: Create a sample TypeScript file to scan
  const sampleCode = `
// Sample TypeScript code
const greeting = "Hello, World!";
console.log(greeting);

function add(a: number, b: number): number {
  return a + b;
}

const result = add(1, 2);
console.log(result);
`

  // Write sample file
  const { writeFile } = await import("node:fs/promises")
  const sampleFile = join(__dirname, "sample.ts")
  await writeFile(sampleFile, sampleCode)
  console.log(`📝 Created sample file: ${sampleFile}\n`)

  // Example: Parse the file and show AST
  console.log("🌳 Parsing AST...")
  try {
    const ast = await parseFile(sampleFile)
    console.log("AST root:", JSON.stringify(ast, null, 2).slice(0, 500) + "...\n")
  } catch (err) {
    console.error(`Failed to parse: ${err.message}\n`)
  }

  // Example: Scan for console.log calls
  console.log("🔎 Scanning for console.log calls...")
  try {
    const rules = [
      {
        id: "no-console-log",
        rule: {
          pattern: "console.log($$$ARGS)",
        },
        message: "Avoid using console.log in production",
      },
    ]

    const result = await scanFile(sampleFile, rules)
    console.log(`Found in ${result.file}:`)
    for (const [ruleId, matches] of Object.entries(result.matches)) {
      console.log(`  Rule "${ruleId}": ${matches.length} match(es)`)
      for (const match of matches) {
        console.log(`    - "${match.text}"`)
      }
    }
    console.log()
  } catch (err) {
    console.error(`Failed to scan: ${err.message}\n`)
  }

  // Example: Fix console.log calls
  console.log("🔧 Fixing console.log calls (replacing with logger.info)...")
  try {
    const fixRules = [
      {
        id: "replace-console-log",
        rule: {
          pattern: "console.log($$$ARGS)",
        },
        fix: "logger.info($$$ARGS)",
      },
    ]

    const fixResult = await fixFile(sampleFile, fixRules)
    if (fixResult.changed) {
      console.log("Fixed code:")
      console.log(fixResult.fixed)
    } else {
      console.log("No changes needed")
    }
  } catch (err) {
    console.error(`Failed to fix: ${err.message}\n`)
  }

  // Cleanup
  const { unlink } = await import("node:fs/promises")
  await unlink(sampleFile)
  console.log(`\n🧹 Cleaned up sample file`)
  console.log("\n✅ Demo completed!")
}

main().catch(console.error)
