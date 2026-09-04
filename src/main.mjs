import { loadConfig, applyNetworkEnvironment } from "./config.mjs";
import { paths } from "./paths.mjs";
import { ensureDir } from "./util/fs.mjs";
import { configureLog, log } from "./util/log.mjs";
import { Router, createServer, probeRunningInstance } from "./server.mjs";
import { registerSystemRoutes } from "./routes/system.mjs";
import { registerKnowledgeRoutes } from "./routes/knowledge.mjs";
import { registerAssistantRoutes } from "./routes/assistant.mjs";
import { registerWorkRoutes } from "./routes/work.mjs";
import { sessionPool } from "./ai/copilot.mjs";
import { openInBrowser } from "./util/browser.mjs";

/**
 * Arranque de KDD Studio: configuración, carpetas de datos, servidor HTTP en 127.0.0.1 y apertura de una
 * pestaña en el navegador. Si ya hay una instancia escuchando, se reutiliza (solo se abre la pestaña).
 */
export async function startKddStudio({ openBrowser } = {}) {
  const config = await loadConfig();
  for (const dir of [paths.dataRoot, paths.chatsDir, paths.runsDir, paths.analysesDir, paths.uploadsDir, paths.copilotHome, paths.logsDir]) await ensureDir(dir);
  await ensureDir(config.paths.outputs).catch(() => undefined);
  await ensureDir(config.paths.knowledgeBases).catch(() => undefined);
  configureLog(paths.logsDir);
  if (applyNetworkEnvironment(config)) log.info("main", `Proxy de salida configurado: ${config.network.proxyUrl}`);

  const url = `http://${config.server.host}:${config.server.port}/`;
  const running = await probeRunningInstance(config.server.port, config.server.host);
  const shouldOpen = openBrowser ?? config.ui.openBrowser;
  if (running) {
    log.info("main", `KDD-Studio ya está en marcha (pid ${running.pid}). Se abre una pestaña en ${url}.`);
    if (shouldOpen) await openInBrowser(url, { preferred: config.ui.browser });
    return { url, reused: true };
  }

  const router = new Router();
  registerSystemRoutes(router);
  registerKnowledgeRoutes(router);
  registerAssistantRoutes(router);
  registerWorkRoutes(router);
  const server = createServer({ router, config });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.server.port, config.server.host, () => resolve());
  });
  log.info("main", `KDD-Studio ${config.product.version} escuchando en ${url} (datos en ${paths.dataRoot}).`);
  if (shouldOpen) await openInBrowser(url, { preferred: config.ui.browser });

  const shutdown = async (signal) => {
    log.info("main", `Cerrando KDD Studio (${signal})…`);
    await sessionPool.shutdown().catch(() => undefined);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => shutdown(signal));
  if (process.env.KDD_LAUNCHER_PID) {
    const parent = Number(process.env.KDD_LAUNCHER_PID);
    const timer = setInterval(() => {
      try {
        process.kill(parent, 0);
      } catch {
        clearInterval(timer);
        shutdown("launcher-exit");
      }
    }, 5000);
    timer.unref();
  }
  return { url, server, reused: false };
}
