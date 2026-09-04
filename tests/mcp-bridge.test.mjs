import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { mkdtemp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

process.env.KDD_HOME = await mkdtemp(path.join(os.tmpdir(), "kdd-test-mcp-"));
const { defineKddTool } = await import("../src/ai/tool-kit.mjs");
const { registerToolSet, unregisterToolSet, registerMcpBridgeRoutes, listBridgeTools, callBridgeTool } = await import("../src/ai/mcp-bridge.mjs");
const { Router } = await import("../src/server.mjs");

const serverScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "mcp", "kdd-mcp-server.mjs");

const echo = defineKddTool("echo", {
  description: "Devuelve lo que le llega",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  handler: async ({ text }) => `eco: ${text}`,
});
const boom = defineKddTool("boom", {
  description: "Falla siempre",
  handler: async () => { throw new Error("se rompió"); },
});

test("tool-kit: el envoltorio devuelve texto y convierte los fallos", async () => {
  assert.equal(await echo.handler({ text: "hola" }), "eco: hola");
  assert.equal(await boom.handler({}), "ERROR: se rompió");
  const structured = defineKddTool("json", { handler: async () => ({ a: 1 }) });
  assert.equal(await structured.handler({}), '{\n  "a": 1\n}');
});

test("puente MCP: el secreto es obligatorio y muere con la conversación", async () => {
  const { token } = registerToolSet("chat-1", [echo, boom]);
  assert.equal(listBridgeTools("chat-1", token).length, 2);
  assert.equal(listBridgeTools("chat-1", token)[0].inputSchema.properties.text.type, "string");
  assert.throws(() => listBridgeTools("chat-1", "otro"), /Credencial no válida/);
  assert.throws(() => listBridgeTools("chat-2", token), /ya no está activo/);
  assert.equal(await callBridgeTool("chat-1", token, "echo", { text: "x" }), "eco: x");
  await assert.rejects(() => callBridgeTool("chat-1", token, "no-existe", {}), /Herramienta desconocida/);
  unregisterToolSet("chat-1");
  assert.throws(() => listBridgeTools("chat-1", token), /ya no está activo/);
});

/** Servidor mínimo con las rutas del puente, para hablar con el proceso MCP de verdad. */
async function startBridgeServer() {
  const router = new Router();
  registerMcpBridgeRoutes(router);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const matched = router.match(req.method, url.pathname);
    if (!matched) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "no encontrado" }));
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    try {
      const result = await matched.route.handler({ req, res, params: matched.params, query: {}, body: raw ? JSON.parse(raw) : {}, url });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(error.status || 500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port };
}

/** Cliente JSON-RPC de juguete contra el proceso MCP, por stdio y una línea por mensaje. */
function mcpClient(child) {
  let buffer = "";
  const pending = new Map();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  let next = 1;
  return (method, params) => new Promise((resolve, reject) => {
    const id = next++;
    pending.set(id, (message) => (message.error ? reject(new Error(message.error.message)) : resolve(message.result)));
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    setTimeout(() => reject(new Error(`sin respuesta a ${method}`)), 15000).unref();
  });
}

test("servidor MCP: initialize, tools/list y tools/call contra el puente real", async (t) => {
  const { server, port } = await startBridgeServer();
  const { token } = registerToolSet("chat-mcp", [echo, boom]);
  const child = spawn(process.execPath, [serverScript], {
    env: { ...process.env, KDD_MCP_URL: `http://127.0.0.1:${port}`, KDD_MCP_KEY: "chat-mcp", KDD_MCP_TOKEN: token },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(async () => {
    child.kill();
    unregisterToolSet("chat-mcp");
    await new Promise((resolve) => server.close(resolve));
  });
  const call = mcpClient(child);

  const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(init.protocolVersion, "2025-06-18");
  assert.ok(init.capabilities.tools);

  const list = await call("tools/list", {});
  assert.deepEqual(list.tools.map((tool) => tool.name).sort(), ["boom", "echo"]);

  const result = await call("tools/call", { name: "echo", arguments: { text: "desde MCP" } });
  assert.deepEqual(result.content, [{ type: "text", text: "eco: desde MCP" }]);

  // Una herramienta que revienta es texto para el modelo, no un error de protocolo.
  const failed = await call("tools/call", { name: "boom", arguments: {} });
  assert.match(failed.content[0].text, /^ERROR: se rompió$/);

  await assert.rejects(() => call("tools/call", { name: "no-existe", arguments: {} }), /Herramienta desconocida/);
  await assert.rejects(() => call("herramientas/inventadas", {}), /No soportado|no soportado/i);
});
