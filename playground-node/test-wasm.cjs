const wasm = require("../packages/ag-wasm/dist/node/index.cjs")

async function test() {
  await wasm.initializeTreeSitter()
  await wasm.setupParser("typescript", "./parsers/tree-sitter-typescript.wasm")

  const code = "var x = 1;"

  const rules = [
    {
      id: "test",
      language: "typescript",
      rule: { pattern: "var $NAME = $VALUE" },
    },
  ]

  console.log("Testing findNodes directly...")
  const result = wasm.findNodes(code, rules)
  console.log("Result:", JSON.stringify(result, null, 2))

  console.log("\nTesting fixErrors directly...")
  const rules2 = [
    {
      id: "test",
      language: "typescript",
      rule: { pattern: "var $NAME = $VALUE" },
      fix: "const $NAME = $VALUE",
    },
  ]
  const fixed = wasm.fixErrors(code, rules2)
  console.log("Fixed:", fixed)
}

test().catch(console.error)
