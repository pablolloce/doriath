import { randomBytes } from "node:crypto";
import { log } from "../util/log.mjs";

/**
 * Puente entre las herramientas de KDD y Codex.
 *
 * Copilot acepta herramientas dentro del propio proceso: se le pasa la función y la llama. Codex no
 * tiene esa puerta —sus herramientas llegan por MCP, y un servidor MCP es un proceso aparte—, así
 * que el catálogo se publica por HTTP contra el servidor local que ya está en marcha y el proceso
 * MCP (`src/mcp/kdd-mcp-server.mjs`) no hace más que reenviar.
 *
 * Cada conversación registra su juego de herramientas bajo una clave y recibe un secreto de un solo
 * uso. El servidor escucha en 127.0.0.1, pero eso no basta: cualquier programa del equipo puede
 * llamar a un puerto local, y estas herramientas leen ficheros. El secreto va por cabecera, vive en
 * memoria y muere con la conversación.
 */
const registry = new Map();

export function registerToolSet(key, tools) {
  const existing = registry.get(key);
  // Se conserva el secreto mientras la conversación siga viva: el proceso MCP ya lo tiene.
  const token = existing?.token || randomBytes(24).toString("hex");
  const byName = new Map();
  for (const tool of tools || []) byName.set(tool.name, tool);
  registry.set(key, { token, tools: byName });
  return { key, token };
}

export function unregisterToolSet(key) {
  registry.delete(key);
}

function entryFor(key, token) {
  const entry = registry.get(key);
  if (!entry) throw Object.assign(new Error("El juego de herramientas ya no está activo."), { status: 404 });
  if (!token || token !== entry.token) throw Object.assign(new Error("Credencial no válida."), { status: 403 });
  return entry;
}

/** Catálogo en el formato que espera MCP: `inputSchema`, no `parameters`. */
export function listBridgeTools(key, token) {
  const entry = entryFor(key, token);
  return [...entry.tools.values()].map((tool) => ({
    name: tool.name,
    description: tool.description || "",
    inputSchema: tool.parameters || { type: "object", properties: {} },
  }));
}

export async function callBridgeTool(key, token, name, args) {
  const entry = entryFor(key, token);
  const tool = entry.tools.get(name);
  if (!tool) throw Object.assign(new Error(`Herramienta desconocida: ${name}`), { status: 404 });
  const started = Date.now();
  // El envoltorio de `tool-kit` ya convierte los fallos en texto `ERROR: …`, así que aquí no se
  // distingue entre éxito y error: lo que reciba el modelo es texto en los dos casos.
  const text = await tool.handler(args || {});
  log.debug("mcp", `${name} (${Date.now() - started} ms)`);
  return String(text ?? "");
}

export function registerMcpBridgeRoutes(router) {
  const credentials = ({ params, req }) => ({ key: params.key, token: String(req.headers["x-kdd-mcp-token"] || "") });

  router.get("/api/mcp/:key/tools", async (context) => {
    const { key, token } = credentials(context);
    return { tools: listBridgeTools(key, token) };
  });

  router.post("/api/mcp/:key/call", async (context) => {
    const { key, token } = credentials(context);
    const { name, arguments: args } = context.body || {};
    return { text: await callBridgeTool(key, token, String(name || ""), args) };
  });
}
