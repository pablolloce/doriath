#!/usr/bin/env node
/**
 * Instala las dependencias en equipos BBVA, con el mismo criterio que el install.ps1 de FENIX:
 *   1. intenta `npm install` con la configuración del usuario (registro corporativo);
 *   2. si el registro rechaza las descargas por autenticación (401/403 de Artifactory), reintenta
 *      contra registry.npmjs.org usando los certificados raíz del sistema (la red corporativa
 *      intercepta TLS con su propia CA), sin tocar el .npmrc del usuario: se escribe un .npmrc de
 *      proyecto (ignorado por git) con registro, cafile y sin auditoría.
 *
 * Uso: node scripts/install-deps.mjs [--production] [--force-npmjs] [--registry <url>]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const production = args.includes("--production");
const registry = flag("--registry") || "https://registry.npmjs.org/";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const cacheDir = path.join(root, ".cache");
const caFile = path.join(cacheDir, "system-ca-bundle.pem");
const projectNpmrc = path.join(root, ".npmrc");

function log(message) {
  process.stdout.write(`[install-deps] ${message}\n`);
}

function runNpm(extraEnv = {}) {
  const npmArgs = ["install", "--no-audit", "--no-fund", ...(production ? ["--omit=dev"] : [])];
  log(`npm ${npmArgs.join(" ")}`);
  const result = spawnSync(npm, npmArgs, { cwd: root, stdio: ["inherit", "pipe", "pipe"], env: { ...process.env, ...extraEnv }, shell: process.platform === "win32", encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  return { ok: result.status === 0, output: `${result.stdout || ""}\n${result.stderr || ""}` };
}

function looksLikeRegistryAuthFailure(output) {
  return /E403|E401|403 Forbidden|401 Unauthorized|Artifactory Realm|artifactory/i.test(output);
}

/** Exporta las CA raíz e intermedias del almacén de Windows a un PEM (para NODE_EXTRA_CA_CERTS / cafile). */
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

function writeProjectNpmrc({ registryUrl, cafile }) {
  const lines = [
    "# Generado por scripts/install-deps.mjs: el registro corporativo rechazó las descargas.",
    `registry=${registryUrl}`,
    `@github:registry=${registryUrl}`,
    `@koromix:registry=${registryUrl}`,
    `@esbuild:registry=${registryUrl}`,
    "audit=false",
    "fund=false",
    ...(cafile ? [`cafile=${cafile}`] : []),
  ];
  writeFileSync(projectNpmrc, `${lines.join("\n")}\n`);
  log(`.npmrc de proyecto escrito (${projectNpmrc}).`);
}

function main() {
  let first = { ok: false, output: "" };
  if (!args.includes("--force-npmjs")) {
    first = runNpm();
    if (first.ok) {
      log("Dependencias instaladas con la configuración del usuario.");
      return;
    }
    if (!looksLikeRegistryAuthFailure(first.output)) {
      log("npm install falló por un motivo distinto a la autenticación del registro; revisa la salida anterior.");
      process.exit(1);
    }
    log("El registro corporativo rechazó las descargas (401/403). Se reintenta contra registry.npmjs.org con los certificados del sistema.");
  }
  let cafile = "";
  try {
    cafile = exportSystemCertificates();
    log(`Certificados del sistema exportados a ${cafile}.`);
  } catch (error) {
    log(`Aviso: ${error.message}. Se reintenta sin cafile.`);
  }
  writeProjectNpmrc({ registryUrl: registry, cafile });
  const env = cafile ? { NODE_EXTRA_CA_CERTS: cafile } : {};
  const second = runNpm(env);
  if (second.ok) {
    log("Dependencias instaladas desde registry.npmjs.org. El .npmrc de proyecto se conserva para futuras instalaciones (está ignorado por git).");
    return;
  }
  rmSync(projectNpmrc, { force: true });
  log("La instalación también falló contra registry.npmjs.org. Si la red bloquea npmjs, hacen falta credenciales del Artifactory corporativo (npm login --registry <url de Artifactory>) o instalar desde un equipo con salida a Internet.");
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
