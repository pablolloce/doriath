import { HttpError, sendFile } from "../server.mjs";
import { getConfig, updateConfig, publicConfig } from "../config.mjs";
import { paths } from "../paths.mjs";
import { getAuthStatus, startGitHubLogin, logoutGitHub, getAuthenticatedUser, invalidateAuthCache } from "../auth/gh.mjs";
import { copilotStatus, getModelCatalog, invalidateModelCatalog } from "../ai/copilot.mjs";
import { pickFolder, listDirectory } from "../util/dialog.mjs";
import { listSources } from "../knowledge/sources.mjs";
import { listRegisteredRepositories } from "../work/repos.mjs";
import { runCommand } from "../util/process.mjs";
import { openInBrowser } from "../util/browser.mjs";
import { isPathWithin, readJson } from "../util/fs.mjs";
import path from "node:path";

/**
 * Identidad de la instalación en marcha. Sin esto es fácil creer que se está probando lo último
 * cuando en realidad se abrió el acceso directo de una instalación anterior.
 */
async function buildInfo() {
  const config = getConfig();
  const file = paths.installRoot ? path.join(paths.installRoot, "BUILD.json") : "";
  const data = file ? await readJson(file, null) : null;
  return {
    version: config.product.version,
    commit: data?.commit ? String(data.commit).slice(0, 8) : "",
    builtAt: data?.builtAt || "",
    installed: Boolean(paths.installRoot),
    root: paths.installRoot || paths.appRoot,
  };
}

/**
 * La carpeta de salidas (donde el asistente deja los documentos que genera) no puede coincidir con
 * ninguna base de conocimiento ni con ningún repositorio registrado, ni contenerlos: son carpetas que
 * KDD Studio no debe mezclar con lo que el usuario ya tiene versionado o catalogado.
 */
async function assertOutputPathsSeparate(patchPaths) {
  if (!patchPaths) return;
  const config = getConfig();
  const outputs = String(patchPaths.outputs ?? config.paths.outputs ?? "").trim();
  const knowledgeBases = String(patchPaths.knowledgeBases ?? config.paths.knowledgeBases ?? "").trim();
  if (outputs && knowledgeBases && (isPathWithin(outputs, knowledgeBases) || isPathWithin(knowledgeBases, outputs))) {
    throw new HttpError(400, "La carpeta de salidas y la carpeta de bases de conocimiento no pueden coincidir ni contenerse.");
  }
  if (!outputs) return;
  const sources = await listSources();
  for (const source of sources) {
    if (isPathWithin(outputs, source.path) || isPathWithin(source.path, outputs)) {
      throw new HttpError(400, `La carpeta de salidas coincide con la base de conocimiento "${source.name}" (${source.path}). Los documentos generados deben ir en una ruta aparte.`);
    }
    const repositories = await listRegisteredRepositories(source.path).catch(() => []);
    for (const repo of repositories) {
      if (isPathWithin(outputs, repo.path) || isPathWithin(repo.path, outputs)) {
        throw new HttpError(400, `La carpeta de salidas coincide con el repositorio "${repo.name}" (${repo.path}). Los documentos generados deben ir en una ruta aparte.`);
      }
    }
  }
}

export function registerSystemRoutes(router) {
  router.get("/api/health", async () => ({ ok: true, product: "KDD Studio", version: getConfig().product.version, pid: process.pid }));

  router.get("/api/status", async ({ query }) => {
    const config = getConfig();
    const auth = await getAuthStatus(config.github.host, { refresh: query.refresh === "1" });
    const git = await runCommand("git", ["--version"], { timeoutMs: 10000 });
    const user = auth.authenticated ? await getAuthenticatedUser(config.github.host).catch(() => null) : null;
    const copilot = auth.authenticated && query.copilot !== "0" ? await copilotStatus(config) : { available: false, error: auth.authenticated ? "" : "Sin sesión de GitHub." };
    const sources = await listSources();
    return {
      product: config.product,
      paths: { dataRoot: paths.dataRoot, outputs: config.paths.outputs, knowledgeBases: config.paths.knowledgeBases, installRoot: paths.installRoot },
      build: await buildInfo(),
      github: { host: config.github.host, ...auth, user },
      git: { installed: git.ok, version: git.ok ? git.stdout : "" },
      copilot,
      sources: sources.length,
    };
  });

  router.get("/api/auth/status", async ({ query }) => {
    const config = getConfig();
    const auth = await getAuthStatus(config.github.host, { refresh: query.refresh === "1" });
    const user = auth.authenticated ? await getAuthenticatedUser(config.github.host).catch(() => null) : null;
    return { host: config.github.host, ...auth, user };
  });

  router.post("/api/auth/login", async () => {
    const config = getConfig();
    return startGitHubLogin(config.github.host);
  });

  router.post("/api/auth/logout", async () => {
    const config = getConfig();
    const result = await logoutGitHub(config.github.host);
    invalidateModelCatalog();
    return result;
  });

  router.post("/api/auth/refresh", async () => {
    invalidateAuthCache();
    invalidateModelCatalog();
    return { ok: true };
  });

  router.get("/api/config", async () => publicConfig());

  router.put("/api/config", async ({ body }) => {
    await assertOutputPathsSeparate(body?.paths);
    const next = await updateConfig(body || {});
    invalidateModelCatalog();
    invalidateAuthCache();
    return publicConfig(next);
  });

  router.get("/api/models", async ({ query }) => {
    const config = getConfig();
    try {
      return await getModelCatalog(config, { refresh: query.refresh === "1" });
    } catch (error) {
      throw new HttpError(503, error.message);
    }
  });

  router.post("/api/dialog/folder", async ({ body }) => pickFolder({ title: body?.title || "Selecciona una carpeta", initial: body?.initial || "" }));

  router.get("/api/fs/list", async ({ query }) => listDirectory(query.path || ""));

  router.post("/api/open", async ({ body }) => {
    const target = String(body?.path || "");
    if (!target) throw new HttpError(400, "Indica una ruta.");
    if (process.platform === "win32") {
      const { spawnDetached } = await import("../util/process.mjs");
      spawnDetached("explorer.exe", [target]);
      return { opened: true };
    }
    return openInBrowser(`file://${target}`, { preferred: "default" });
  });

  router.get("/api/brand/:file", async ({ params, res }) => {
    const allowed = new Set(["tokens.css", "tokens.json"]);
    if (!allowed.has(params.file)) throw new HttpError(404, "No encontrado.");
    await sendFile(res, `${paths.brandDir}/${params.file}`);
  });
}
