"use strict";
/**
 * Doriath-Setup.exe — instalador (Node SEA con el payload comprimido como asset).
 *
 * Crea la estructura de carpetas de la instalación, extrae la aplicación con su Node portable, deja
 * intactos los datos existentes (data/, outputs/, knowledge-bases/) y crea accesos directos. Uso:
 *   Doriath-Setup.exe                 asistente en consola (carpeta por defecto %LOCALAPPDATA%\Doriath)
 *   Doriath-Setup.exe --dir C:\Doriath --silent [--no-launch]
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const readline = require("node:readline");
const { spawn, spawnSync } = require("node:child_process");
const { extractZip } = require("./zip.cjs");

const isWindows = process.platform === "win32";
const args = process.argv.slice(2);
const flag = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const has = (name) => args.includes(name);

function readPayload() {
  const local = flag("--payload");
  if (local) return fs.readFileSync(local);
  try {
    const sea = require("node:sea");
    if (sea.isSea()) return Buffer.from(sea.getAsset("payload.zip"));
  } catch { /* no SEA */ }
  const fallback = path.resolve(__dirname, "..", "..", "dist", "payload.zip");
  if (fs.existsSync(fallback)) return fs.readFileSync(fallback);
  throw new Error("No se encuentra el payload de instalación.");
}

function ask(question, fallback) {
  if (has("--silent")) return Promise.resolve(fallback);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(`${question} [${fallback}]: `, (answer) => { rl.close(); resolve(answer.trim() || fallback); }));
}

/** Genera un .ico a partir del isotipo (System.Drawing), como create-shortcut.ps1 de FENIX. */
function createIcon(root) {
  const png = path.join(root, "app", "public", "brand", "doriath-icon.png");
  const ico = path.join(root, "data", "doriath.ico");
  if (!isWindows || !fs.existsSync(png)) return "";
  fs.mkdirSync(path.dirname(ico), { recursive: true });
  const script = [
    "Add-Type -AssemblyName System.Drawing",
    `$source = [System.Drawing.Image]::FromFile('${png.replace(/'/g, "''")}')`,
    "$bitmap = New-Object System.Drawing.Bitmap 256, 256",
    "$graphics = [System.Drawing.Graphics]::FromImage($bitmap)",
    "$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic",
    "$graphics.DrawImage($source, 0, 0, 256, 256)",
    "$graphics.Dispose()",
    "$icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())",
    `$stream = [System.IO.File]::Open('${ico.replace(/'/g, "''")}', [System.IO.FileMode]::Create)`,
    "$icon.Save($stream)",
    "$stream.Dispose()",
    "$source.Dispose()",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true });
  return result.status === 0 && fs.existsSync(ico) ? ico : "";
}

function createShortcuts(root) {
  if (!isWindows) return;
  const target = path.join(root, "Doriath.exe");
  const icon = createIcon(root) || target;
  const script = [
    "$shell = New-Object -ComObject WScript.Shell",
    `$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Doriath.lnk'`,
    `$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Doriath.lnk'`,
    "foreach ($file in @($desktop, $menu)) {",
    "  $s = $shell.CreateShortcut($file)",
    `  $s.TargetPath = '${target.replace(/'/g, "''")}'`,
    `  $s.WorkingDirectory = '${root.replace(/'/g, "''")}'`,
    "  $s.Description = 'Doriath - BBVA CIB Knowledge-Driven Development'",
    `  $s.IconLocation = '${icon.replace(/'/g, "''")},0'`,
    "  $s.Save()",
    "}",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) process.stdout.write(`[Setup] No se pudieron crear los accesos directos: ${result.stderr}\n`);
  else process.stdout.write("[Setup] Accesos directos creados en el Escritorio y el menú Inicio.\n");
}

async function main() {
  process.stdout.write("\nDoriath — instalador\n====================\n\n");
  const defaultDir = flag("--dir") || (isWindows ? path.join(process.env.LOCALAPPDATA || os.homedir(), "Doriath") : path.join(os.homedir(), "Doriath"));
  const root = path.resolve(await ask("Carpeta de instalación", defaultDir));
  const payload = readPayload();
  fs.mkdirSync(root, { recursive: true });
  for (const folder of ["app", "runtime"]) fs.rmSync(path.join(root, folder), { recursive: true, force: true });
  process.stdout.write(`[Setup] Extrayendo la aplicación en ${root}…\n`);
  let last = 0;
  const preserved = new Set(["data/", "outputs/", "knowledge-bases/"]);
  const count = extractZip(payload, root, {
    filter: (name) => ![...preserved].some((prefix) => name.startsWith(prefix) && fs.existsSync(path.join(root, name))),
    onEntry: (name, extracted, total) => { if (extracted - last >= 400) { last = extracted; process.stdout.write(`\r[Setup] ${extracted} ficheros…   `); } },
  });
  process.stdout.write(`\r[Setup] ${count} ficheros extraídos.        \n`);
  for (const folder of ["data", "outputs", "knowledge-bases"]) fs.mkdirSync(path.join(root, folder), { recursive: true });
  fs.writeFileSync(path.join(root, "doriath-root.json"), JSON.stringify({ product: "Doriath", installedAt: new Date().toISOString(), root }, null, 2));
  createShortcuts(root);
  process.stdout.write(`\n[Setup] Instalación completada.\n  Ejecutable:            ${path.join(root, "Doriath.exe")}\n  Bases de conocimiento: ${path.join(root, "knowledge-bases")}\n  Salidas:               ${path.join(root, "outputs")}\n  Datos:                 ${path.join(root, "data")}\n\n`);
  const launch = has("--no-launch") ? "n" : await ask("¿Abrir Doriath ahora? (s/n)", "s");
  if (/^s/i.test(launch)) {
    const executable = path.join(root, isWindows ? "Doriath.exe" : "Doriath");
    if (fs.existsSync(executable)) {
      const child = spawn(executable, [], { cwd: root, detached: true, stdio: "ignore" });
      child.unref();
    }
  }
}

main().catch((error) => {
  process.stderr.write(`[Setup] ${error.message}\n`);
  if (isWindows && !has("--silent")) spawnSync("cmd.exe", ["/c", "pause"], { stdio: "inherit" });
  process.exit(1);
});
