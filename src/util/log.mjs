import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

let logFile = null;
const pending = [];
let flushing = false;

export function configureLog(directory) {
  logFile = path.join(directory, "kdd.log");
  mkdir(directory, { recursive: true }).catch(() => undefined);
}

async function flush() {
  if (flushing || !logFile || !pending.length) return;
  flushing = true;
  const lines = pending.splice(0, pending.length).join("");
  try {
    await appendFile(logFile, lines, "utf8");
  } catch {
    /* el log nunca tira la aplicación */
  } finally {
    flushing = false;
    if (pending.length) flush();
  }
}

function write(level, scope, message, extra) {
  const line = `${new Date().toISOString()} [${level}] [${scope}] ${message}${extra ? ` ${typeof extra === "string" ? extra : JSON.stringify(extra)}` : ""}\n`;
  if (level === "error") process.stderr.write(line);
  else if (process.env.KDD_VERBOSE || level !== "debug") process.stdout.write(line);
  pending.push(line);
  flush();
}

export const log = {
  info: (scope, message, extra) => write("info", scope, message, extra),
  warn: (scope, message, extra) => write("warn", scope, message, extra),
  error: (scope, message, extra) => write("error", scope, message, extra),
  debug: (scope, message, extra) => write("debug", scope, message, extra),
};
