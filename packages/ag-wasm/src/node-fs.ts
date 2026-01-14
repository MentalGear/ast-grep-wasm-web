/**
 * Node.js Filesystem (NODEFS) wrapper for ast-grep WASM
 *
 * This module provides filesystem access for ast-grep WASM in Node.js environments.
 * It wraps the core WASM functions and adds file/directory scanning capabilities.
 */

import { readFile, readdir, stat } from "node:fs/promises"
import { join, extname, resolve, dirname } from "node:path"

// Use __dirname for CommonJS compatibility
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - __dirname is available in CJS context
const currentDir = typeof __dirname !== "undefined" ? __dirname : dirname(new URL(import.meta.url).pathname)

// Import the Node.js WASM module
// eslint-disable-next-line @typescript-eslint/no-var-requires
const wasm = require(join(currentDir, "../node/index.cjs"))

// Re-export core WASM functions
export const {
  initializeTreeSitter,
  setupParser,
  findNodes,
  fixErrors,
  dumpASTNodes,
  dumpPattern,
} = wasm

// Language to file extension mapping
const LANG_EXTENSIONS: Record<string, string[]> = {
  javascript: [".js", ".mjs", ".cjs"],
  typescript: [".ts", ".mts", ".cts"],
  tsx: [".tsx"],
  bash: [".sh", ".bash"],
  c: [".c", ".h"],
  cpp: [".cpp", ".cc", ".cxx", ".hpp", ".hxx", ".h"],
  csharp: [".cs"],
  css: [".css"],
  elixir: [".ex", ".exs"],
  go: [".go"],
  html: [".html", ".htm"],
  java: [".java"],
  json: [".json"],
  kotlin: [".kt", ".kts"],
  php: [".php"],
  python: [".py", ".pyw"],
  ruby: [".rb"],
  rust: [".rs"],
  scala: [".scala", ".sc"],
  swift: [".swift"],
  yaml: [".yaml", ".yml"],
}

// Extension to language mapping (reverse lookup)
const EXT_TO_LANG: Record<string, string> = {}
for (const [lang, exts] of Object.entries(LANG_EXTENSIONS)) {
  for (const ext of exts) {
    EXT_TO_LANG[ext] = lang
  }
}

// Language to parser WASM filename mapping
const LANG_PARSER_FILES: Record<string, string> = {
  javascript: "tree-sitter-javascript.wasm",
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  bash: "tree-sitter-bash.wasm",
  c: "tree-sitter-c.wasm",
  cpp: "tree-sitter-cpp.wasm",
  csharp: "tree-sitter-c-sharp.wasm",
  css: "tree-sitter-css.wasm",
  elixir: "tree-sitter-elixir.wasm",
  go: "tree-sitter-go.wasm",
  html: "tree-sitter-html.wasm",
  java: "tree-sitter-java.wasm",
  json: "tree-sitter-json.wasm",
  kotlin: "tree-sitter-kotlin.wasm",
  php: "tree-sitter-php.wasm",
  python: "tree-sitter-python.wasm",
  ruby: "tree-sitter-ruby.wasm",
  rust: "tree-sitter-rust.wasm",
  scala: "tree-sitter-scala.wasm",
  swift: "tree-sitter-swift.wasm",
  yaml: "tree-sitter-yaml.wasm",
}

export interface ScanOptions {
  /** Directory or file path to scan */
  path: string
  /** Language to use (auto-detected from extension if not specified) */
  language?: string
  /** File extensions to include (defaults to language extensions) */
  extensions?: string[]
  /** Patterns to ignore (glob patterns) */
  ignore?: string[]
  /** Whether to scan recursively (default: true) */
  recursive?: boolean
}

export interface RuleConfig {
  id: string
  rule: {
    pattern?: string
    kind?: string
    regex?: string
    all?: RuleConfig["rule"][]
    any?: RuleConfig["rule"][]
    not?: RuleConfig["rule"]
    inside?: RuleConfig["rule"]
    has?: RuleConfig["rule"]
    follows?: RuleConfig["rule"]
    precedes?: RuleConfig["rule"]
  }
  fix?: string
  message?: string
  severity?: "error" | "warning" | "info" | "hint"
}

export interface FileMatch {
  file: string
  matches: Record<string, MatchResult[]>
}

export interface MatchResult {
  text: string
  range: {
    start: { line: number; column: number }
    end: { line: number; column: number }
  }
  message?: string
}

export interface FixResult {
  file: string
  original: string
  fixed: string
  changed: boolean
}

let initialized = false
let currentParserDir: string | null = null

/**
 * Initialize the ast-grep WASM module
 * @param parserDir - Directory containing tree-sitter parser WASM files
 */
export async function init(parserDir?: string): Promise<void> {
  if (!initialized) {
    await initializeTreeSitter()
    initialized = true
  }
  if (parserDir) {
    currentParserDir = resolve(parserDir)
  }
}

/**
 * Set the parser directory for loading tree-sitter WASM files
 * @param dir - Directory containing tree-sitter parser WASM files
 */
export function setParserDir(dir: string): void {
  currentParserDir = resolve(dir)
}

/**
 * Get the parser WASM file path for a language
 * @param language - Language name
 * @returns Full path to the parser WASM file
 */
function getParserPath(language: string): string {
  if (!currentParserDir) {
    throw new Error(
      "Parser directory not set. Call init(parserDir) or setParserDir(dir) first.",
    )
  }
  const parserFile = LANG_PARSER_FILES[language]
  if (!parserFile) {
    throw new Error(`No parser file configured for language: ${language}`)
  }
  return join(currentParserDir, parserFile)
}

/**
 * Setup parser for a specific language
 * @param language - Language name (e.g., 'typescript', 'javascript')
 */
export async function setupLanguage(language: string): Promise<void> {
  if (!initialized) {
    throw new Error("WASM not initialized. Call init() first.")
  }
  const parserPath = getParserPath(language)
  await setupParser(language, parserPath)
}

/**
 * Detect language from file extension
 * @param filePath - File path
 * @returns Detected language or null if unknown
 */
export function detectLanguage(filePath: string): string | null {
  const ext = extname(filePath).toLowerCase()
  return EXT_TO_LANG[ext] || null
}

/**
 * Get supported extensions for a language
 * @param language - Language name
 * @returns Array of file extensions
 */
export function getExtensions(language: string): string[] {
  return LANG_EXTENSIONS[language] || []
}

/**
 * Get all supported languages
 * @returns Array of supported language names
 */
export function getSupportedLanguages(): string[] {
  return Object.keys(LANG_EXTENSIONS)
}

/**
 * Read a file and return its content
 * @param filePath - Path to the file
 * @returns File content as string
 */
export async function readSourceFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf-8")
}

/**
 * Scan a single file for pattern matches
 * @param filePath - Path to the file
 * @param rules - Rule configurations
 * @param language - Language (auto-detected if not specified)
 * @returns Match results
 */
export async function scanFile(
  filePath: string,
  rules: RuleConfig[],
  language?: string,
): Promise<FileMatch> {
  const lang = language || detectLanguage(filePath)
  if (!lang) {
    throw new Error(`Cannot detect language for file: ${filePath}`)
  }

  await setupLanguage(lang)
  const content = await readSourceFile(filePath)
  const matches = findNodes(content, rules)

  return {
    file: filePath,
    matches,
  }
}

/**
 * Collect files from a directory
 * @param dir - Directory path
 * @param extensions - File extensions to include
 * @param recursive - Whether to scan recursively
 * @param ignore - Patterns to ignore
 * @returns Array of file paths
 */
async function collectFiles(
  dir: string,
  extensions: string[],
  recursive: boolean,
  ignore: string[] = [],
): Promise<string[]> {
  const files: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)

    // Check ignore patterns
    const shouldIgnore = ignore.some((pattern) => {
      if (pattern.startsWith("*")) {
        return entry.name.endsWith(pattern.slice(1))
      }
      return entry.name === pattern || fullPath.includes(pattern)
    })

    if (shouldIgnore) continue

    if (entry.isDirectory() && recursive) {
      const subFiles = await collectFiles(fullPath, extensions, recursive, ignore)
      files.push(...subFiles)
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase()
      if (extensions.length === 0 || extensions.includes(ext)) {
        files.push(fullPath)
      }
    }
  }

  return files
}

/**
 * Scan a directory for pattern matches
 * @param options - Scan options
 * @param rules - Rule configurations
 * @returns Array of file matches
 */
export async function scanDirectory(
  options: ScanOptions,
  rules: RuleConfig[],
): Promise<FileMatch[]> {
  const {
    path: targetPath,
    language,
    extensions,
    ignore = ["node_modules", ".git", "dist", "build"],
    recursive = true,
  } = options

  const stats = await stat(targetPath)

  if (stats.isFile()) {
    return [await scanFile(targetPath, rules, language)]
  }

  // Determine extensions to scan
  let exts = extensions || []
  if (exts.length === 0 && language) {
    exts = getExtensions(language)
  }

  const files = await collectFiles(targetPath, exts, recursive, ignore)
  const results: FileMatch[] = []

  // Group files by language for efficient parser switching
  const filesByLang: Record<string, string[]> = {}
  for (const file of files) {
    const lang = language || detectLanguage(file)
    if (lang) {
      if (!filesByLang[lang]) {
        filesByLang[lang] = []
      }
      filesByLang[lang].push(file)
    }
  }

  // Process files grouped by language
  for (const [lang, langFiles] of Object.entries(filesByLang)) {
    await setupLanguage(lang)

    for (const file of langFiles) {
      try {
        const content = await readSourceFile(file)
        const matches = findNodes(content, rules)
        results.push({ file, matches })
      } catch (err) {
        console.error(`Error scanning file ${file}:`, err)
      }
    }
  }

  return results
}

/**
 * Fix patterns in a single file
 * @param filePath - Path to the file
 * @param rules - Rule configurations with fix patterns
 * @param language - Language (auto-detected if not specified)
 * @returns Fix result
 */
export async function fixFile(
  filePath: string,
  rules: RuleConfig[],
  language?: string,
): Promise<FixResult> {
  const lang = language || detectLanguage(filePath)
  if (!lang) {
    throw new Error(`Cannot detect language for file: ${filePath}`)
  }

  await setupLanguage(lang)
  const original = await readSourceFile(filePath)
  const fixed = fixErrors(original, rules)

  return {
    file: filePath,
    original,
    fixed,
    changed: original !== fixed,
  }
}

/**
 * Fix patterns in a directory
 * @param options - Scan options
 * @param rules - Rule configurations with fix patterns
 * @returns Array of fix results
 */
export async function fixDirectory(
  options: ScanOptions,
  rules: RuleConfig[],
): Promise<FixResult[]> {
  const {
    path: targetPath,
    language,
    extensions,
    ignore = ["node_modules", ".git", "dist", "build"],
    recursive = true,
  } = options

  const stats = await stat(targetPath)

  if (stats.isFile()) {
    return [await fixFile(targetPath, rules, language)]
  }

  // Determine extensions to scan
  let exts = extensions || []
  if (exts.length === 0 && language) {
    exts = getExtensions(language)
  }

  const files = await collectFiles(targetPath, exts, recursive, ignore)
  const results: FixResult[] = []

  // Group files by language for efficient parser switching
  const filesByLang: Record<string, string[]> = {}
  for (const file of files) {
    const lang = language || detectLanguage(file)
    if (lang) {
      if (!filesByLang[lang]) {
        filesByLang[lang] = []
      }
      filesByLang[lang].push(file)
    }
  }

  // Process files grouped by language
  for (const [lang, langFiles] of Object.entries(filesByLang)) {
    await setupLanguage(lang)

    for (const file of langFiles) {
      try {
        const original = await readSourceFile(file)
        const fixed = fixErrors(original, rules)
        results.push({
          file,
          original,
          fixed,
          changed: original !== fixed,
        })
      } catch (err) {
        console.error(`Error fixing file ${file}:`, err)
      }
    }
  }

  return results
}

/**
 * Parse a file and return its AST
 * @param filePath - Path to the file
 * @param language - Language (auto-detected if not specified)
 * @returns AST dump
 */
export async function parseFile(
  filePath: string,
  language?: string,
): Promise<unknown> {
  const lang = language || detectLanguage(filePath)
  if (!lang) {
    throw new Error(`Cannot detect language for file: ${filePath}`)
  }

  await setupLanguage(lang)
  const content = await readSourceFile(filePath)
  return dumpASTNodes(content)
}

/**
 * Parse source code string and return its AST
 * @param source - Source code string
 * @param language - Language name
 * @returns AST dump
 */
export async function parseSource(
  source: string,
  language: string,
): Promise<unknown> {
  await setupLanguage(language)
  return dumpASTNodes(source)
}

// Default export with all functions
export default {
  init,
  setParserDir,
  setupLanguage,
  detectLanguage,
  getExtensions,
  getSupportedLanguages,
  readSourceFile,
  scanFile,
  scanDirectory,
  fixFile,
  fixDirectory,
  parseFile,
  parseSource,
  // Re-exported WASM functions
  initializeTreeSitter,
  setupParser,
  findNodes,
  fixErrors,
  dumpASTNodes,
  dumpPattern,
}
