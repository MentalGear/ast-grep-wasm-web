const wasm = require("../packages/ag-wasm/dist/node/index.cjs")

async function test() {
  await wasm.initializeTreeSitter()
  await wasm.setupParser("typescript", "./parsers/tree-sitter-typescript.wasm")

  const code = "var x = 1;"
  const rule = {
    id: "no-var",
    language: "typescript",
    rule: { pattern: "var $NAME = $VALUE" },
    fix: "/*LINT:var*/var $NAME = $VALUE",
  }

  const markedCode = wasm.fixErrors(code, [rule])
  console.log("Original:", code)
  console.log("Marked:", markedCode)
  console.log("Has marker:", markedCode.includes("/*LINT:var*/"))
}

test().catch(console.error)
