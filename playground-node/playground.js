#!/usr/bin/env node

/**
 * ast-grep WASM Playground
 *
 * Demonstrates: Linting, Search, and Replace functionality
 *
 * Usage:
 *   PARSER_DIR=/path/to/parsers node playground.js
 */

import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { readFile } from "node:fs/promises"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PARSER_DIR = process.env.PARSER_DIR || join(__dirname, "parsers")

// Import ag-wasm node-fs module
let agWasm
try {
  agWasm = await import("ag-wasm/node-fs")
} catch (err) {
  console.error("Failed to import ag-wasm/node-fs:", err.message)
  console.error("Make sure to build: pnpm run build")
  process.exit(1)
}

// ============================================================================
// LINTING RULES (with marker fixes to detect matches)
// ============================================================================

const LINT_RULES = [
  {
    id: "no-var",
    language: "typescript",
    rule: { pattern: "var $NAME = $VALUE" },
    message: "Use 'const' or 'let' instead of 'var'",
    severity: "error",
    fix: "/*LINT:no-var*/var $NAME = $VALUE",
  },
  {
    id: "no-console-log",
    language: "typescript",
    rule: { pattern: "console.log($$$ARGS)" },
    message: "Remove console.log statements in production",
    severity: "warning",
    fix: "/*LINT:no-console-log*/console.log($$$ARGS)",
  },
  {
    id: "no-debugger",
    language: "typescript",
    rule: { pattern: "debugger" },
    message: "Remove debugger statements",
    severity: "error",
    fix: "/*LINT:no-debugger*/debugger",
  },
  {
    id: "no-any-param",
    language: "typescript",
    rule: { pattern: "($NAME: any)" },
    message: "Avoid using 'any' type in parameters",
    severity: "warning",
    fix: "/*LINT:no-any*/($NAME: any)",
  },
]

// ============================================================================
// SEARCH PATTERNS (with marker fixes to detect matches)
// ============================================================================

const SEARCH_PATTERNS = [
  {
    id: "find-functions",
    language: "typescript",
    rule: { pattern: "function $NAME($$$PARAMS) { $$$BODY }" },
    description: "Find all function declarations",
    fix: "/*FOUND:function*/function $NAME($$$PARAMS) { $$$BODY }",
  },
  {
    id: "find-arrow-functions",
    language: "typescript",
    rule: { pattern: "const $NAME = ($$$PARAMS) => { $$$BODY }" },
    description: "Find all arrow functions with block body",
    fix: "/*FOUND:arrow*/const $NAME = ($$$PARAMS) => { $$$BODY }",
  },
  {
    id: "find-classes",
    language: "typescript",
    rule: { pattern: "class $NAME { $$$BODY }" },
    description: "Find all class declarations",
    fix: "/*FOUND:class*/class $NAME { $$$BODY }",
  },
  {
    id: "find-async-functions",
    language: "typescript",
    rule: { pattern: "async function $NAME($$$PARAMS) { $$$BODY }" },
    description: "Find all async functions",
    fix: "/*FOUND:async*/async function $NAME($$$PARAMS) { $$$BODY }",
  },
  {
    id: "find-exports",
    language: "typescript",
    rule: { pattern: "export { $$$EXPORTS }" },
    description: "Find all named exports",
    fix: "/*FOUND:export*/export { $$$EXPORTS }",
  },
]

// ============================================================================
// REPLACE RULES
// ============================================================================

const REPLACE_RULES = [
  {
    id: "var-to-const",
    language: "typescript",
    rule: { pattern: "var $NAME = $VALUE" },
    fix: "const $NAME = $VALUE",
    description: "Convert var to const",
  },
  {
    id: "console-to-logger",
    language: "typescript",
    rule: { pattern: "console.log($$$ARGS)" },
    fix: "logger.debug($$$ARGS)",
    description: "Replace console.log with logger.debug",
  },
  {
    id: "remove-debugger",
    language: "typescript",
    rule: { pattern: "debugger" },
    fix: "// debugger removed",
    description: "Comment out debugger statements",
  },
]

// Helper: Count marker occurrences
function countMarkers(code, marker) {
  const regex = new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
  return (code.match(regex) || []).length
}

// ============================================================================
// MAIN PLAYGROUND
// ============================================================================

async function main() {
  console.log("═".repeat(60))
  console.log("  ast-grep WASM Playground")
  console.log("  Demonstrating: Linting, Search, and Replace")
  console.log("═".repeat(60))
  console.log()

  // Initialize
  try {
    await agWasm.init(PARSER_DIR)
    console.log(`✓ Initialized with parser directory: ${PARSER_DIR}`)
  } catch (err) {
    console.error(`✗ Failed to initialize: ${err.message}`)
    console.error()
    console.error(
      "To run this playground, you need tree-sitter parser WASM files.",
    )
    console.error("Download from: https://github.com/AstGrep/tree-sitter-wasm")
    console.error("Then set PARSER_DIR environment variable.")
    process.exit(1)
  }

  // Read example file
  const exampleFile = join(__dirname, "example.ts")
  let sourceCode
  try {
    sourceCode = await readFile(exampleFile, "utf-8")
    console.log(`✓ Loaded example file: example.ts`)
  } catch {
    console.error("✗ Could not read example.ts")
    process.exit(1)
  }

  // Setup TypeScript parser
  await agWasm.setupLanguage("typescript")
  console.log(`✓ TypeScript parser loaded`)
  console.log()

  // ─────────────────────────────────────────────────────────────────────────
  // 1. LINTING
  // ─────────────────────────────────────────────────────────────────────────
  console.log("─".repeat(60))
  console.log("  1. LINTING - Find code quality issues")
  console.log("─".repeat(60))
  console.log()

  let totalIssues = 0
  for (const rule of LINT_RULES) {
    // Use fixErrors to detect matches by adding markers
    const markedCode = agWasm.fixErrors(sourceCode, [rule])
    const marker = `/*LINT:${rule.id.replace("no-", "")}*/`
    const count = countMarkers(markedCode, marker)

    if (count > 0) {
      totalIssues += count
      const icon = rule.severity === "error" ? "❌" : "⚠️"
      console.log(`${icon} ${rule.id} (${count} issue${count > 1 ? "s" : ""})`)
      console.log(`   ${rule.message}`)
      console.log(`   Pattern: ${rule.rule.pattern}`)
      console.log()
    }
  }

  if (totalIssues === 0) {
    console.log("✅ No linting issues found!")
  } else {
    console.log(`📊 Total: ${totalIssues} issue(s) found`)
  }
  console.log()

  // ─────────────────────────────────────────────────────────────────────────
  // 2. SEARCH
  // ─────────────────────────────────────────────────────────────────────────
  console.log("─".repeat(60))
  console.log("  2. SEARCH - Find code patterns")
  console.log("─".repeat(60))
  console.log()

  for (const pattern of SEARCH_PATTERNS) {
    // Use fixErrors to detect matches by adding markers
    const markedCode = agWasm.fixErrors(sourceCode, [pattern])
    const markerId = pattern.id.replace("find-", "")
    const marker = `/*FOUND:${markerId}*/`
    const count = countMarkers(markedCode, marker)

    console.log(`🔍 ${pattern.description}`)
    console.log(`   Pattern: ${pattern.rule.pattern}`)
    console.log(`   Found: ${count} match(es)`)
    console.log()
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. REPLACE
  // ─────────────────────────────────────────────────────────────────────────
  console.log("─".repeat(60))
  console.log("  3. REPLACE - Transform code patterns")
  console.log("─".repeat(60))
  console.log()

  let modifiedCode = sourceCode

  for (const rule of REPLACE_RULES) {
    const before = modifiedCode
    modifiedCode = agWasm.fixErrors(modifiedCode, [rule])

    if (before !== modifiedCode) {
      console.log(`✏️  ${rule.description}`)
      console.log(`   Pattern: ${rule.rule.pattern}`)
      console.log(`   Replace: ${rule.fix}`)
      console.log(`   Applied!`)
      console.log()
    }
  }

  // Show diff preview
  console.log("─".repeat(60))
  console.log("  PREVIEW: Modified code (first 30 lines)")
  console.log("─".repeat(60))
  console.log()

  const originalLines = sourceCode.split("\n")
  const modifiedLines = modifiedCode.split("\n")

  modifiedLines.slice(0, 30).forEach((line, i) => {
    const lineNum = String(i + 1).padStart(3, " ")
    const originalLine = originalLines[i] || ""
    if (line !== originalLine) {
      console.log(`${lineNum} | ${line}  ← changed`)
    } else {
      console.log(`${lineNum} | ${line}`)
    }
  })

  console.log()
  console.log("═".repeat(60))
  console.log("  Playground completed!")
  console.log("═".repeat(60))
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
