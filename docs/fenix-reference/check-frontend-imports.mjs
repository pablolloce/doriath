// Verifica el grafo de modulos ES de public/js sin ejecutarlo en un navegador.
//
// `node --check` (scripts/check.mjs) solo valida sintaxis: un import de un
// nombre que el modulo destino no exporta pasa el syntax check y revienta en
// runtime con la vista en blanco. Al haber varias personas troceando modulos,
// ese es el fallo mas probable, asi que se comprueba aqui.
//
// Comprueba:
//   1. que cada ruta importada existe,
//   2. que cada nombre importado esta realmente exportado por el destino,
//   3. que no hay ciclos de importacion (rompen el orden de inicializacion).
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(scriptDirectory, "..", "public", "js");

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

// Los comentarios y cadenas pueden contener texto que parezca un import; se
// eliminan antes de analizar para no generar falsos positivos.
function stripCommentsAndStrings(source) {
  return stripComments(source).replace(/`(?:\\[\s\S]|[^\\`])*`/g, "``");
}

function parseImports(source) {
  const imports = [];
  const pattern = /import\s+(?:([\s\S]*?)\s+from\s+)?["']([^"']+)["']/g;
  for (const [, clause, specifier] of source.matchAll(pattern)) {
    const names = [];
    if (clause) {
      const braces = clause.match(/\{([\s\S]*?)\}/);
      if (braces) {
        for (const entry of braces[1].split(",")) {
          const name = entry.trim().split(/\s+as\s+/)[0].trim();
          if (name) names.push(name);
        }
      }
      const defaultOrNamespace = clause.replace(/\{[\s\S]*?\}/, "").replace(/,/g, "").trim();
      if (defaultOrNamespace && !defaultOrNamespace.startsWith("*")) names.push("default");
      if (defaultOrNamespace.startsWith("*")) names.push("*");
    }
    imports.push({ specifier, names });
  }
  return imports;
}

function parseExports(source) {
  const names = new Set();
  for (const [, name] of source.matchAll(/export\s+(?:async\s+)?function\s+\*?\s*([\w$]+)/g)) names.add(name);
  for (const [, name] of source.matchAll(/export\s+class\s+([\w$]+)/g)) names.add(name);
  for (const [, name] of source.matchAll(/export\s+(?:const|let|var)\s+([\w$]+)/g)) names.add(name);
  for (const [, block] of source.matchAll(/export\s*\{([\s\S]*?)\}/g)) {
    for (const entry of block.split(",")) {
      const parts = entry.trim().split(/\s+as\s+/);
      const name = (parts[1] ?? parts[0]).trim();
      if (name) names.add(name);
    }
  }
  if (/export\s+default\b/.test(source)) names.add("default");
  return names;
}

async function collectModules(directory, results = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectModules(fullPath, results);
    else if (entry.isFile() && entry.name.endsWith(".js")) results.push(fullPath);
  }
  return results;
}

const files = await collectModules(ROOT);
const modules = new Map();
for (const file of files) {
  const raw = await readFile(file, "utf8");
  // Los exports se leen sin quitar plantillas: el borrado de literales `...` se
  // descoloca en ficheros con comillas invertidas dentro de expresiones
  // regulares (js/markdown.js las usa para el codigo inline) y se comia
  // exports reales. Detectar de mas aqui solo relajaria la comprobacion; no
  // puede inventarse un fallo.
  modules.set(file, {
    imports: parseImports(stripCommentsAndStrings(raw)),
    exports: parseExports(stripComments(raw)),
  });
}

const problems = [];
const graph = new Map();

for (const [file, module] of modules) {
  const edges = [];
  for (const { specifier, names } of module.imports) {
    if (!specifier.startsWith(".")) continue; // dependencia externa, fuera de alcance
    const target = path.resolve(path.dirname(file), specifier);
    const relativeSource = path.relative(ROOT, file).replace(/\\/g, "/");

    if (!modules.has(target)) {
      problems.push(`${relativeSource}: importa "${specifier}", que no existe`);
      continue;
    }
    edges.push(target);

    if (names.includes("*")) continue; // namespace: no se puede validar nombre a nombre
    const available = modules.get(target).exports;
    for (const name of names) {
      if (!available.has(name)) {
        const relativeTarget = path.relative(ROOT, target).replace(/\\/g, "/");
        problems.push(`${relativeSource}: importa "${name}" de ${relativeTarget}, que no lo exporta`);
      }
    }
  }
  graph.set(file, edges);
}

// Deteccion de ciclos: un ciclo entre modulos que ejecutan codigo en el top
// level deja a uno de ellos viendo bindings sin inicializar.
const WHITE = 0, GREY = 1, BLACK = 2;
const marks = new Map(files.map((file) => [file, WHITE]));
const stack = [];
const cycles = [];

function visit(file) {
  marks.set(file, GREY);
  stack.push(file);
  for (const next of graph.get(file) ?? []) {
    if (marks.get(next) === GREY) {
      const start = stack.indexOf(next);
      cycles.push([...stack.slice(start), next].map((f) => path.relative(ROOT, f).replace(/\\/g, "/")));
    } else if (marks.get(next) === WHITE) {
      visit(next);
    }
  }
  stack.pop();
  marks.set(file, BLACK);
}

for (const file of files) if (marks.get(file) === WHITE) visit(file);

// Ciclos que ya existian antes de introducir esta comprobacion. Funcionan
// porque en ambos lados solo se importan declaraciones de funcion (que se
// elevan) y ninguna se invoca durante la inicializacion del modulo, asi que
// cuando se llaman el binding ya esta resuelto. Son fragiles: si alguno de
// estos modulos empieza a usar el import en su top level, el arranque falla.
// No se admiten ciclos nuevos; para retirar uno de estos, rompe la dependencia
// y borra la entrada.
const KNOWN_CYCLES = new Set([
  "router.js -> views/workflows-guide.js -> router.js",
  "main.js -> views/repositories.js -> main.js",
]);

const knownFound = new Set();
for (const cycle of cycles) {
  const signature = cycle.join(" -> ");
  if (KNOWN_CYCLES.has(signature)) {
    knownFound.add(signature);
    continue;
  }
  problems.push(`ciclo de importacion nuevo: ${signature}`);
}

for (const signature of KNOWN_CYCLES) {
  if (!knownFound.has(signature)) {
    console.log(`Ciclo conocido ya resuelto, quitalo de KNOWN_CYCLES: ${signature}`);
  }
}

if (problems.length > 0) {
  console.error(`\nGrafo de modulos de public/js: ${problems.length} problema(s)\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("");
  process.exit(1);
}

console.log(
  `Frontend module graph OK: ${files.length} modulos, sin imports rotos` +
  ` (${knownFound.size} ciclo(s) conocido(s) tolerado(s)).`,
);
