#!/usr/bin/env node
/**
 * Instala las dependencias con el mismo criterio que scripts/install.ps1 de FENIX:
 *   1. `npm install` con la configuración del usuario (normalmente el Artifactory corporativo);
 *   2. si el registro rechaza las descargas por autenticación (E401/E403/Forbidden), reintenta contra
 *      registry.npmjs.org con `--package-lock=false --no-audit` y confiando en los certificados del
 *      sistema: `NODE_OPTIONS=--use-system-ca` cuando el Node lo soporta (>= 22.15) y, en cualquier
 *      caso, un PEM exportado del almacén de Windows vía NODE_EXTRA_CA_CERTS. No se toca el .npmrc del
 *      usuario; se deja un .npmrc de proyecto (ignorado por git) para las siguientes instalaciones.
 *
 * Uso: node scripts/install-deps.mjs [--production] [--force-npmjs] [--registry <url>] [--cwd <dir>]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const root = path.resolve(flag("--cwd") || scriptRoot);
const production = args.includes("--production");
const registry = flag("--registry") || "https://registry.npmjs.org/";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const cacheDir = path.join(scriptRoot, ".cache");
const caFile = path.join(cacheDir, "system-ca-bundle.pem");
const projectNpmrc = path.join(root, ".npmrc");
export const AUTH_FAILURE_PATTERN = /E401|E403|Forbidden|Unauthorized|Incorrect or missing password|Unable to authenticate|Artifactory Realm/i;

function log(message) {
  process.stdout.write(`[install-deps] ${message}\n`);
}

export function nodeSupportsSystemCa(version = process.versions.node) {
  const [major, minor] = String(version).split(".").map(Number);
  return major > 23 || (major === 23 && minor >= 8) || (major === 22 && minor >= 15);
}

function runNpm(extraArgs = [], extraEnv = {}) {
  const npmArgs = ["install", "--loglevel", "error", "--no-fund", ...(production ? ["--omit=dev"] : []), ...extraArgs];
  log(`npm ${npmArgs.join(" ")}`);
  const result = spawnSync(npm, npmArgs, { cwd: root, stdio: ["inherit", "pipe", "pipe"], env: { ...process.env, ...extraEnv }, shell: process.platform === "win32", encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  return { ok: result.status === 0, output: `${result.stdout || ""}\n${result.stderr || ""}` };
}

/** Exporta las CA raíz e intermedias del almacén de Windows a un PEM (NODE_EXTRA_CA_CERTS / cafile). */
export function exportSystemCertificates(target = caFile) {
  mkdirSync(path.dirname(target), { recursive: true });
  if (process.platform === "win32") {
    const script = [
      "$stores = @('Cert:\\LocalMachine\\Root','Cert:\\LocalMachine\\CA','Cert:\\CurrentUser\\Root','Cert:\\CurrentUser\\CA')",
      "$sb = New-Object System.Text.StringBuilder",
      "foreach ($store in $stores) { Get-ChildItem $store -ErrorAction SilentlyContinue | Where-Object { $_.RawData } | ForEach-Object { [void]$sb.AppendLine('-----BEGIN CERTIFICATE-----'); [void]$sb.AppendLine([Convert]::ToBase64String($_.RawData, 'InsertLineBreaks')); [void]$sb.AppendLine('-----END CERTIFICATE-----') } }",
      `[IO.File]::WriteAllText('${target.replace(/'/g, "''")}', $sb.ToString())`,
      "Write-Output $sb.Length",
    ].join("; ");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0 || !existsSync(target)) throw new Error(`No se pudieron exportar los certificados del sistema: ${result.stderr || result.stdout}`);
    return target;
  }
  const candidates = ["/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt", "/etc/ssl/cert.pem"];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("No se encontró un paquete de certificados del sistema.");
  writeFileSync(target, readFileSync(found));
  return target;
}

/** Entorno para hablar con npmjs a través de la red corporativa (TLS interceptado). */
export function trustedNetworkEnvironment({ cafile } = {}) {
  const env = {};
  if (nodeSupportsSystemCa()) env.NODE_OPTIONS = [process.env.NODE_OPTIONS, "--use-system-ca"].filter(Boolean).join(" ");
  if (cafile) env.NODE_EXTRA_CA_CERTS = cafile;
  return env;
}

function writeProjectNpmrc({ registryUrl, cafile }) {
  const lines = [
    "# Generado por scripts/install-deps.mjs: el registro corporativo rechazó las descargas (criterio FENIX).",
    `registry=${registryUrl}`,
    "audit=false",
    "fund=false",
    ...(cafile ? [`cafile=${cafile}`] : []),
  ];
  writeFileSync(projectNpmrc, `${lines.join("\n")}\n`);
  log(`.npmrc de proyecto escrito (${projectNpmrc}).`);
}

export function installWithFallback() {
  let first = { ok: false, output: "" };
  if (!args.includes("--force-npmjs")) {
    first = runNpm();
    if (first.ok) {
      log("Dependencias instaladas con la configuración del usuario.");
      return true;
    }
    if (!AUTH_FAILURE_PATTERN.test(first.output)) {
      log("npm install falló por un motivo distinto a la autenticación del registro; revisa la salida anterior.");
      return false;
    }
    log("El registro corporativo rechazó las descargas (401/403). Reintentando desde registry.npmjs.org con los certificados del sistema…");
  }
  let cafile = "";
  try {
    cafile = exportSystemCertificates();
    log(`Certificados del sistema exportados a ${cafile}.`);
  } catch (error) {
    log(`Aviso: ${error.message}. Se reintenta sin cafile.`);
  }
  const env = trustedNetworkEnvironment({ cafile });
  if (env.NODE_OPTIONS) log("Node soporta --use-system-ca: se confía en el almacén de certificados del sistema.");
  const second = runNpm(["--registry", registry, "--package-lock=false", "--no-audit"], env);
  if (second.ok) {
    writeProjectNpmrc({ registryUrl: registry, cafile });
    log("Dependencias instaladas desde registry.npmjs.org.");
    return true;
  }
  rmSync(projectNpmrc, { force: true });
  log("La instalación también falló contra registry.npmjs.org. Si la red bloquea npmjs, hacen falta credenciales del Artifactory corporativo (npm login --registry <url>) o construir el instalador en un equipo con salida a Internet: el .exe ya lleva todas las dependencias.");
  return false;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(installWithFallback() ? 0 : 1);
}
