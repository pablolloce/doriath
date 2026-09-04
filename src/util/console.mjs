import path from "node:path";
import process from "node:process";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnDetached } from "./process.mjs";
import { paths } from "../paths.mjs";

/**
 * Abre una consola aparte para un inicio de sesión.
 *
 * `gh auth login` y `codex login` abren el navegador y esperan: no se pueden ejecutar dentro del
 * servidor, que se quedaría bloqueado, así que se lanzan en una ventana propia.
 *
 * Lo que no se puede hacer es pasarle esa orden a `cmd.exe` como un argumento suelto. Node entrecomilla
 * cada argumento que lleva espacios y escapa las comillas de dentro con `\"`, que es la convención de
 * C, no la de cmd: cmd se encuentra con `\"C:\...\node.exe\"` y responde que no reconoce el comando.
 * Pasaba siempre que la orden llevaba una ruta entrecomillada dentro —el Codex empaquetado, que es un
 * .js y se ejecuta con Node— y habría pasado igual con `gh` instalado en `C:\Program Files`.
 *
 * Así que la orden se escribe en un fichero y se abre el fichero. Dentro de un .cmd las comillas son
 * comillas y no hay una segunda ronda de escapado que las estropee.
 */
export function openLoginConsole({ id, title, lines, note = "" }) {
  const dir = path.join(paths.dataRoot, "console");
  mkdirSync(dir, { recursive: true });

  if (process.platform === "win32") {
    const script = path.join(dir, `${id}.cmd`);
    // Si sale bien, la ventana se cierra sola; si falla, se queda con el error a la vista. Cerrarse
    // en los dos casos es lo que convierte un fallo de login en «no ha pasado nada».
    const body = [
      "@echo off",
      `title ${title}`,
      ...lines,
      "if errorlevel 1 (",
      "  echo.",
      "  echo No se ha podido completar el inicio de sesion. El mensaje de arriba dice por que.",
      "  pause",
      ") else (",
      "  echo.",
      ...(note ? [`  echo ${note}`] : []),
      "  timeout /t 10",
      ")",
    ].join("\r\n");
    writeFileSync(script, `${body}\r\n`, "utf8");
    // Un único argumento por posición y ninguna comilla dentro de ninguno: nada que reescapar.
    spawnDetached("cmd.exe", ["/c", "start", title, script]);
    return { started: true, mode: "console", script };
  }

  const script = path.join(dir, `${id}.sh`);
  const shell = [
    "#!/bin/sh",
    ...lines,
    'if [ $? -ne 0 ]; then echo; echo "No se ha podido completar el inicio de sesion."; read -r _; fi',
    ...(note ? ["echo", `echo "${note.replace(/"/g, '\\"')}"`] : []),
  ].join("\n");
  writeFileSync(script, `${shell}\n`, { mode: 0o755 });
  if (process.platform === "darwin") {
    spawnDetached("osascript", ["-e", `tell application "Terminal" to do script "${script.replace(/"/g, '\\"')}"`]);
    return { started: true, mode: "terminal", script };
  }
  for (const [terminal, args] of [["x-terminal-emulator", ["-e"]], ["gnome-terminal", ["--"]], ["konsole", ["-e"]], ["xterm", ["-e"]]]) {
    try {
      spawnDetached(terminal, [...args, "/bin/sh", script]);
      return { started: true, mode: "terminal", script };
    } catch {
      // Se prueba el siguiente emulador.
    }
  }
  // Sin entorno gráfico no hay ventana que abrir: se ejecuta en segundo plano y se dice dónde está.
  spawnDetached("/bin/sh", [script]);
  return { started: true, mode: "background", script };
}

/** Entrecomilla una ruta para una línea de shell: solo si le hace falta. */
export function quoteArgument(value) {
  const text = String(value);
  return /[\s&|<>^()"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
