"use strict";
const https = require("node:https");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

/** Descarga con seguimiento de redirecciones y soporte de proxy por variables de entorno (sin dependencias). */
function download(url, destination, { onProgress, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
    const client = target.protocol === "http:" ? http : https;
    let request;
    if (proxy) {
      // Túnel CONNECT sencillo a través del proxy corporativo.
      const proxyUrl = new URL(proxy);
      const connectRequest = http.request({ host: proxyUrl.hostname, port: proxyUrl.port || 80, method: "CONNECT", path: `${target.hostname}:${target.port || 443}`, headers: proxyUrl.username ? { "proxy-authorization": `Basic ${Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`).toString("base64")}` } : {} });
      connectRequest.on("connect", (response, socket) => {
        if (response.statusCode !== 200) {
          reject(new Error(`El proxy rechazó la conexión (${response.statusCode}).`));
          return;
        }
        request = https.request({ host: target.hostname, path: `${target.pathname}${target.search}`, method: "GET", socket, agent: false, headers: { "user-agent": "kdd-launcher" }, servername: target.hostname }, handleResponse);
        request.on("error", reject);
        request.end();
      });
      connectRequest.on("error", reject);
      connectRequest.end();
    } else {
      request = client.get(url, { headers: { "user-agent": "kdd-launcher" } }, handleResponse);
      request.on("error", reject);
    }
    function handleResponse(response) {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        if (redirects <= 0) { reject(new Error("Demasiadas redirecciones.")); return; }
        download(new URL(response.headers.location, url).toString(), destination, { onProgress, redirects: redirects - 1 }).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Descarga fallida (${response.statusCode}) de ${url}`));
        return;
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const total = Number(response.headers["content-length"] || 0);
      let received = 0;
      const file = fs.createWriteStream(destination);
      response.on("data", (chunk) => { received += chunk.length; onProgress?.(received, total); });
      response.pipe(file);
      file.on("finish", () => file.close(() => resolve(destination)));
      file.on("error", reject);
      response.on("error", reject);
    }
  });
}

module.exports = { download };
