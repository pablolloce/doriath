import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";

process.env.DORIATH_HOME = await mkdtemp(path.join(os.tmpdir(), "doriath-test-auth-"));
const { inspectGitHubCli, invalidateAuthCache } = await import("../src/auth/gh.mjs");

/**
 * Instala un `gh` simulado al principio del PATH. `behaviour` es un script shell que recibe los
 * argumentos de gh; así se reproducen los casos reales sin depender de la CLI instalada.
 */
async function fakeGh(behaviour) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "doriath-fake-gh-"));
  const file = path.join(dir, "gh");
  await writeFile(file, `#!/bin/sh\n${behaviour}\n`, "utf8");
  await chmod(file, 0o755);
  process.env.PATH = `${dir}${path.delimiter}${process.env.PATH}`;
  invalidateAuthCache();
  return dir;
}

const ORIGINAL_PATH = process.env.PATH;
test.afterEach(() => {
  process.env.PATH = ORIGINAL_PATH;
  invalidateAuthCache();
});

test("gh auth: sesión válida detectada por auth status", async () => {
  await fakeGh(`
case "$1 $2" in
  "--version ") echo "gh version 2.96.0 (2026-01-01)"; exit 0;;
  "auth status") echo "bbva.ghe.com"; echo "  ✓ Logged in to bbva.ghe.com account ana.lopez (keyring)"; exit 0;;
  "auth token") echo "gho_token"; exit 0;;
esac
exit 1`);
  const status = await inspectGitHubCli("bbva.ghe.com");
  assert.equal(status.installed, true);
  assert.equal(status.authenticated, true);
  assert.equal(status.login, "ana.lopez");
  assert.equal(status.warning, "");
});

test("gh auth: si auth status falla pero hay token, la sesión cuenta como válida", async () => {
  // Reproduce la red corporativa: gh no puede validar el token contra la API (proxy/SSO) y devuelve
  // un código distinto de cero, aunque la sesión existe y el token es utilizable.
  await fakeGh(`
case "$1 $2" in
  "--version ") echo "gh version 2.96.0 (2026-01-01)"; exit 0;;
  "auth status") echo "error connecting to bbva.ghe.com: proxy error" >&2; exit 1;;
  "auth token") echo "gho_token_valido"; exit 0;;
esac
exit 1`);
  const status = await inspectGitHubCli("bbva.ghe.com");
  assert.equal(status.authenticated, true, "el token guardado manda sobre el fallo de validación");
  assert.match(status.warning, /no ha podido validarla/);
});

test("gh auth: sin sesión, informa de los hosts donde sí la hay", async () => {
  await fakeGh(`
case "$1 $2" in
  "--version ") echo "gh version 2.96.0 (2026-01-01)"; exit 0;;
  "auth status")
    if [ "$3" = "--hostname" ]; then echo "no sessions for bbva.ghe.com" >&2; exit 1; fi
    echo "github.com"; echo "  ✓ Logged in to github.com account ana (keyring)"; exit 0;;
  "auth token") exit 1;;
esac
exit 1`);
  const status = await inspectGitHubCli("bbva.ghe.com");
  assert.equal(status.authenticated, false);
  assert.deepEqual(status.otherHosts, ["github.com"]);
  assert.match(status.authOutput, /no sessions/);
});

test("gh auth: sin gh instalado", async () => {
  await fakeGh("exit 127");
  const status = await inspectGitHubCli("bbva.ghe.com");
  assert.equal(status.installed, false);
  assert.equal(status.authenticated, false);
});
