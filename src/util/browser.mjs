import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnDetached, runCommand } from "../util/process.mjs";
import { log } from "../util/log.mjs";

function windowsChromeCandidates() {
  const bases = [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter(Boolean);
  return bases.map((base) => path.join(base, "Google", "Chrome", "Application", "chrome.exe"));
}

/**
 * Abre la URL en una pestaña nueva del navegador ya abierto. Con Chrome instalado se lanza
 * `chrome.exe <url>`, que reutiliza la instancia en ejecución; si no, el navegador predeterminado.
 */
export async function openInBrowser(url, { preferred = "chrome" } = {}) {
  try {
    if (process.platform === "win32") {
      if (preferred === "chrome") {
        const chrome = windowsChromeCandidates().find((candidate) => existsSync(candidate));
        if (chrome) {
          spawnDetached(chrome, [url]);
          return { opened: true, browser: "chrome" };
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
