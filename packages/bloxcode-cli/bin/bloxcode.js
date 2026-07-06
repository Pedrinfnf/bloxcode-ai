#!/usr/bin/env node
// BloxCode CLI — launches TypeScript entry point via tsx
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(__dirname, "..", "src", "index.ts");

try {
  // Try tsx first (dev mode)
  execFileSync("npx", ["tsx", entry], { stdio: "inherit", cwd: process.cwd() });
} catch {
  // Fallback to node with --loader
  execFileSync("node", ["--import", "tsx", entry], { stdio: "inherit", cwd: process.cwd() });
}
