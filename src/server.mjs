import http from "node:http";
import path from "node:path";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { eventBus } from "./util/events.mjs";
import { log } from "./util/log.mjs";
import { paths } from "./paths.mjs";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".csv": "text/csv; charset=utf-8",
  ".zip": "application/zip",
};

export function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
}

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function compilePattern(pattern) {
  const keys = [];
  const source = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\*/g, "(.*)")
    .replace(/:([a-zA-Z0-9_]+)/g, (_, key) => {
      keys.push(key);
      return "([^/]+)";
    });
  return { regex: new RegExp(`^${source}$`), keys };
}

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    this.routes.push({ method, ...compilePattern(pattern), pattern, handler });
    return this;
  }

  get(pattern, handler) { return this.add("GET", pattern, handler); }
  post(pattern, handler) { return this.add("POST", pattern, handler); }
  put(pattern, handler) { return this.add("PUT", pattern, handler); }
  delete(pattern, handler) { return this.add("DELETE", pattern, handler); }

  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const found = route.regex.exec(pathname);
      if (!found) continue;
      const params = {};
      route.keys.forEach((key, index) => { params[key] = decodeURIComponent(found[index + 1]); });
      return { route, params };
    }
    return null;
  }
}

const MAX_BODY_BYTES = 250 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, "Cuerpo de la petición demasiado grande."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  if (res.writableEnded) return;
  const body = JSON.stringify(payload ?? null);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

export async function sendFile(res, file, { download = false, name } = {}) {
  const info = await stat(file);
  const headers = {
    "content-type": mimeFor(file),
    "content-length": info.size,
    "cache-control": "no-store",
  };
  if (download) headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(name || path.basename(file))}`;
  res.writeHead(200, headers);
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("error", reject);
    stream.on("end", resolve);
    stream.pipe(res);
  });
}

function isLocalHost(value) {
  const host = String(value || "").split(":")[0].toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

async function serveStatic(pathname, res) {
  const relative = pathname === "/" ? "/index.html" : pathname;
  const target = path.normalize(path.join(paths.publicDir, relative));
  if (!target.startsWith(paths.publicDir)) throw new HttpError(403, "Ruta no permitida.");
  try {
    const info = await stat(target);
    if (info.isFile()) {
      res.writeHead(200, { "content-type": mimeFor(target), "cache-control": path.extname(target) === ".html" ? "no-store" : "max-age=3600" });
      createReadStream(target).pipe(res);
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

function attachSse(req, res, url) {
  const channels = String(url.searchParams.get("channels") || "global").split(",").map((item) => item.trim()).filter(Boolean);
  const since = Number(url.searchParams.get("since") || 0);
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(":ok\n\n");
  const write = (event) => {
    if (res.writableEnded) return;
    res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };
  for (const channel of channels) {
    for (const event of eventBus.recent(channel)) if (event.id > since) write(event);
  }
  const listener = (event) => {
    if (channels.includes(event.channel) || channels.includes("*")) write(event);
  };
  eventBus.on("event", listener);
  const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(":hb\n\n"); }, 20000);
  req.on("close", () => {
    clearInterval(heartbeat);
    eventBus.off("event", listener);
  });
}

export function createServer({ router, config }) {
  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    const pathname = url.pathname;
    try {
      if (!isLocalHost(req.headers.host)) throw new HttpError(403, "Solo se admite acceso local.");
      if (req.method !== "GET" && req.headers.origin && !isLocalHost(new URL(req.headers.origin).host)) {
        throw new HttpError(403, "Origen no permitido.");
      }
      if (pathname === "/api/events" && req.method === "GET") {
        attachSse(req, res, url);
        return;
      }
      if (pathname.startsWith("/api/")) {
        const matched = router.match(req.method, pathname);
        if (!matched) throw new HttpError(404, `Ruta no encontrada: ${req.method} ${pathname}`);
        let body = {};
        if (req.method !== "GET" && req.method !== "HEAD") {
          const raw = await readBody(req);
          if (raw.length) {
            const type = String(req.headers["content-type"] || "");
            if (type.includes("application/json")) {
              try {
                body = JSON.parse(raw.toString("utf8"));
              } catch {
                throw new HttpError(400, "JSON inválido.");
              }
            } else {
              body = { raw, contentType: type };
            }
          }
        }
        const query = Object.fromEntries(url.searchParams.entries());
        const result = await matched.route.handler({ req, res, params: matched.params, query, body, url, config });
        if (!res.writableEnded) sendJson(res, 200, result ?? { ok: true });
        return;
      }
      if (req.method === "GET" && await serveStatic(pathname, res)) return;
      if (req.method === "GET" && !path.extname(pathname)) {
        await serveStatic("/index.html", res);
        return;
      }
      throw new HttpError(404, "No encontrado.");
    } catch (error) {
      const status = error.status || (error.code === "CANCELLED" ? 409 : 500);
      if (status >= 500) log.error("http", `${req.method} ${pathname} -> ${status}: ${error.stack || error.message}`);
      sendJson(res, status, { error: error.message, details: error.details, code: error.code });
    } finally {
      const elapsed = Date.now() - started;
      if (pathname.startsWith("/api/") && pathname !== "/api/events") log.debug("http", `${req.method} ${pathname} ${elapsed}ms`);
    }
  });
  server.keepAliveTimeout = 65000;
  return server;
}

export async function probeRunningInstance(port, host = "127.0.0.1") {
  try {
    const response = await fetch(`http://${host}:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.product === "KDD Studio" ? payload : null;
  } catch {
    return null;
  }
}
