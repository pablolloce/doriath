// Monta dist/FENIX con todo lo que la aplicacion necesita en runtime para que
// Inno Setup (installer/fenix.iss) lo empaquete en un unico .exe.
//
// El objetivo es que quien lo instala no tenga que clonar el repositorio ni
// tener git, Node o npm: el runtime de Node y el CLI de gh viajan dentro.
// Oracle Instant Client se obtiene directamente de Oracle durante install.ps1
// tras la aceptacion de su licencia; no se redistribuye dentro de este payload.
// Si el arbol de dependencies/ ya contiene runtimes preparados, se copian al
// payload. Si no existen, el build sigue adelante: el instalador puede resolver
// esos binarios en el primer arranque.
//
//   node scripts/build-dist.mjs
//   node scripts/build-dist.mjs --fresh   (reinstala node_modules en vez de copiarlos)
import { spawn } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(scriptDirectory, "..");
const DIST = path.join(ROOT, "dist");
const PAYLOAD = path.join(DIST, "FENIX");

const fresh = process.argv.includes("--fresh");

// Carpetas y ficheros que la aplicacion lee en tiempo de ejecucion.
// Si anades una carpeta nueva que se lea en runtime, tiene que aparecer aqui o
// la version instalada fallara aunque el repositorio funcione.
const PAYLOAD_ENTRIES = [
  "src",
  "public",
  "scripts",
  "workflows",
  "workflow-assets",
  "prompts",
  "global-agents",
  "docs",
  "package.json",
  "README.md",
  "Guia.md",
];

const OPTIONAL_DEPENDENCIES = [
  "node-v22.23.1-win-x64",
  "gh_2.96.0_windows_amd64",
  "MinGit-2.55.0.3-64-bit",
];

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} salio con codigo ${code}`))));
    child.on("error", reject);
  });
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function directorySize(target) {
  let total = 0;
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) total += (await stat(full)).size;
    }
  };
  await walk(target);
  return total;
}

const step = (message) => console.log(`\n  ${message}`);
const info = (message) => console.log(`    ${message}`);

const manifest = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
const buildCommit = String(process.env.FENIX_BUILD_COMMIT || "").trim();

console.log(`\n  FENIX - empaquetado v${manifest.version}`);

step("Limpiando dist/");
await rm(DIST, { recursive: true, force: true });
await mkdir(PAYLOAD, { recursive: true });

step("Copiando la aplicacion");
for (const entry of PAYLOAD_ENTRIES) {
  const source = path.join(ROOT, entry);
  if (!(await exists(source))) {
    throw new Error(`Falta ${entry} en el repositorio; el paquete quedaria incompleto.`);
  }
  await cp(source, path.join(PAYLOAD, entry), { recursive: true });
  info(entry);
}

step("Preparando dependencias de produccion");
if (fresh) {
  // Reinstala desde el registro. Mas limpio, pero requiere red y puede resolver
  // versiones distintas a las probadas si no hay lockfile commiteado.
  await cp(path.join(ROOT, "package.json"), path.join(PAYLOAD, "package.json"));
  await run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--loglevel", "error"], PAYLOAD);
  info("npm install --omit=dev completado");
} else {
  // Copia el arbol ya probado. Como package-lock.json esta en .gitignore, esto
  // es mas reproducible que reinstalar: se empaqueta exactamente lo que se ha
  // estado ejecutando en local.
  const source = path.join(ROOT, "node_modules");
  if (!(await exists(source))) {
    throw new Error("No hay node_modules/. Ejecuta npm install antes, o usa --fresh.");
  }
  await cp(source, path.join(PAYLOAD, "node_modules"), { recursive: true });
  info("node_modules copiado desde el arbol local");
}

step("Copiando dependencias opcionales");
for (const dist of OPTIONAL_DEPENDENCIES) {
  const source = path.join(ROOT, "dependencies", dist);
  if (!(await exists(source))) {
    info(`${dist} ausente; se omite`);
    continue;
  }
  await cp(source, path.join(PAYLOAD, "dependencies", dist), { recursive: true });
  info(dist);
}

// Sello de version: el instalador y el propio arranque lo leen para saber que
// build esta desplegada en cada puesto.
await writeFile(
  path.join(PAYLOAD, "BUILD.json"),
  `${JSON.stringify({ version: manifest.version, builtAt: new Date().toISOString(), ...(buildCommit ? { commit: buildCommit } : {}) }, null, 2)}\n`,
  "utf8",
);

// La version del instalador se genera desde package.json en lugar de repetirla
// a mano en el .iss: asi no pueden divergir.
await writeFile(
  path.join(ROOT, "installer", "version.iss"),
  `; Generado por scripts/build-dist.mjs. No editar a mano.\n#define AppVersion "${manifest.version}"\n`,
  "utf8",
);
info(`installer/version.iss -> ${manifest.version}`);

const bytes = await directorySize(PAYLOAD);
step(`Listo: dist/FENIX (${(bytes / 1024 / 1024).toFixed(0)} MB sin comprimir)`);
console.log(`
    Siguiente paso, generar el instalador:
      iscc installer\\fenix.iss

    Produce dist\\FENIX-Setup-${manifest.version}.exe
`);
