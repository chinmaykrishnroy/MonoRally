import { readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["client/src", "server/src", "scripts", "tests"];
const files = roots.flatMap(listJavaScriptFiles).sort();

for (const file of files) {
  if (file.endsWith("check-syntax.js")) continue;
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`Syntax checked ${files.length} JavaScript files.`);

function listJavaScriptFiles(root) {
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...listJavaScriptFiles(path));
    else if (extname(entry.name) === ".js") result.push(path);
  }
  return result;
}
