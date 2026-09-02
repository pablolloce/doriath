import process from "node:process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runCommand } from "./process.mjs";

/**
 * Diálogo nativo de selección de carpeta. En Windows usa el FolderBrowserDialog de .NET desde
 * PowerShell (hilo STA). En macOS, osascript; en Linux, zenity/kdialog si existen. Cuando no hay
 * diálogo nativo, la UI recurre al explorador de carpetas servido por `listDirectory`.
 */
export async function pickFolder({ title = "Selecciona una carpeta", initial = "" } = {}) {
  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
      `$d.Description = '${title.replace(/'/g, "''")}'`,
      "$d.ShowNewFolderButton = $true",
      initial ? `$d.SelectedPath = '${initial.replace(/'/g, "''")}'` : "",
      "$owner = New-Object System.Windows.Forms.Form",
      "$owner.TopMost = $true",
      "if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }",
    ].filter(Boolean).join("; ");
    const result = await runCommand("powershell.exe", ["-NoProfile", "-STA", "-NonInteractive", "-Command", script], { timeoutMs: 10 * 60 * 1000 });
    if (!result.ok) return { supported: true, path: "", error: result.error };
    return { supported: true, path: result.stdout.trim() };
  }
  if (process.platform === "darwin") {
    const result = await runCommand("osascript", ["-e", `POSIX path of (choose folder with prompt "${title.replace(/"/g, '\\"')}")`], { timeoutMs: 10 * 60 * 1000 });
    return { supported: true, path: result.ok ? result.stdout.trim().replace(/\/$/, "") : "" };
  }
  for (const [tool, args] of [["zenity", ["--file-selection", "--directory", `--title=${title}`]], ["kdialog", ["--getexistingdirectory", initial || os.homedir()]]]) {
    const probe = await runCommand("which", [tool], { timeoutMs: 3000 });
    if (probe.ok) {
      const result = await runCommand(tool, args, { timeoutMs: 10 * 60 * 1000 });
      return { supported: true, path: result.ok ? result.stdout.trim() : "" };
    }
  }
  return { supported: false, path: "" };
}

/** Explorador de carpetas de respaldo para la UI (solo directorios). */
export async function listDirectory(target) {
  if (!target) {
    if (process.platform === "win32") {
      const drives = [];
      for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
        try {
          await readdir(`${letter}:\\`);
          drives.push({ name: `${letter}:\\`, path: `${letter}:\\`, isDirectory: true });
        } catch { /* unidad no disponible */ }
      }
      return { path: "", parent: "", entries: [{ name: "Inicio", path: os.homedir(), isDirectory: true }, ...drives] };
    }
    target = os.homedir();
  }
  const resolved = path.resolve(target);
  const entries = await readdir(resolved, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("$") && entry.name !== "System Volume Information")
    .map((entry) => ({ name: entry.name, path: path.join(resolved, entry.name), isDirectory: true, hidden: entry.name.startsWith(".") }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent = path.dirname(resolved);
  return { path: resolved, parent: parent === resolved ? "" : parent, entries: directories };
}
