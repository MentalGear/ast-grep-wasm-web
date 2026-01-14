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
import { readFile, writeFile } from "node:fs/promises"

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
// LINTING RULES
// ============================================================================

const LINT_RULES = [
  {
    id: "no-var",
    rule: { pattern: "var $NAME = $VALUE" },
    message: "Use 'const' or 'let' instead of 'var'",
    severity: "error",
    fix: "const $NAME = $VALUE",
  },
  {
    id: "no-console-log",
    rule: { pattern: "console.log($$$ARGS)" },
    message: "Remove console.log statements in production",
    severity: "warning",
  },
  {
    id: "no-debugger",
    rule: { pattern: "debugger" },
    message: "Remove debugger statements",
    severity: "error",
    fix: "",
  },
  {
    id: "no-any",
    rule: { pattern: ": any" },
    message: "Avoid using 'any' type, use specific types instead",
    severity: "warning",
  },
]

// ============================================================================
// SEARCH PATTERNS
// ============================================================================

const SEARCH_PATTERNS = [
  {
    id: "find-functions",
    rule: { pattern: "function $NAME($$$PARAMS) { $$$BODY }" },
    description: "Find all function declarations",
  },
  {
    id: "find-arrow-functions",
    rule: { pattern: "const $NAME = ($$$PARAMS) => $BODY" },
    description: "Find all arrow functions assigned to const",
  },
  {
    id: "find-classes",
    rule: { pattern: "class $NAME { $$$BODY }" },
    description: "Find all class declarations",
  },
  {
    id: "find-async-functions",
    rule: { pattern: "async function $NAME($$$PARAMS) { $$$BODY }" },
    description: "Find all async functions",
  },
  {
    id: "find-exports",
    rule: { pattern: "export { $$$EXPORTS }" },
    description: "Find all export statements",
  },
]

// ============================================================================
// REPLACE RULES
// ============================================================================

const REPLACE_RULES = [
  {
    id: "var-to-const",
    rule: { pattern: "var $NAME = $VALUE" },
    fix: "const $NAME = $VALUE",
    description: "Convert var to const",
  },
  {
    id: "console-to-logger",
    rule: { pattern: 'console.log($$$ARGS)' },
    fix: "logger.debug($$$ARGS)",
    description: "Replace console.log with logger.debug",
  },
  {
    id: "remove-debugger",
    rule: { pattern: "debugger" },
    fix: "// debugger removed",
    description: "Comment out debugger statements",
  },
]

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
    console.error("To run this playground, you need tree-sitter parser WASM files.")
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

  const lintResults = agWasm.findNodes(sourceCode, LINT_RULES)

  let totalIssues = 0
  for (const rule of LINT_RULES) {
    const matches = lintResults[rule.id] || []
    if (matches.length > 0) {
      totalIssues += matches.length
      const icon = rule.severity === "error" ? "❌" : "⚠️"
      console.log(`${icon} ${rule.id} (${matches.length} issue${matches.length > 1 ? "s" : ""})`)
      console.log(`   ${rule.message}`)
      for (const match of matches.slice(0, 3)) {
        const line = match.range?.start?.line + 1 || "?"
        console.log(`   └─ Line ${line}: ${match.text.trim().slice(0, 50)}`)
      }
      if (matches.length > 3) {
        console.log(`   └─ ... and ${matches.length - 3} more`)
      }
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

  const searchResults = agWasm.findNodes(sourceCode, SEARCH_PATTERNS)

  for (const pattern of SEARCH_PATTERNS) {
    const matches = searchResults[pattern.id] || []
    console.log(`🔍 ${pattern.description}`)
    console.log(`   Pattern: ${pattern.rule.pattern}`)
    console.log(`   Found: ${matches.length} match(es)`)
    for (const match of matches.slice(0, 2)) {
      const line = match.range?.start?.line + 1 || "?"
      const preview = match.text.trim().split("\n")[0].slice(0, 50)
      console.log(`   └─ Line ${line}: ${preview}...`)
    }
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

  const lines = modifiedCode.split("\n").slice(0, 30)
  lines.forEach((line, i) => {
    const lineNum = String(i + 1).padStart(3, " ")
    // Highlight changed lines
    if (line.includes("const") && sourceCode.split("\n")[i]?.includes("var")) {
      console.log(`${lineNum} | ${line}  ← changed`)
    } else if (line.includes("logger.debug")) {
      console.log(`${lineNum} | ${line}  ← changed`)
    } else if (line.includes("// debugger removed")) {
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
