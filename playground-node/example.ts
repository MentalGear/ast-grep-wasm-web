// Example TypeScript file for ast-grep playground
// This file contains various patterns to demonstrate linting, search, and replace

// Bad patterns that should be caught by linting rules:
var oldStyleVar = "should use const or let"
console.log("debug message", oldStyleVar)
debugger

// Function with console.log
function processData(data: any) {
  console.log("Processing:", data)
  var result = data.map((item: any) => item.value)
  return result
}

// Arrow function with var
const calculate = (a: number, b: number) => {
  var sum = a + b
  console.log("Sum:", sum)
  return sum
}

// Class with deprecated patterns
class UserService {
  private users: any[] = []

  addUser(user: any) {
    console.log("Adding user:", user)
    var id = Math.random()
    this.users.push({ ...user, id })
  }

  getUser(id: number) {
    var found = this.users.find((u) => u.id === id)
    return found
  }
}

// Promise without proper error handling
async function fetchData(url: string) {
  var response = await fetch(url)
  console.log("Fetched:", url)
  return response.json()
}

// Export for module
export { processData, calculate, UserService, fetchData }
