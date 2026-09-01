import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

/**
 * Resolución de rutas de Doriath.
 *
 * Dos disposiciones posibles:
 *  - Desarrollo: el repositorio es `appRoot` y los datos van a `~/.doriath`.
 *  - Instalado (Windows): `<raiz>/app` es `appRoot` y las carpetas hermanas `data`, `outputs`,
 *    `knowledge-bases` y `runtime` las crea el instalador. Se detecta por la presencia de
 *    `<raiz>/doriath-root.json` o de la carpeta `data` junto a `app`.
 *
 * `DORIATH_HOME` fuerza la carpeta de datos en cualquier caso.
 */
export const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function detectInstallRoot() {
  const parent = path.resolve(appRoot, "..");
  if (existsSync(path.join(parent, "doriath-root.json"))) return parent;
  if (path.basename(appRoot).toLowerCase() === "app" && existsSync(path.join(parent, "data"))) return parent;
  return null;
}

export const installRoot = detectInstallRoot();

export const dataRoot = process.env.DORIATH_HOME
  ? path.resolve(process.env.DORIATH_HOME)
  : installRoot
    ? path.join(installRoot, "data")
    : path.join(os.homedir(), ".doriath");

export const defaultOutputsRoot = installRoot
  ? path.join(installRoot, "outputs")
  : path.join(os.homedir(), "Doriath", "outputs");

export const defaultKnowledgeBasesRoot = installRoot
  ? path.join(installRoot, "knowledge-bases")
  : path.join(os.homedir(), "Doriath", "knowledge-bases");

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
