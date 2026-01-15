// Sample TypeScript file for ast-grep playground

// Console logging examples
console.log("Hello, World!");
console.log("User:", userName, "Age:", userAge);
console.warn("This is a warning");
console.error("This is an error");

// Variable declarations
const API_URL = "https://api.example.com";
const MAX_RETRIES = 3;
let counter = 0;
var legacyVar = "should use let/const";

// Function declarations
function greet(name: string): string {
  console.log("Greeting:", name);
  return `Hello, ${name}!`;
}

async function fetchData(url: string): Promise<any> {
  console.log("Fetching:", url);
  const response = await fetch(url);
  return response.json();
}

// Arrow functions
const add = (a: number, b: number) => a + b;
const multiply = (a: number, b: number) => {
  console.log("Multiplying", a, "by", b);
  return a * b;
};

// Class example
class UserService {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    console.log("UserService initialized with:", baseUrl);
  }

  async getUser(id: number): Promise<User> {
    console.log("Getting user:", id);
    return fetchData(`${this.baseUrl}/users/${id}`);
  }
}

// Interface
interface User {
  id: number;
  name: string;
  email: string;
}

// Type alias
type UserCallback = (user: User) => void;

// Export
export { greet, fetchData, UserService };
export type { User, UserCallback };
