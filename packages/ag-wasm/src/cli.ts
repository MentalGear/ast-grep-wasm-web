#!/usr/bin/env node
/**
 * ast-grep WASM CLI
 *
 * Usage (compatible with native ast-grep CLI):
 *   sg scan -r rules.yml ./src           # Scan with rules file
 *   sg run -p 'console.log($A)' ./src    # Search for pattern
 *   sg run -p 'var $X' -r 'let $X' ./src # Search and replace
 *   sg --pattern 'fn()' --lang js ./src  # Pattern with explicit language
 *
 * Commands:
 *   scan    Scan files using rules from a YAML file
 *   run     Run a single pattern/rule against files
 *   parse   Parse and dump AST of a file
 *
 * Options:
 *   -p, --pattern <pattern>   Pattern to search for
 *   -r, --rewrite <rewrite>   Replacement pattern (enables fix mode)
 *   -l, --lang <language>     Language (auto-detected if not specified)
 *   -c, --config <file>       Rules file (YAML)
 *   -i, --interactive         Interactive mode (show diffs)
 *   -U, --update-all          Apply all fixes without prompting
 *   --json                    Output results as JSON
 *   --debug                   Enable debug output
 *   -h, --help                Show help
 */

import { dirname, join } from "node:path"
import { readFile, writeFile, stat, readdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { parse as parseYaml } from "yaml"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load WASM module using createRequire for CJS compatibility in ESM
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const wasm = require(join(__dirname, "../node/index.cjs"))

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_PARSER_DIR =
  process.env.SG_PARSER_DIR || join(__dirname, "../parsers") // Bundled parsers in dist/parsers

const LANG_EXTENSIONS: Record<string, string[]> = {
  javascript: [".js", ".mjs", ".cjs", ".jsx"],
  typescript: [".ts", ".mts", ".cts"],
  tsx: [".tsx"],
  python: [".py"],
  go: [".go"],
  rust: [".rs"],
  java: [".java"],
  c: [".c", ".h"],
  cpp: [".cpp", ".cc", ".hpp", ".cxx"],
  json: [".json"],
  yaml: [".yaml", ".yml"],
  html: [".html", ".htm"],
  css: [".css"],
  ruby: [".rb"],
  php: [".php"],
  swift: [".swift"],
  kotlin: [".kt", ".kts"],
  scala: [".scala", ".sc"],
}

const EXT_TO_LANG: Record<string, string> = {}
for (const [lang, exts] of Object.entries(LANG_EXTENSIONS)) {
  for (const ext of exts) {
    EXT_TO_LANG[ext] = lang
  }
}

const LANG_PARSERS: Record<string, string> = {
  javascript: "tree-sitter-javascript.wasm",
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  python: "tree-sitter-python.wasm",
  go: "tree-sitter-go.wasm",
  rust: "tree-sitter-rust.wasm",
  java: "tree-sitter-java.wasm",
  c: "tree-sitter-c.wasm",
  cpp: "tree-sitter-cpp.wasm",
  json: "tree-sitter-json.wasm",
  yaml: "tree-sitter-yaml.wasm",
  html: "tree-sitter-html.wasm",
  css: "tree-sitter-css.wasm",
  ruby: "tree-sitter-ruby.wasm",
  php: "tree-sitter-php.wasm",
  swift: "tree-sitter-swift.wasm",
  kotlin: "tree-sitter-kotlin.wasm",
  scala: "tree-sitter-scala.wasm",
}

// ============================================================================
// CLI ARGUMENT PARSING
// ============================================================================

interface Args {
  command: string | null
  pattern: string | null
  rewrite: string | null
  language: string | null
  rulesFile: string | null
  parserDir: string
  paths: string[]
  json: boolean
  debug: boolean
  interactive: boolean
  updateAll: boolean
  help: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: null,
    pattern: null,
    rewrite: null,
    language: null,
    rulesFile: null,
    parserDir: DEFAULT_PARSER_DIR,
    paths: [],
    json: false,
    debug: false,
    interactive: false,
    updateAll: false,
    help: false,
  }

  let i = 2 // Skip 'node' and script name
  while (i < argv.length) {
    const arg = argv[i]

    if (arg === "-h" || arg === "--help") {
      args.help = true
      i++
    } else if (arg === "-p" || arg === "--pattern") {
      args.pattern = argv[++i]
      i++
    } else if (arg === "-r" || arg === "--rewrite") {
      args.rewrite = argv[++i]
      i++
    } else if (arg === "-l" || arg === "--lang" || arg === "--language") {
      args.language = argv[++i]
      i++
    } else if (arg === "--rule" || arg === "-c" || arg === "--config") {
      args.rulesFile = argv[++i]
      i++
    } else if (arg === "--parser-dir") {
      args.parserDir = argv[++i]
      i++
    } else if (arg === "--json") {
      args.json = true
      i++
    } else if (arg === "--debug") {
      args.debug = true
      i++
    } else if (arg === "-i" || arg === "--interactive") {
      args.interactive = true
      i++
    } else if (arg === "-U" || arg === "--update-all") {
      args.updateAll = true
      i++
    } else if (arg === "scan" || arg === "run" || arg === "parse") {
      args.command = arg
      i++
    } else if (!arg.startsWith("-")) {
      args.paths.push(arg)
      i++
    } else {
      console.error(`Unknown option: ${arg}`)
      i++
    }
  }

  // Default command based on args
  if (!args.command) {
    if (args.rulesFile) {
      args.command = "scan"
    } else if (args.pattern) {
      args.command = "run"
    }
  }

  // Default path to current directory
  if (args.paths.length === 0) {
    args.paths.push(".")
  }

  return args
}

function showHelp(): void {
  console.log(`
ast-grep WASM CLI

USAGE:
  sg <COMMAND> [OPTIONS] [PATH...]
  ast-grep <COMMAND> [OPTIONS] [PATH...]

COMMANDS:
  scan        Scan files using rules from a YAML file
  run         Run a single pattern against files
  parse       Parse and dump AST of a file

OPTIONS:
  -p, --pattern <PATTERN>     Pattern to search for
  -r, --rewrite <REWRITE>     Replacement pattern (enables fix mode)
  -l, --lang <LANGUAGE>       Language (js, ts, tsx, py, go, rust, etc.)
  -c, --config <FILE>         Rules file (YAML)
  --rule <FILE>               Alias for --config
  --parser-dir <DIR>          Directory with tree-sitter WASM parsers
  -i, --interactive           Interactive mode with diffs
  -U, --update-all            Apply all fixes without prompting
  --json                      Output as JSON
  --debug                     Show debug information
  -h, --help                  Show this help

EXAMPLES:
  # Search for console.log calls
  sg run -p 'console.log($$$ARGS)' ./src

  # Replace var with let
  sg run -p 'var $X = $Y' -r 'let $X = $Y' -l typescript ./src

  # Scan with rules file
  sg scan -c rules.yml ./src

  # Parse and show AST
  sg parse ./src/index.ts

ENVIRONMENT:
  SG_PARSER_DIR    Directory containing tree-sitter WASM parsers
                   (default: <package>/parsers)

SUPPORTED LANGUAGES:
  javascript, typescript, tsx, python, go, rust, java, c, cpp,
  json, yaml, html, css, ruby, php, swift, kotlin, scala
`)
}

// ============================================================================
// UTILITIES
// ============================================================================

function detectLanguage(filePath: string): string | null {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase()
  return EXT_TO_LANG[ext] || null
}

async function setupLanguage(lang: string, parserDir: string): Promise<void> {
  const parserFile = LANG_PARSERS[lang]
  if (!parserFile) {
    throw new Error(`Unsupported language: ${lang}`)
  }
  const parserPath = join(parserDir, parserFile)
  await wasm.setupParser(lang, parserPath)
}

async function collectFiles(
  dir: string,
  language: string | null,
  recursive = true,
): Promise<string[]> {
  const files: string[] = []
  const extensions = language
    ? LANG_EXTENSIONS[language] || []
    : Object.values(LANG_EXTENSIONS).flat()

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name)

      // Skip common ignore patterns
      if (
        entry.name.startsWith(".") ||
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "build" ||
        entry.name === "target"
      ) {
        continue
      }

      if (entry.isDirectory() && recursive) {
        await walk(fullPath)
      } else if (entry.isFile()) {
        const ext = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase()
        if (extensions.length === 0 || extensions.includes(ext)) {
          files.push(fullPath)
        }
      }
    }
  }

  const stats = await stat(dir)
  if (stats.isFile()) {
    return [dir]
  }

  await walk(dir)
  return files
}

// Output colors
const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
}

function colorize(text: string, color: keyof typeof COLORS): string {
  if (!process.stdout.isTTY) return text
  return `${COLORS[color]}${text}${COLORS.reset}`
}

function formatDiff(original: string, fixed: string): string {
  const origLines = original.split("\n")
  const fixedLines = fixed.split("\n")
  const output: string[] = []

  const maxLines = Math.max(origLines.length, fixedLines.length)
  for (let i = 0; i < maxLines; i++) {
    const origLine = origLines[i]
    const fixedLine = fixedLines[i]

    if (origLine !== fixedLine) {
      if (origLine !== undefined) {
        output.push(colorize(`- ${origLine}`, "red"))
      }
      if (fixedLine !== undefined) {
        output.push(colorize(`+ ${fixedLine}`, "green"))
      }
    }
  }

  return output.join("\n")
}

// ============================================================================
// COMMANDS
// ============================================================================

interface RuleConfig {
  id: string
  language?: string
  rule: { pattern?: string; kind?: string; regex?: string }
  fix?: string
  message?: string
  severity?: string
}

async function runScan(args: Args): Promise<void> {
  if (!args.rulesFile) {
    console.error("Error: scan command requires --config/-c <rules.yml>")
    process.exit(1)
  }

  // Load rules from YAML file
  const rulesContent = await readFile(args.rulesFile, "utf-8")
  const rulesData = parseYaml(rulesContent) as
    | { rules?: RuleConfig[] }
    | RuleConfig
  const rules: RuleConfig[] =
    "rules" in rulesData && rulesData.rules
      ? rulesData.rules
      : [rulesData as RuleConfig]

  let totalMatches = 0
  const results: Array<{ file: string; rule: string; count: number }> = []

  for (const targetPath of args.paths) {
    const files = await collectFiles(targetPath, args.language)

    for (const file of files) {
      const lang = args.language || detectLanguage(file)
      if (!lang) continue

      try {
        await setupLanguage(lang, args.parserDir)
        const content = await readFile(file, "utf-8")

        // Add language to rules if not present
        const rulesWithLang = rules.map((r) => ({
          ...r,
          language: r.language || lang,
        }))

        if (args.updateAll && rules.some((r) => r.fix)) {
          // Apply fixes
          const fixed = wasm.fixErrors(content, rulesWithLang)
          if (fixed !== content) {
            await writeFile(file, fixed, "utf-8")
            console.log(colorize(`Fixed: ${file}`, "green"))
          }
        } else {
          // Report matches using marker detection
          for (const rule of rulesWithLang) {
            const markerRule = {
              ...rule,
              fix: `/*__SG_MATCH__${rule.id}__*/` + (rule.fix || "$$$"),
            }
            const markedCode = wasm.fixErrors(content, [markerRule])
            const marker = `/*__SG_MATCH__${rule.id}__*/`
            const markerRegex = new RegExp(
              marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
              "g",
            )
            const matchCount = (markedCode.match(markerRegex) || []).length

            if (matchCount > 0) {
              totalMatches += matchCount

              if (args.json) {
                results.push({ file, rule: rule.id, count: matchCount })
              } else {
                console.log(
                  `${colorize(file, "magenta")}: ${rule.id} (${matchCount} match${matchCount > 1 ? "es" : ""})`,
                )
                if (rule.message) {
                  console.log(`  ${colorize(rule.message, "yellow")}`)
                }
              }
            }
          }
        }
      } catch (err) {
        if (args.debug) {
          console.error(`Error processing ${file}:`, err)
        }
      }
    }
  }

  if (args.json) {
    console.log(
      JSON.stringify({ matches: results, total: totalMatches }, null, 2),
    )
  } else {
    console.log()
    console.log(`Total: ${totalMatches} match${totalMatches !== 1 ? "es" : ""}`)
  }
}

async function runPattern(args: Args): Promise<void> {
  if (!args.pattern) {
    console.error("Error: run command requires --pattern/-p <pattern>")
    process.exit(1)
  }

  const rule: RuleConfig = {
    id: "pattern",
    language: args.language || "typescript",
    rule: { pattern: args.pattern },
  }

  if (args.rewrite) {
    rule.fix = args.rewrite
  }

  let totalMatches = 0
  let totalFiles = 0
  const results: Array<{ file: string; count: number }> = []

  for (const targetPath of args.paths) {
    const files = await collectFiles(targetPath, args.language)

    for (const file of files) {
      const lang = args.language || detectLanguage(file)
      if (!lang) continue

      try {
        await setupLanguage(lang, args.parserDir)
        const content = await readFile(file, "utf-8")
        rule.language = lang

        if (args.rewrite && args.updateAll) {
          // Apply rewrite
          const fixed = wasm.fixErrors(content, [rule])
          if (fixed !== content) {
            await writeFile(file, fixed, "utf-8")
            console.log(colorize(`Fixed: ${file}`, "green"))
            totalFiles++
          }
        } else if (args.rewrite && args.interactive) {
          // Show diff
          const fixed = wasm.fixErrors(content, [rule])
          if (fixed !== content) {
            console.log(colorize(`\n--- ${file}`, "bold"))
            console.log(formatDiff(content, fixed))
          }
        } else {
          // Search only - use marker detection
          const markerRule = {
            ...rule,
            fix: "/*__SG_MATCH__*/" + args.pattern,
          }
          const markedCode = wasm.fixErrors(content, [markerRule])
          const marker = "/*__SG_MATCH__*/"
          const markerRegex = new RegExp(
            marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            "g",
          )
          const matches = markedCode.match(markerRegex) || []

          if (matches.length > 0) {
            totalMatches += matches.length
            totalFiles++

            if (args.json) {
              results.push({ file, count: matches.length })
            } else {
              // Display matched file and lines
              const lines = content.split("\n")
              console.log(colorize(file, "magenta"))

              // Show lines containing pattern keywords
              const patternWords = args.pattern.match(/[a-zA-Z_]\w*/g) || []
              const keyWord = patternWords.find((w) => !w.startsWith("$"))
              if (keyWord) {
                for (let i = 0; i < lines.length; i++) {
                  if (lines[i].includes(keyWord)) {
                    console.log(
                      `  ${colorize(String(i + 1).padStart(4), "dim")}│ ${lines[i]}`,
                    )
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        if (args.debug) {
          console.error(`Error processing ${file}:`, err)
        }
      }
    }
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        { matches: results, total: totalMatches, files: totalFiles },
        null,
        2,
      ),
    )
  } else {
    console.log()
    if (args.rewrite && args.updateAll) {
      console.log(`Fixed ${totalFiles} file${totalFiles !== 1 ? "s" : ""}`)
    } else {
      console.log(
        `Found ${totalMatches} match${totalMatches !== 1 ? "es" : ""} in ${totalFiles} file${totalFiles !== 1 ? "s" : ""}`,
      )
    }
  }
}

async function runParse(args: Args): Promise<void> {
  if (args.paths.length === 0 || args.paths[0] === ".") {
    console.error("Error: parse command requires a file path")
    process.exit(1)
  }

  const file = args.paths[0]
  const lang = args.language || detectLanguage(file)

  if (!lang) {
    console.error(
      `Error: Cannot detect language for ${file}. Use --lang to specify.`,
    )
    process.exit(1)
  }

  await setupLanguage(lang, args.parserDir)
  const content = await readFile(file, "utf-8")
  const ast = wasm.dumpASTNodes(content)

  if (args.json) {
    console.log(JSON.stringify(ast, null, 2))
  } else {
    console.log(ast)
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv)

  if (args.help || !args.command) {
    showHelp()
    process.exit(args.help ? 0 : 1)
  }

  if (args.debug) {
    console.log("Args:", args)
    console.log("Parser dir:", args.parserDir)
  }

  // Initialize WASM
  await wasm.initializeTreeSitter()

  switch (args.command) {
    case "scan":
      await runScan(args)
      break
    case "run":
      await runPattern(args)
      break
    case "parse":
      await runParse(args)
      break
    default:
      console.error(`Unknown command: ${args.command}`)
      showHelp()
      process.exit(1)
  }
}

main().catch((err: Error) => {
  console.error("Error:", err.message)
  if (process.env.DEBUG) {
    console.error(err.stack)
  }
  process.exit(1)
})
