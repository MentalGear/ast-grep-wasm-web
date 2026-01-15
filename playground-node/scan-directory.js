/**
 * Scan Directory: ast-grep WASM with Node.js Filesystem (NODEFS)
 *
 * This example demonstrates scanning an entire directory for code patterns.
 *
 * Usage:
 *   PARSER_DIR=/path/to/parsers node scan-directory.js /path/to/scan
 */

import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { init, scanDirectory, fixDirectory } from "ag-wasm/node-fs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PARSER_DIR = process.env.PARSER_DIR || join(__dirname, "parsers")

// Common code quality rules
const RULES = [
  {
    id: "no-console-log",
    rule: {
      pattern: "console.log($$$ARGS)",
    },
    message: "Avoid console.log in production code",
    severity: "warning",
  },
  {
    id: "no-debugger",
    rule: {
      pattern: "debugger",
    },
    message: "Remove debugger statements",
    severity: "error",
  },
  {
    id: "no-var",
    rule: {
      pattern: "var $NAME = $VALUE",
    },
    message: "Use let or const instead of var",
    severity: "warning",
  },
  {
    id: "prefer-const",
    rule: {
      pattern: "let $NAME = $VALUE",
    },
    message: "Consider using const if variable is not reassigned",
    severity: "info",
  },
]

async function main() {
  const targetPath = process.argv[2] || process.cwd()

  console.log("🔍 ast-grep Directory Scanner\n")
  console.log(`Target: ${resolve(targetPath)}`)
  console.log(`Parser directory: ${PARSER_DIR}\n`)

  try {
    await init(PARSER_DIR)
    console.log("✅ Initialized successfully\n")
  } catch (err) {
    console.error(`❌ Failed to initialize: ${err.message}`)
    console.log("\nMake sure PARSER_DIR points to a directory with tree-sitter WASM files")
    process.exit(1)
  }

  console.log(`📋 Rules (${RULES.length}):`)
  for (const rule of RULES) {
    console.log(`  - ${rule.id}: ${rule.message}`)
  }
  console.log()

  console.log("🔎 Scanning...")
  const startTime = Date.now()

  try {
    const results = await scanDirectory(
      {
        path: targetPath,
        language: "typescript", // You can change this or omit for auto-detection
        extensions: [".ts", ".tsx", ".js", ".jsx"],
        ignore: ["node_modules", ".git", "dist", "build", "coverage"],
        recursive: true,
      },
      RULES,
    )

    const elapsed = Date.now() - startTime
    console.log(`\n⏱️ Scan completed in ${elapsed}ms\n`)

    // Summarize results
    let totalMatches = 0
    const matchesByRule = {}

    for (const result of results) {
      for (const [ruleId, matches] of Object.entries(result.matches)) {
        if (matches.length > 0) {
          totalMatches += matches.length
          matchesByRule[ruleId] = (matchesByRule[ruleId] || 0) + matches.length
        }
      }
    }

    if (totalMatches === 0) {
      console.log("✅ No issues found!")
    } else {
      console.log(`📊 Summary: ${totalMatches} issue(s) found in ${results.length} file(s)\n`)

      // Show by rule
      console.log("By rule:")
      for (const [ruleId, count] of Object.entries(matchesByRule)) {
        const rule = RULES.find((r) => r.id === ruleId)
        const icon =
          rule?.severity === "error" ? "❌" : rule?.severity === "warning" ? "⚠️" : "ℹ️"
        console.log(`  ${icon} ${ruleId}: ${count}`)
      }
      console.log()

      // Show detailed results
      console.log("Details:")
      for (const result of results) {
        let hasMatches = false
        for (const [ruleId, matches] of Object.entries(result.matches)) {
          if (matches.length > 0) {
            if (!hasMatches) {
              console.log(`\n📄 ${result.file}`)
              hasMatches = true
            }
            for (const match of matches) {
              const rule = RULES.find((r) => r.id === ruleId)
              const range = match.range
                ? `:${match.range.start.line + 1}:${match.range.start.column + 1}`
                : ""
              console.log(`  [${ruleId}]${range} ${match.text.trim().slice(0, 60)}`)
            }
          }
        }
      }
    }
  } catch (err) {
    console.error(`❌ Scan failed: ${err.message}`)
    process.exit(1)
  }
}

main().catch(console.error)
