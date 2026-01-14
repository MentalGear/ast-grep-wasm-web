import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"
import { readFile, writeFile, rm } from "node:fs/promises"
import fg from "fast-glob"
import { copy, ensureDir, pathExists } from "fs-extra"
import { rimraf } from "rimraf"

const _dirname = fileURLToPath(new URL(".", import.meta.url))

async function build() {
  console.log("\n🚀 Start Building...\n")

  const pkgPath = resolve(_dirname, "../packages/ag-wasm")
  const distPath = resolve(pkgPath, "dist")

  await rimraf(distPath)
  await ensureDir(distPath)

  // Copy WASM build outputs
  const pkgFiles = (
    await fg("pkg/**/*", {
      cwd: resolve(_dirname, ".."),
      ignore: [
        "**/package.json",
        "**/README.md",
        "**/LICENSE",
        "**/.gitignore",
      ],
    })
  ).map((file) => [file, file.replace("pkg/", "")])

  await Promise.all(
    pkgFiles.map(([from, to]) =>
      copy(resolve(_dirname, "..", from), resolve(distPath, to)),
    ),
  )

  // Rename node target files to .cjs for CommonJS compatibility
  const nodeDir = resolve(distPath, "node")
  const nodeJs = resolve(nodeDir, "index.js")
  const nodeCjs = resolve(nodeDir, "index.cjs")
  if (await pathExists(nodeJs)) {
    const content = await readFile(nodeJs, "utf-8")
    await writeFile(nodeCjs, content)
    await rm(nodeJs)
    console.log("Renamed node/index.js to node/index.cjs")
  }

  // Build node-fs module
  console.log("\n📦 Building node-fs module...\n")

  const nodeFsDir = resolve(distPath, "node-fs")
  await ensureDir(nodeFsDir)

  // Compile TypeScript to JavaScript
  const srcPath = resolve(pkgPath, "src/node-fs.ts")
  const outPath = resolve(nodeFsDir, "index.js")
  const dtsPath = resolve(nodeFsDir, "index.d.ts")

  try {
    // Build as CommonJS to match the WASM node target
    const cjsOutPath = resolve(nodeFsDir, "index.cjs")

    execSync(
      `npx esbuild "${srcPath}" --outfile="${cjsOutPath}" --format=cjs --platform=node --target=node18 --external:../node/index.js --bundle`,
      { stdio: "inherit", cwd: resolve(_dirname, "..") },
    )

    // Create ESM wrapper that imports the CJS module
    const esmWrapper = `// ESM wrapper for CommonJS module
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const mod = require("./index.cjs");
export const {
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
  initializeTreeSitter,
  setupParser,
  findNodes,
  fixErrors,
  dumpASTNodes,
  dumpPattern,
} = mod;
export default mod;
`
    await writeFile(outPath, esmWrapper)

    // Generate type declarations
    execSync(
      `npx tsc "${srcPath}" --declaration --emitDeclarationOnly --outDir "${nodeFsDir}" --esModuleInterop --moduleResolution node --module esnext --target esnext`,
      { stdio: "inherit", cwd: resolve(_dirname, "..") },
    )

    // Rename the .d.ts file if it was generated with original name
    const originalDts = resolve(nodeFsDir, "node-fs.d.ts")
    if (await pathExists(originalDts)) {
      const content = await readFile(originalDts, "utf-8")
      await writeFile(dtsPath, content)
      await rm(originalDts)
    }

    console.log("✅ node-fs module built successfully")
  } catch (err) {
    console.error("⚠️ Failed to build node-fs module:", err)
    // Create a fallback JS file that re-exports from node target
    const fallbackContent = `// Fallback: Re-export from node target
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
module.exports = require("../node/index.js");
`
    await writeFile(outPath, fallbackContent)
    console.log("Created fallback node-fs module")
  }

  console.log("\n📦 Finish Building...\n")
}

await build()
