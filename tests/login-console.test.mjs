import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile } from "node:fs/promises";

process.env.KDD_HOME = await mkdtemp(path.join(os.tmpdir(), "kdd-test-login-"));
const { quoteArgument, openLoginConsole } = await import("../src/util/console.mjs");

/** Ejecuta algo fingiendo ser Windows: es la plataforma donde la orden se rompía. */
async function comoWindows(task) {
  const real = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  try {
    return await task();
  } finally {
    Object.defineProperty(process, "platform", real);
  }
}

test("quoteArgument: entrecomilla solo lo que lo necesita", () => {
  assert.equal(quoteArgument("gh"), "gh");
  assert.equal(quoteArgument("C:\\Users\\p\\node.exe"), "C:\\Users\\p\\node.exe");
  assert.equal(quoteArgument("C:\\Program Files\\GitHub CLI\\gh.exe"), '"C:\\Program Files\\GitHub CLI\\gh.exe"');
});

/**
 * La regresión: la orden de login lleva dos rutas entrecomilladas dentro (el Node portable y el
 * codex.js empaquetado). Pasársela a cmd.exe como un argumento suelto hacía que Node la reescapara
 * con `\"`, que cmd no entiende, y la consola respondía
 * `'\"C:\...\node.exe\"' is not recognized as an internal or external command`.
 * Escrita en un fichero .cmd, las comillas llegan intactas.
 */
test("consola de login: la orden llega al .cmd sin reescapar", async () => {
  const node = "C:\\KDD-Assistant\\runtime\\node\\node.exe";
  const codex = "C:\\KDD-Assistant\\app\\node_modules\\@openai\\codex\\bin\\codex.js";
  const line = `${quoteArgument(node)} ${quoteArgument(codex)} login`;
  const result = await comoWindows(() => openLoginConsole({
    id: "codex-login",
    title: "KDD Assistant - Inicio de sesion con ChatGPT",
    lines: [line],
    note: "Sesion iniciada.",
  }));

  assert.equal(result.mode, "console");
  assert.ok(result.script.endsWith("codex-login.cmd"), result.script);
  const script = await readFile(result.script, "utf8");
  assert.ok(script.includes(`${node} ${codex} login`), script);
  // Ni una sola comilla escapada a la manera de C: eso era exactamente el fallo.
  assert.ok(!script.includes('\\"'), script);
  assert.ok(script.startsWith("@echo off\r\n"), JSON.stringify(script.slice(0, 20)));
  assert.match(script, /title KDD Assistant/);
});

test("consola de login: gh en Program Files conserva sus comillas", async () => {
  const gh = "C:\\Program Files\\GitHub CLI\\gh.exe";
  const line = `${quoteArgument(gh)} auth login --hostname bbva.ghe.com --web`;
  const result = await comoWindows(() => openLoginConsole({ id: "github-login", title: "KDD Studio", lines: [line] }));
  const script = await readFile(result.script, "utf8");
  assert.ok(script.includes(`"${gh}" auth login --hostname bbva.ghe.com --web`), script);
  assert.ok(!script.includes('\\"'), script);
});
