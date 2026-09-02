#!/usr/bin/env node
/** Comprueba la sintaxis de todos los módulos JS del proyecto (backend, frontend y scripts). */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = ["src", "public/js", "scripts", "tests"];
const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (/\.(mjs|cjs|js)$/.test(entry.name)) files.push(full);
  }
}
for (const target of targets) await walk(path.join(root, target));
let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed += 1;
    process.stdout.write(`FALLO ${path.relative(root, file)}\n${result.stderr}\n`);
  }
}
process.stdout.write(`${files.length - failed}/${files.length} ficheros correctos.\n`);
process.exit(failed ? 1 : 0);
