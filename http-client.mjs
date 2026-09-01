import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

/** Resolves the configured outbound proxy URL, or "" when disabled/unset (see config.mjs network.proxy). */
export function resolveProxyUrl(config) {
    const proxy = config?.network?.proxy;
    return proxy?.enabled && proxy?.url ? String(proxy.url).trim() : "";
}

// Establishes a raw TCP tunnel to `targetHost:targetPort` through an HTTP(S) forward proxy via the
// standard CONNECT method (RFC 7231 §4.3.6). Returns the tunneled socket once the proxy answers
// "200"; the caller is then responsible for speaking whatever protocol it needs over it (here: TLS).
function connectThroughProxy(proxyUrl, targetHost, targetPort) {
    return new Promise((resolve, reject) => {
        const proxy = new URL(proxyUrl);
        const socket = net.connect(Number(proxy.port) || 80, proxy.hostname);
        let buffer = Buffer.alloc(0);

        const onError = (error) => {
            socket.destroy();
            reject(new Error(`Proxy connection failed (${proxyUrl}): ${error.message}`));
        };

        socket.once("error", onError);
        socket.once("connect", () => {
            socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nProxy-Connection: Keep-Alive\r\n\r\n`);
        });

        function onData(chunk) {
            buffer = Buffer.concat([buffer, chunk]);
            const headerEnd = buffer.indexOf("\r\n\r\n");
            if (headerEnd === -1) return;
            socket.removeListener("data", onData);
            socket.removeListener("error", onError);
            const statusLine = buffer.slice(0, headerEnd).toString("ascii").split("\r\n")[0];
            const statusCode = Number(statusLine.split(" ")[1] || "0");
            if (statusCode !== 200) {
                socket.destroy();
                reject(new Error(`Proxy CONNECT to ${targetHost}:${targetPort} failed: ${statusLine}`));
                return;
            }
            resolve(socket);
        }
        socket.on("data", onData);
    });
}

function sendJsonRequest(transport, requestOptions, body, resolve, reject) {
    const request = transport.request(requestOptions, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            let payload = {};
            if (raw) {
                try {
                    payload = JSON.parse(raw);
                } catch {
                    payload = { raw };
                }
            }

            resolve({
                ok: Number(response.statusCode || 0) >= 200 && Number(response.statusCode || 0) < 300,
                status: Number(response.statusCode || 0),
                payload,
            });
        });
    });

    request.on("error", (error) => reject(error));
    if (body) request.write(body);
    request.end();
}

/**
 * Minimal JSON-over-HTTP(S) client shared by the GitLab, GitHub and SonarQube REST integrations.
 * Pass `proxyUrl` (see resolveProxyUrl above) to route the request through a corporate forward
 * proxy — required when only reachable over a VPN client (e.g. Ivanti) that exposes a local proxy.
 */
export function requestJson(url, { method, headers, body, allowInsecureTls = false, proxyUrl = "" }) {
    return new Promise((resolve, reject) => {
        const target = new URL(url);
        const isHttps = target.protocol === "https:";

        if (!proxyUrl) {
            const transport = isHttps ? https : http;
            sendJsonRequest(transport, {
                protocol: target.protocol,
                hostname: target.hostname,
                port: target.port || undefined,
                path: `${target.pathname}${target.search}`,
                method,
                headers,
                rejectUnauthorized: isHttps ? !allowInsecureTls : undefined,
            }, body, resolve, reject);
            return;
        }

        if (!isHttps) {
            // Plain HTTP through a proxy is just a normal request sent to the proxy itself, using
            // the absolute target URL as the request-target (RFC 7230 §5.3.2).
            const proxy = new URL(proxyUrl);
            sendJsonRequest(http, {
                host: proxy.hostname,
                port: Number(proxy.port) || 80,
                method,
                path: target.toString(),
                headers: { ...headers, host: target.host },
            }, body, resolve, reject);
            return;
        }

        connectThroughProxy(proxyUrl, target.hostname, Number(target.port) || 443)
            .then((socket) => new Promise((resolveTls, rejectTls) => {
                const tlsSocket = tls.connect({
                    socket,
                    servername: target.hostname,
                    rejectUnauthorized: !allowInsecureTls,
                }, () => resolveTls(tlsSocket));
                tlsSocket.once("error", rejectTls);
            }))
            .then((tlsSocket) => {
                const agent = new https.Agent({ keepAlive: false });
                agent.createConnection = (_options, callback) => callback(null, tlsSocket);
                sendJsonRequest(https, {
                    method,
                    headers: { ...headers, host: target.host },
                    path: `${target.pathname}${target.search}`,
                    agent,
                }, body, resolve, reject);
            })
            .catch(reject);
    });
}

export function normalizeApiError(payload, fallbackStatus) {
    if (Array.isArray(payload?.message)) return payload.message.join(", ");
    if (typeof payload?.message === "string") return payload.message;
    if (typeof payload?.error === "string") return payload.error;
    return fallbackStatus;
}
