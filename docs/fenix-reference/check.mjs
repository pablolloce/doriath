import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

async function findModules(directory, results = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    // dist/ es una copia del propio codigo hecha por scripts/build-dist.mjs:
    // comprobarla duplica el trabajo y reporta cada fichero dos veces.
    if (entry.name === "node_modules" || entry.name === ".workbench" || entry.name === "dist") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await findModules(fullPath, results);
    if (entry.isFile() && (entry.name.endsWith(".mjs") || entry.name.endsWith(".js"))) results.push(fullPath);
  }
  return results;
}

function check(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--check", filePath], { stdio: "inherit" });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Syntax check failed: ${filePath}`))));
  });
}

const files = await findModules(process.cwd());
for (const file of files) await check(file);
console.log(`Checked ${files.length} JavaScript modules.`);
