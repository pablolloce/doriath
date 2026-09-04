#!/usr/bin/env node
/**
 * Genera los ejecutables con Node SEA (single executable application):
 *   dist/KDD-Studio/KDD-Studio.exe     launcher (arranca el servidor y abre Chrome)
 *   dist/KDD-Studio-Setup.exe       instalador con el payload (dist/KDD-Studio) embebido
 *
 * Requiere haber ejecutado build-dist. El node.exe base se toma del Node portable descargado
 * (runtime/node/node.exe) para que el launcher y el runtime compartan versión. Con --platform linux
 * se generan binarios Linux a partir del node del sistema (útil para validar la mecánica en CI).
 */
import { mkdir, rm, writeFile, readFile, copyFile, readdir, stat, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { ensureFreeSpace } from "./build-dist.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgVersion = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
const dist = process.env.KDD_DIST ? path.resolve(process.env.KDD_DIST) : path.join(root, "dist");
const EDITIONS = {
  studio: { name: "KDD Studio", executable: "KDD-Studio" },
  assistant: { name: "KDD Assistant", executable: "KDD-Assistant" },
};
const editionFlag = (() => { const a = process.argv.slice(2); const i = a.indexOf("--edition"); return i >= 0 ? String(a[i + 1] || "").toLowerCase() : ""; })();
const requested = editionFlag || String(process.env.KDD_EDITION || "").toLowerCase();
const editionId = EDITIONS[requested] ? requested : "studio";
const edition = EDITIONS[editionId];
const target = path.join(dist, edition.executable);
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
  // El launcher y el instalador llevan el nombre de su edición grabado: se inyecta aquí en vez de
  // leerlo en tiempo de ejecución, porque el instalador tiene que saberlo antes de que exista nada.
  await esbuild.build({
    entryPoints: [entry], bundle: true, platform: "node", format: "cjs", target: "node22", outfile: out,
    logLevel: "warning", minify: false,
    define: {
      __EDITION_ID__: JSON.stringify(editionId),
      __EDITION_NAME__: JSON.stringify(edition.name),
      __EDITION_EXE__: JSON.stringify(edition.executable),
    },
  });
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
        // Un enlace colgado (típico en node_modules/.bin tras podar un paquete) no debe tumbar el
        // empaquetado: se salta y se avisa.
        let info;
        try {
          info = await stat(full);
        } catch {
          log(`Se salta ${rel}: el enlace no apunta a ningún sitio.`);
          continue;
        }
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

/**
 * Node con el que se genera el blob SEA. El formato del blob va ligado a la versión de Node, así que
 * cuando el equipo de build es de la misma plataforma que el destino (build en Windows) se usa el
 * propio node.exe portable que llevará el ejecutable; solo al cruzar plataformas se recurre al node
 * del sistema (sin snapshot ni code cache el blob es portable entre plataformas).
 */
async function seaNodeBinary(base) {
  if (process.platform === platform) return base;
  log(`Blob SEA generado con el Node del sistema (${process.version}); el ejecutable usa ${path.basename(base)}.`);
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
  const base = await baseNodeBinary();
  run(await seaNodeBinary(base), ["--experimental-sea-config", configPath]);
  await copyFile(base, output);
  const postject = path.join(root, "node_modules", "postject", "dist", "cli.js");
  run(process.execPath, [postject, output, "NODE_SEA_BLOB", blob, "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2", ...(platform === "darwin" ? ["--macho-segment-name", "NODE_SEA"] : [])]);
  if (platform === "win32") await brandExecutable(output, name);
  const size = (await stat(output)).size;
  log(`${path.basename(output)} generado (${(size / (1024 * 1024)).toFixed(0)} MB).`);
}

/**
 * Pone el icono y los datos de versión en el ejecutable. El SEA es una copia de node.exe, así que sin
 * esto Windows enseña el icono de Node en el Explorador, en la barra de tareas y en el aviso de
 * SmartScreen. resedit edita los recursos del PE en JavaScript puro: no descarga binarios, que en la
 * red corporativa es justo lo que hay que evitar.
 */
/**
 * resedit es una dependencia de desarrollo relativamente nueva: si alguien actualiza el repositorio y
 * construye sin reinstalar, faltaría y el ejecutable saldría con el icono de Node sin que se note.
 * Mejor parar aquí con una instrucción clara que entregar un binario mal.
 */
function requireResedit() {
  try {
    return require("resedit");
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    throw new Error("Falta el paquete 'resedit', necesario para poner el icono en los ejecutables. Ejecuta \"npm install\" (o \"npm run setup\") y vuelve a construir.");
  }
}

async function brandExecutable(target, name) {
  const icon = path.join(root, "public", "brand", "kdd.ico");
  if (!existsSync(icon)) throw new Error(`Falta ${path.relative(root, icon)}: el ejecutable se quedaría con el icono de Node.`);
  try {
    const ResEdit = requireResedit();
    // ignoreCert descarta la firma heredada de node.exe, que postject ya deja inservible al inyectar
    // el blob: mejor sin firma que con una corrupta.
    const executable = ResEdit.NtExecutable.from(await readFile(target), { ignoreCert: true });
    const resource = ResEdit.NtExecutableResource.from(executable);
    const iconFile = ResEdit.Data.IconFile.from(await readFile(icon));
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resource.entries, 1, 1033, iconFile.icons.map((item) => item.data));
    const version = ResEdit.Resource.VersionInfo.createEmpty();
    const [major, minor, patch] = String(pkgVersion).split(".").map((part) => Number(part) || 0);
    version.setFileVersion(major, minor, patch, 0, 1033);
    version.setProductVersion(major, minor, patch, 0, 1033);
    version.setStringValues({ lang: 1033, codepage: 1200 }, {
      ProductName: edition.name,
      FileDescription: name === "setup" ? `Instalador de ${edition.name}` : `${edition.name} — BBVA CIB`,
      CompanyName: "BBVA CIB · NFQ",
      LegalCopyright: "BBVA CIB",
      OriginalFilename: path.basename(target),
    });
    version.outputToResourceEntries(resource.entries);
    resource.outputResource(executable);
    await writeFile(target, Buffer.from(executable.generate()));
    log(`${path.basename(target)}: icono y versión aplicados.`);
  } catch (error) {
    throw new Error(`No se pudo aplicar el icono a ${path.basename(target)}: ${error.message}`);
  }
}

/**
 * Relee el icono de los ejecutables ya terminados. Si el build dice que están y Windows sigue
 * enseñando el de Node, el problema es la caché de iconos del Explorador o se está mirando otra copia
 * (la instalada en %LOCALAPPDATA%\KDD Studio no cambia hasta volver a pasar el instalador).
 */
/**
 * Comprueba que el icono llegó al ejecutable y, sobre todo, que los tamaños pequeños van en
 * formato DIB. Windows solo sabe leer un icono comprimido en PNG a 256x256: si 16, 32 o 48
 * viajan como PNG, el fichero parece correcto en cualquier visor pero el Explorador dibuja el
 * icono genérico. Nos pasó, así que aquí se queda la comprobación.
 */
async function verifyIcons(files) {
  const ResEdit = requireResedit();
  for (const file of files) {
    const resource = ResEdit.NtExecutableResource.from(ResEdit.NtExecutable.from(await readFile(file), { ignoreCert: true }));
    const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resource.entries);
    const group = groups[0];
    if (!group || group.icons.length < 2) throw new Error(`${path.basename(file)} no lleva el icono de ${edition.name}.`);
    const bitmaps = new Map(resource.entries.filter((entry) => entry.type === 3).map((entry) => [entry.id, entry.bin]));
    for (const icon of group.icons) {
      const bin = bitmaps.get(icon.iconID);
      if (!bin) throw new Error(`${path.basename(file)}: falta el mapa de bits ${icon.iconID} del icono.`);
      const head = Buffer.from(bin.slice(0, 8));
      const isPng = head[0] === 0x89 && head.toString("latin1", 1, 4) === "PNG";
      const width = icon.width || 256;
      if (isPng && width < 256) {
        throw new Error(`${path.basename(file)}: el icono de ${width}px va en PNG y Windows no lo sabe leer; regenera public/brand/kdd.ico con "npm run icon".`);
      }
    }
    const sizes = group.icons.map((icon) => icon.width || 256).join("/");
    log(`${path.basename(file)}: icono verificado (grupo ${group.id}, idioma ${group.lang}, ${sizes} px).`);
  }
}

/** Pega el payload detrás del ejecutable con un pie que dice dónde empieza (ver setup.cjs). */
const PAYLOAD_MAGIC = "KDD-PAYLOAD1";
async function appendPayload(target, payload) {
  const base = await stat(target);
  const data = await readFile(payload);
  const trailer = Buffer.alloc(PAYLOAD_MAGIC.length + 16);
  trailer.write(PAYLOAD_MAGIC, 0, "latin1");
  trailer.writeBigUInt64LE(BigInt(base.size), PAYLOAD_MAGIC.length);
  trailer.writeBigUInt64LE(BigInt(data.length), PAYLOAD_MAGIC.length + 8);
  await appendFile(target, data);
  await appendFile(target, trailer);
  const total = (await stat(target)).size;
  log(`${path.basename(target)}: payload pegado (${(data.length / (1024 ** 2)).toFixed(0)} MB); total ${(total / (1024 ** 2)).toFixed(0)} MB.`);
}

async function main() {
  if (!existsSync(path.join(target, "app", "src", "cli.mjs"))) throw new Error("Ejecuta primero build-dist.");
  if (platform === "win32") requireResedit();
  if (!args.includes("--allow-low-space")) await ensureFreeSpace(dist, 1.5 * 1024 ** 3, "build:exe");
  await rm(build, { recursive: true, force: true });
  // 1. Launcher dentro del payload.
  await makeSea({ name: "launcher", entry: path.join(root, "scripts", "launcher", "launcher.cjs"), output: path.join(target, `${edition.executable}${exe}`) });
  // 2. Payload comprimido (todo dist/KDD-Studio, con el launcher ya dentro).
  const payload = path.join(dist, "payload.zip");
  log("Comprimiendo el payload…");
  const size = await zipDirectory(target, payload, { exclude: ["data", "outputs", "knowledge-bases"] });
  log(`payload.zip: ${(size / (1024 * 1024)).toFixed(0)} MB.`);
  // 3. Instalador: el ejecutable primero y el payload pegado detrás. Incrustarlo como recurso SEA
  //    reventaba postject a partir de unos cientos de megas, y el payload ronda el medio giga.
  const setup = path.join(dist, `${edition.executable}-Setup${exe}`);
  await makeSea({ name: "setup", entry: path.join(root, "scripts", "launcher", "setup.cjs"), output: setup });
  await appendPayload(setup, payload);
  // Los intermedios (payload.zip y los blobs SEA) duplican cientos de MB; se retiran salvo que se pidan.
  if (platform === "win32") await verifyIcons([path.join(target, `${edition.executable}${exe}`), setup]);
  if (!args.includes("--keep-artifacts")) {
    await rm(payload, { force: true });
    await rm(build, { recursive: true, force: true });
    log("Intermedios retirados (payload.zip y blobs SEA); usa --keep-artifacts para conservarlos.");
  }
  log(`Listo (${editionId}): ${path.join(dist, `${edition.executable}-Setup${exe}`)} y ${path.join(target, `${edition.executable}${exe}`)}.`);
}

main().catch((error) => {
  console.error(`[build-exe] ${error.message}`);
  process.exit(1);
});
