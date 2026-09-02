#!/usr/bin/env node
import process from "node:process";
import { startDoriath } from "./main.mjs";
import { loadConfig } from "./config.mjs";
import { paths } from "./paths.mjs";
import { inspectGitHubCli } from "./auth/gh.mjs";
import { runCommand } from "./util/process.mjs";

const [, , command = "start", ...rest] = process.argv;

function flag(name) {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : undefined;
}

async function main() {
  if (command === "start") {
    const noBrowser = rest.includes("--no-browser");
    const port = flag("--port");
    if (port) process.env.DORIATH_PORT = port;
    const proxy = flag("--proxy");
    if (proxy) process.env.DORIATH_PROXY = proxy;
    const { url, reused } = await startDoriath({ openBrowser: noBrowser ? false : undefined });
    if (reused) process.exit(0);
    console.log(`Doriath disponible en ${url}`);
    return;
  }
  if (command === "doctor") {
    const config = await loadConfig();
    const gh = await inspectGitHubCli(config.github.host);
    const git = await runCommand("git", ["--version"], { timeoutMs: 10000 });
    console.log(`Datos:            ${paths.dataRoot}`);
    console.log(`Host GitHub:      ${config.github.host}`);
    console.log(`Proxy de salida:  ${config.network.proxyUrl || "(ninguno)"}`);
    console.log(`Git:              ${git.ok ? git.stdout : "NO DISPONIBLE"}`);
    console.log(`GitHub CLI:       ${gh.installed ? gh.version : "NO DISPONIBLE"}`);
    console.log(`Sesión gh:        ${gh.authenticated ? `OK (${gh.login || "usuario"})` : "NO INICIADA"}`);
    if (gh.authenticated) {
      const { copilotStatus } = await import("./ai/copilot.mjs");
      const status = await copilotStatus(config);
      console.log(`Copilot:          ${status.available ? `OK · ${status.models} modelos · auth ${status.authMode}` : `NO DISPONIBLE (${status.error})`}`);
    }
    return;
  }
  if (command === "models") {
    const config = await loadConfig();
    const { getModelCatalog } = await import("./ai/copilot.mjs");
    const catalog = await getModelCatalog(config, { refresh: true });
    for (const model of catalog.models) console.log(`${model.id.padEnd(32)} ${model.name}${model.multiplier ? ` (x${model.multiplier})` : ""}`);
    if (catalog.quota) console.log(`Cuota premium: ${catalog.quota.unlimited ? "ilimitada" : `${catalog.quota.remaining}/${catalog.quota.entitlement}`}`);
    return;
  }
  console.log(`Uso: doriath <start|doctor|models> [--port N] [--proxy URL] [--no-browser]`);
  process.exit(command === "help" || command === "--help" ? 0 : 1);
}

main().catch((error) => {
  console.error(`Doriath: ${error.message}`);
  process.exit(1);
});
