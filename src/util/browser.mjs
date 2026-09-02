import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnDetached, runCommand } from "../util/process.mjs";
import { log } from "../util/log.mjs";

/**
 * Localiza Chrome (o Edge como alternativa) igual que launch.ps1 de FENIX: primero las rutas
 * registradas por los instaladores (App Paths) y después las ubicaciones habituales.
 */
async function registeredAppPath(executable) {
  for (const hive of ["HKCU", "HKLM"]) {
    const result = await runCommand("reg", ["query", `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executable}`, "/ve"], { timeoutMs: 5000 });
    if (!result.ok) continue;
    const match = /REG_SZ\s+(.+)$/m.exec(result.stdout);
    const candidate = match?.[1]?.trim().replace(/^"|"$/g, "");
    if (candidate && existsSync(candidate)) return candidate;
  }
  return "";
}

function fallbackPaths(executable) {
  const bases = [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter(Boolean);
  const relative = executable === "chrome.exe" ? path.join("Google", "Chrome", "Application", "chrome.exe") : path.join("Microsoft", "Edge", "Application", "msedge.exe");
  return bases.map((base) => path.join(base, relative));
}

export async function findWindowsBrowser(preferred = "chrome") {
  const order = preferred === "edge" ? ["msedge.exe", "chrome.exe"] : ["chrome.exe", "msedge.exe"];
  for (const executable of order) {
    const registered = await registeredAppPath(executable);
    if (registered) return registered;
    const found = fallbackPaths(executable).find((candidate) => existsSync(candidate));
    if (found) return found;
  }
  return "";
}

/**
 * Abre la URL en una pestaña nueva del navegador ya abierto. Con Chrome o Edge instalados se lanza el
 * ejecutable con la URL, que reutiliza la instancia en ejecución; si no, el navegador predeterminado.
 */
export async function openInBrowser(url, { preferred = "chrome" } = {}) {
  try {
    if (process.platform === "win32") {
      if (preferred !== "default") {
        const browser = await findWindowsBrowser(preferred);
        if (browser) {
          spawnDetached(browser, [url]);
          return { opened: true, browser: path.basename(browser, ".exe") };
        }
      }
      spawnDetached("cmd.exe", ["/c", "start", "", url]);
      return { opened: true, browser: "default" };
    }
    if (process.platform === "darwin") {
      if (preferred === "chrome") {
        const result = await runCommand("open", ["-a", "Google Chrome", url], { timeoutMs: 10000 });
        if (result.ok) return { opened: true, browser: "chrome" };
      }
      spawnDetached("open", [url]);
      return { opened: true, browser: "default" };
    }
    for (const candidate of preferred === "chrome" ? ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"] : []) {
      const probe = await runCommand("which", [candidate], { timeoutMs: 3000 });
      if (probe.ok) {
        spawnDetached(candidate, [url]);
        return { opened: true, browser: candidate };
      }
    }
    spawnDetached("xdg-open", [url]);
    return { opened: true, browser: "default" };
  } catch (error) {
    log.warn("browser", `No se pudo abrir el navegador: ${error.message}`);
    return { opened: false, browser: "", error: error.message };
  }
}
