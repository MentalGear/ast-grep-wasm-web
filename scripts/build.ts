import { execSync } from "node:child_process"
import { readFile, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
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
    let content = await readFile(nodeJs, "utf-8")
    // Patch to use web-tree-sitter shim for proper module compatibility
    content = content.replace(
      "require(`web-tree-sitter`)",
      "require('./../web-tree-sitter-shim.cjs')",
    )
    await writeFile(nodeCjs, content)
    await rm(nodeJs)
    console.log("Renamed node/index.js to node/index.cjs (with shim patch)")
  }

  // Create web-tree-sitter shim for Node.js compatibility
  const shimContent = `// Shim to make web-tree-sitter compatible with wasm-bindgen generated code
// web-tree-sitter exports Parser directly, Language is available after init()

const Parser = require('web-tree-sitter');

// Create a proxy for Language that will be populated after Parser.init()
let _Language = null;

const LanguageProxy = new Proxy({}, {
  get(target, prop) {
    if (!_Language) {
      throw new Error('Parser.init() must be called before using Language');
    }
    return _Language[prop];
  }
});

// Wrap Parser.init to capture Language reference
const originalInit = Parser.init.bind(Parser);
Parser.init = async function(...args) {
  const result = await originalInit(...args);
  _Language = Parser.Language;
  return result;
};

module.exports = {
  Parser,
  Language: LanguageProxy
};
`
  await writeFile(resolve(distPath, "web-tree-sitter-shim.cjs"), shimContent)
  console.log("Created web-tree-sitter-shim.cjs")

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

  // Build CLI
  console.log("\n📦 Building CLI...\n")

  const cliDir = resolve(distPath, "cli")
  await ensureDir(cliDir)

  const cliSrcPath = resolve(pkgPath, "src/cli.ts")
  const cliOutPath = resolve(cliDir, "cli.js")

  try {
    // Build CLI - don't bundle WASM module, it's loaded at runtime via createRequire
    execSync(
      `npx esbuild "${cliSrcPath}" --outfile="${cliOutPath}" --format=esm --platform=node --target=node18 --bundle --external:yaml --external:node:module --external:node:path --external:node:fs/promises --external:node:url`,
      { stdio: "inherit", cwd: resolve(_dirname, "..") },
    )

    // Add shebang to CLI
    let cliContent = await readFile(cliOutPath, "utf-8")
    if (!cliContent.startsWith("#!/usr/bin/env node")) {
      cliContent = `#!/usr/bin/env node\n${cliContent}`
      await writeFile(cliOutPath, cliContent)
    }

    // Make CLI executable
    execSync(`chmod +x "${cliOutPath}"`, { stdio: "inherit" })

    console.log("✅ CLI built successfully")
  } catch (err) {
    console.error("⚠️ Failed to build CLI:", err)
  }

  // Copy parsers from playground-node to dist
  console.log("\n📦 Copying parsers...\n")

  const parsersDir = resolve(pkgPath, "dist/parsers")
  const srcParsersDir = resolve(_dirname, "../playground-node/parsers")

  if (await pathExists(srcParsersDir)) {
    await copy(srcParsersDir, parsersDir)
    console.log("✅ Parsers copied successfully")
  } else {
    console.log("⚠️ No parsers found in playground-node/parsers")
  }

  // Build and copy WASI CLI if target is available
  console.log("\n📦 Building WASI CLI...\n")

  try {
    execSync(`cargo build --target wasm32-wasip1 --release --bin sg-wasi`, {
      stdio: "inherit",
      cwd: resolve(_dirname, ".."),
    })

    const wasiSrc = resolve(
      _dirname,
      "../target/wasm32-wasip1/release/sg-wasi.wasm",
    )
    const wasiDest = resolve(distPath, "wasi/sg-wasi.wasm")
    await ensureDir(resolve(distPath, "wasi"))
    await copy(wasiSrc, wasiDest)
    console.log("✅ WASI CLI built and copied successfully")
  } catch {
    console.log("⚠️ WASI build skipped (target may not be installed)")
  }

  console.log("\n📦 Finish Building...\n")
}

await build()
