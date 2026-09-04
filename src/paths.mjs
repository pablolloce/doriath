import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, renameSync } from "node:fs";

/**
 * Resolución de rutas de KDD Studio.
 *
 * Dos disposiciones posibles:
 *  - Desarrollo: el repositorio es `appRoot` y los datos van a `~/.kdd`.
 *  - Instalado (Windows): `<raiz>/app` es `appRoot` y las carpetas hermanas `data`, `outputs`,
 *    `knowledge-bases` y `runtime` las crea el instalador. Se detecta por la presencia de
 *    `<raiz>/kdd-root.json` o de la carpeta `data` junto a `app`.
 *
 * `KDD_HOME` fuerza la carpeta de datos en cualquier caso.
 */
export const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function detectInstallRoot() {
  const parent = path.resolve(appRoot, "..");
  if (existsSync(path.join(parent, "kdd-root.json"))) return parent;
  if (path.basename(appRoot).toLowerCase() === "app" && existsSync(path.join(parent, "data"))) return parent;
  return null;
}

export const installRoot = detectInstallRoot();

/**
 * El producto se llamó Doriath antes de llamarse KDD Studio, y sus carpetas llevaban ese nombre.
 * Quien ya tenía datos —bases registradas, conversaciones, análisis— los perdería de vista al
 * actualizar, así que la primera vez se mueve la carpeta antigua a la nueva. Solo se mueve si la
 * nueva todavía no existe: si están las dos, gana la nueva y la vieja se queda intacta.
 */
function adoptLegacyFolder(current, legacy) {
  try {
    if (existsSync(current) || !existsSync(legacy)) return current;
    renameSync(legacy, current);
  } catch {
    // Si el movimiento falla (permisos, disco, la carpeta en uso) se sigue con la ruta nueva:
    // arrancar con los datos vacíos es recuperable; no arrancar, no.
  }
  return current;
}

export const dataRoot = process.env.KDD_HOME
  ? path.resolve(process.env.KDD_HOME)
  : installRoot
    ? path.join(installRoot, "data")
    : adoptLegacyFolder(path.join(os.homedir(), ".kdd"), path.join(os.homedir(), ".doriath"));

const contentRoot = installRoot
  ? null
  : adoptLegacyFolder(path.join(os.homedir(), "KDD"), path.join(os.homedir(), "Doriath"));

export const defaultOutputsRoot = installRoot
  ? path.join(installRoot, "outputs")
  : path.join(contentRoot, "outputs");

export const defaultKnowledgeBasesRoot = installRoot
  ? path.join(installRoot, "knowledge-bases")
  : path.join(contentRoot, "knowledge-bases");

export const paths = {
  appRoot,
  installRoot,
  dataRoot,
  configFile: path.join(dataRoot, "config.json"),
  sourcesFile: path.join(dataRoot, "sources.json"),
  chatsDir: path.join(dataRoot, "chats"),
  runsDir: path.join(dataRoot, "runs"),
  analysesDir: path.join(dataRoot, "analyses"),
  uploadsDir: path.join(dataRoot, "uploads"),
  copilotHome: path.join(dataRoot, "copilot-home"),
  logsDir: path.join(dataRoot, "logs"),
  publicDir: path.join(appRoot, "public"),
  promptsDir: path.join(appRoot, "prompts"),
  kddReferenceDir: path.join(appRoot, "kdd-reference"),
  brandDir: path.join(appRoot, "docs", "identidad-bbva"),
  runtimeDir: installRoot ? path.join(installRoot, "runtime") : path.join(dataRoot, "runtime"),
};
