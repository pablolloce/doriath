#!/usr/bin/env node
/**
 * Servidor MCP de KDD, en stdio.
 *
 * Codex no admite herramientas dentro del proceso: las toma de servidores MCP que él mismo lanza.
 * Este proceso es la parte de fuera del puente: no sabe nada de bases de conocimiento, solo traduce
 * JSON-RPC de MCP a las dos llamadas HTTP que expone `src/ai/mcp-bridge.mjs` en el servidor local.
 *
 * Se configura por entorno porque Codex arranca el proceso y no hay dónde poner argumentos propios:
 *   KDD_MCP_URL    base del servidor local, p. ej. http://127.0.0.1:4601
 *   KDD_MCP_KEY    la conversación cuyas herramientas se publican
 *   KDD_MCP_TOKEN  el secreto de esa conversación
 *
 * El transporte de MCP en stdio es JSON-RPC delimitado por saltos de línea: un mensaje por línea, y
 * ningún salto dentro. Nada se escribe en stdout que no sea una respuesta; los avisos van a stderr,
 * que Codex recoge en su registro.
 */
const BASE = String(process.env.KDD_MCP_URL || "").replace(/\/$/, "");
const KEY = String(process.env.KDD_MCP_KEY || "");
const TOKEN = String(process.env.KDD_MCP_TOKEN || "");
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function bridge(pathname, options = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    ...options,
    headers: { "content-type": "application/json", "x-kdd-mcp-token": TOKEN, ...(options.headers || {}) },
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Una respuesta que no es JSON solo puede ser un fallo del servidor: se cuenta tal cual.
  }
  if (!response.ok) throw new Error(payload?.error || `El servidor de KDD respondió ${response.status}.`);
  return payload;
}

async function handle(message) {
  const { id, method, params } = message;
  // Las notificaciones (sin id) no llevan respuesta: `notifications/initialized` es la habitual.
  if (id === undefined || id === null) return;

  if (method === "initialize") {
    const asked = String(params?.protocolVersion || "");
    reply(id, {
      protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "kdd", version: "1" },
    });
    return;
  }
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") {
    const data = await bridge(`/api/mcp/${encodeURIComponent(KEY)}/tools`);
    return reply(id, { tools: data?.tools || [] });
  }
  if (method === "tools/call") {
    const data = await bridge(`/api/mcp/${encodeURIComponent(KEY)}/call`, {
      method: "POST",
      body: JSON.stringify({ name: params?.name, arguments: params?.arguments || {} }),
    });
    // Las herramientas devuelven texto: el `ERROR: …` de una que falla es información para el
    // modelo, no un fallo del protocolo, así que nunca se marca `isError`.
    return reply(id, { content: [{ type: "text", text: String(data?.text ?? "") }] });
  }
  fail(id, -32601, `Método no soportado: ${method}`);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      process.stderr.write(`[kdd-mcp] línea ilegible: ${error.message}\n`);
      continue;
    }
    handle(message).catch((error) => {
      process.stderr.write(`[kdd-mcp] ${error.message}\n`);
      if (message?.id !== undefined && message?.id !== null) fail(message.id, -32603, error.message);
    });
  }
});
process.stdin.on("end", () => process.exit(0));
