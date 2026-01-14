#!/usr/bin/env node

/**
 * Download tree-sitter parser WASM files
 *
 * These files are required to parse different programming languages.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import https from "node:https"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PARSERS_DIR = join(__dirname, "parsers")

// Tree-sitter WASM files from ast-grep's releases
const PARSER_BASE_URL = "https://raw.githubusercontent.com/AstGrep/tree-sitter-wasm/main/parsers"

const PARSERS = [
  "tree-sitter-typescript.wasm",
  "tree-sitter-javascript.wasm",
  "tree-sitter-tsx.wasm",
  "tree-sitter-python.wasm",
  "tree-sitter-rust.wasm",
  "tree-sitter-go.wasm",
  "tree-sitter-json.wasm",
]

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        https.get(response.headers.location, (res) => {
          const chunks = []
          res.on("data", chunk => chunks.push(chunk))
          res.on("end", () => {
            const buffer = Buffer.concat(chunks)
            writeFile(destPath, buffer).then(resolve).catch(reject)
          })
          res.on("error", reject)
        }).on("error", reject)
        return
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} for ${url}`))
        return
      }

      const chunks = []
      response.on("data", chunk => chunks.push(chunk))
      response.on("end", () => {
        const buffer = Buffer.concat(chunks)
        writeFile(destPath, buffer).then(resolve).catch(reject)
      })
      response.on("error", reject)
    }).on("error", reject)
  })
}

async function main() {
  console.log("📦 Downloading tree-sitter parser WASM files...\n")

  await mkdir(PARSERS_DIR, { recursive: true })

  for (const parser of PARSERS) {
    const url = `${PARSER_BASE_URL}/${parser}`
    const destPath = join(PARSERS_DIR, parser)

    process.stdout.write(`  Downloading ${parser}... `)
    try {
      await downloadFile(url, destPath)
      console.log("✓")
    } catch (err) {
      console.log(`✗ (${err.message})`)
    }
  }

  console.log("\n✅ Done! Parsers saved to:", PARSERS_DIR)
  console.log("\nYou can now run: node playground.js")
}

main().catch(console.error)
