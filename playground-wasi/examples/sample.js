// Sample JavaScript file for ast-grep playground

// Console logging examples
console.log("JavaScript example");
console.log("Multiple", "arguments", 123);
console.debug("Debug message");

// Variable declarations - mix of var, let, const
var oldStyle = "legacy variable";
var anotherOld = 42;
let modern = "modern variable";
const CONSTANT = "immutable";

// Function declarations
function processData(data) {
  console.log("Processing:", data);
  return data.map(item => item * 2);
}

function validateInput(input) {
  if (!input) {
    console.error("Invalid input!");
    return false;
  }
  console.log("Input valid:", input);
  return true;
}

// Arrow functions
const double = x => x * 2;
const sumArray = arr => arr.reduce((a, b) => a + b, 0);

// Object and array patterns
const config = {
  apiUrl: "https://api.example.com",
  timeout: 5000,
  retries: 3
};

const users = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" }
];

// Async/await
async function loadUsers() {
  console.log("Loading users...");
  const response = await fetch("/api/users");
  const data = await response.json();
  console.log("Loaded", data.length, "users");
  return data;
}

// Export
module.exports = { processData, validateInput, loadUsers };
