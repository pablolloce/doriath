#!/usr/bin/env node
/**
 * Genera los ejecutables con Node SEA (single executable application):
 *   dist/Doriath/Doriath.exe     launcher (arranca el servidor y abre Chrome)
 *   dist/Doriath-Setup.exe       instalador con el payload (dist/Doriath) embebido
 *
 * Requiere haber ejecutado build-dist. El node.exe base se toma del Node portable descargado
 * (runtime/node/node.exe) para que el launcher y el runtime compartan versión. Con --platform linux
 * se generan binarios Linux a partir del node del sistema (útil para validar la mecánica en CI).
 */
import { mkdir, rm, writeFile, readFile, copyFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { ensureFreeSpace } from "./build-dist.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = process.env.DORIATH_DIST ? path.resolve(process.env.DORIATH_DIST) : path.join(root, "dist");
const target = path.join(dist, "Doriath");
const build = path.join(dist, "build");
const args = process.argv.slice(2);
const flag = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const platform = flag("--platform") || "win32";
const exe = platform === "win32" ? ".exe" : "";

function log(message) {
  process.stdout.write(`[build-exe] ${message}\n`);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(" ")} falló.`);
}

async function bundle(entry, out) {
  const esbuild = require("esbuild");
  await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", target: "node22", outfile: out, logLevel: "warning", minify: false });
}

async function zipDirectory(dir, out, { exclude = [] } = {}) {
  const JSZip = require("jszip");
  const zip = new JSZip();
  async function walk(current, relative) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (exclude.includes(rel)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        zip.folder(rel);
        await walk(full, rel);
      } else {
        const info = await stat(full);
        zip.file(rel, await readFile(full), { unixPermissions: info.mode, date: info.mtime });
      }
    }
  }
  await walk(dir, "");
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 }, platform: "UNIX" });
  await writeFile(out, buffer);
  return buffer.length;
}

async function baseNodeBinary() {
  if (platform === "win32") {
    const portable = path.join(target, "runtime", "node", "node.exe");
    if (!existsSync(portable)) throw new Error("Falta runtime/node/node.exe: ejecuta build-dist sin --skip-node.");
    return portable;
  }
  return process.execPath;
}

async function makeSea({ name, entry, output, assets }) {
  await mkdir(build, { recursive: true });
  const bundled = path.join(build, `${name}.bundle.cjs`);
  await bundle(entry, bundled);
  const blob = path.join(build, `${name}.blob`);
  const config = { main: bundled, output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, ...(assets ? { assets } : {}) };
  const configPath = path.join(build, `${name}.sea.json`);
  await writeFile(configPath, JSON.stringify(config, null, 2));
  run(process.execPath, ["--experimental-sea-config", configPath]);
  await copyFile(await baseNodeBinary(), output);
  const postject = path.join(root, "node_modules", "postject", "dist", "cli.js");
  run(process.execPath, [postject, output, "NODE_SEA_BLOB", blob, "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2", ...(platform === "darwin" ? ["--macho-segment-name", "NODE_SEA"] : [])]);
  const size = (await stat(output)).size;
  log(`${path.basename(output)} generado (${(size / (1024 * 1024)).toFixed(0)} MB).`);
}

async function main() {
  if (!existsSync(path.join(target, "app", "src", "cli.mjs"))) throw new Error("Ejecuta primero build-dist.");
  if (!args.includes("--allow-low-space")) await ensureFreeSpace(dist, 1.5 * 1024 ** 3, "build:exe");
  await rm(build, { recursive: true, force: true });
  // 1. Launcher dentro del payload.
  await makeSea({ name: "launcher", entry: path.join(root, "scripts", "launcher", "launcher.cjs"), output: path.join(target, `Doriath${exe}`) });
  // 2. Payload comprimido (todo dist/Doriath, con el launcher ya dentro).
  const payload = path.join(dist, "payload.zip");
  log("Comprimiendo el payload…");
  const size = await zipDirectory(target, payload, { exclude: ["data", "outputs", "knowledge-bases"] });
  log(`payload.zip: ${(size / (1024 * 1024)).toFixed(0)} MB.`);
  // 3. Instalador con el payload embebido.
  await makeSea({ name: "setup", entry: path.join(root, "scripts", "launcher", "setup.cjs"), output: path.join(dist, `Doriath-Setup${exe}`), assets: { "payload.zip": payload } });
  // Los intermedios (payload.zip y los blobs SEA) duplican cientos de MB; se retiran salvo que se pidan.
  if (!args.includes("--keep-artifacts")) {
    await rm(payload, { force: true });
    await rm(build, { recursive: true, force: true });
    log("Intermedios retirados (payload.zip y blobs SEA); usa --keep-artifacts para conservarlos.");
  }
  log(`Listo: ${path.join(dist, `Doriath-Setup${exe}`)} y ${path.join(target, `Doriath${exe}`)}.`);
}

main().catch((error) => {
  console.error(`[build-exe] ${error.message}`);
  process.exit(1);
});
