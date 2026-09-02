import { spawn } from "node:child_process";
import process from "node:process";

/**
 * Ejecuta un comando sin shell y devuelve stdout/stderr acotados.
 * Mismo contrato que FENIX (`{ ok, code, stdout, stderr, error }`) para poder reutilizar sus módulos.
 */
export function runCommand(command, args = [], {
  cwd,
  timeoutMs = 60000,
  env,
  input,
  onChunk,
  maxOutputBytes = 4 * 1024 * 1024,
  cancellationToken,
} = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: env || process.env,
        windowsHide: true,
        shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ ok: false, code: -1, stdout: "", stderr: "", error: error.message });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let cancelled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unregister?.();
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch { /* ignore */ }
    }, timeoutMs);

    const unregister = cancellationToken?.registerAbort?.(() => {
      cancelled = true;
      try { child.kill(); } catch { /* ignore */ }
    });

    const append = (stream, chunk) => {
      const text = chunk.toString("utf8");
      onChunk?.(stream, text);
      if (stream === "stdout") {
        if (stdout.length < maxOutputBytes) stdout += text;
      } else if (stderr.length < maxOutputBytes) {
        stderr += text;
      }
    };

    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.on("error", (error) => {
      finish({ ok: false, code: -1, stdout, stderr, error: error.code === "ENOENT" ? `Comando no encontrado: ${command}` : error.message });
    });
    child.on("close", (code) => {
      const ok = code === 0 && !timedOut && !cancelled;
      finish({
        ok,
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        error: ok ? "" : cancelled
          ? "Cancelado."
          : timedOut
            ? `Tiempo agotado (${timeoutMs} ms) ejecutando ${command}.`
            : (stderr.trim() || stdout.trim() || `${command} terminó con código ${code}.`),
      });
    });

    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

/** Lanza un proceso desacoplado (ventana de consola propia en Windows) y no espera su salida. */
export function spawnDetached(command, args = [], { cwd, env } = {}) {
  const child = spawn(command, args, {
    cwd,
    env: env || process.env,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    shell: false,
  });
  child.on("error", () => { /* el llamador decide si el fallo importa */ });
  child.on("error", (error) => process.stderr.write(`[doriath] No se pudo lanzar ${command}: ${error.message}\n`));
  child.unref();
  return child;
}

export function createCancellationToken() {
  const aborts = new Set();
  let cancelled = false;
  return {
    get cancelled() { return cancelled; },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      for (const abort of aborts) {
        try { abort(); } catch { /* ignore */ }
      }
    },
    throwIfCancelled() {
      if (cancelled) {
        const error = new Error("Operación cancelada por el usuario.");
        error.code = "CANCELLED";
        throw error;
      }
    },
    registerAbort(abort) {
      aborts.add(abort);
      return () => aborts.delete(abort);
    },
  };
}
