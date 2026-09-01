import path from "node:path";
import { googleWorkspaceAccessToken } from "./google-workspace-auth.mjs";
import { requestJson, resolveProxyUrl } from "./http-client.mjs";

const MAX_RESULTS = 10;
const MAX_STRING = 8_000;
const GOOGLE_SOURCES = new Set(["gmail", "drive", "calendar"]);

export const GOOGLE_WORKSPACE_TOOL_NAMES = Object.freeze([
  "fenix_google_search",
  "fenix_google_read",
]);

export function googleWorkspaceRootDirectory(config) {
  const configPath = path.normalize(config?.configPath || "");
  const segments = configPath.split(path.sep);
  const workbenchIndex = segments.lastIndexOf(".workbench");
  const projectsIndex = segments.lastIndexOf("projects");
  if (workbenchIndex >= 0 && projectsIndex === workbenchIndex + 1) {
    return path.resolve(config.baseDirectory, "..", "..", "..");
  }
  return config?.baseDirectory || process.cwd();
}

function bounded(value, depth = 0) {
  if (depth > 6 || value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, MAX_STRING);
  if (Array.isArray(value)) return value.slice(0, MAX_RESULTS).map((item) => bounded(item, depth + 1));
  if (typeof value !== "object") return String(value).slice(0, MAX_STRING);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["raw", "raw_mime", "base64", "attachment_id"].includes(key.toLowerCase()))
    .map(([key, child]) => [key, bounded(child, depth + 1)]));
}

function clean(value, maxLength = 500) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength);
}

function header(message, name) {
  return message?.payload?.headers?.find((item) => String(item?.name || "").toLowerCase() === name)?.value || "";
}

function decodeBase64Url(value) {
  return Buffer.from(String(value || ""), "base64url").toString("utf8");
}

function gmailText(part) {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return decodeBase64Url(part.body.data);
  for (const child of part.parts || []) {
    const text = gmailText(child);
    if (text) return text;
  }
  return "";
}

function escapeDriveQuery(value) {
  return String(value || "").replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

async function authorizedRequest(url, { config, rootDirectory, request, accessToken, method = "GET" }) {
  const token = await accessToken(rootDirectory, config);
  const response = await request(url, {
    method,
    headers: { authorization: `Bearer ${token}` },
    proxyUrl: resolveProxyUrl(config),
  });
  if (!response.ok) {
    const detail = response.payload?.error?.message || response.payload?.error || `HTTP ${response.status}`;
    throw new Error(`Google Workspace request failed: ${detail}`);
  }
  return response.payload;
}

async function searchGmail(query, limit, context) {
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.search = new URLSearchParams({ q: `${query} -in:spam -in:trash`, maxResults: String(limit) }).toString();
  const listed = await authorizedRequest(listUrl, context);
  const results = [];
  for (const item of (listed.messages || []).slice(0, limit)) {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}`);
    url.search = new URLSearchParams({
      format: "metadata",
      metadataHeaders: "Subject",
    }).toString();
    const message = await authorizedRequest(url, context);
    results.push({
      id: clean(message.id),
      title: clean(header(message, "subject") || "Correo de Gmail"),
      occurredAt: clean(message.internalDate ? new Date(Number(message.internalDate)).toISOString() : ""),
      snippet: clean(message.snippet, 1_000),
      url: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(message.id)}`,
    });
  }
  return results;
}

async function searchDrive(query, limit, context) {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.search = new URLSearchParams({
    q: `trashed = false and fullText contains '${escapeDriveQuery(query)}'`,
    pageSize: String(limit),
    orderBy: "modifiedTime desc",
    fields: "files(id,name,mimeType,modifiedTime,webViewLink,description)",
  }).toString();
  const payload = await authorizedRequest(url, context);
  return (payload.files || []).slice(0, limit).map((item) => ({
    id: clean(item.id),
    title: clean(item.name || "Documento de Drive"),
    mimeType: clean(item.mimeType),
    occurredAt: clean(item.modifiedTime),
    snippet: clean(item.description, 1_000),
    url: clean(item.webViewLink, 2_000),
  }));
}

async function searchCalendar(query, limit, context) {
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.search = new URLSearchParams({
    q: query,
    maxResults: String(limit),
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
  }).toString();
  const payload = await authorizedRequest(url, context);
  return (payload.items || []).slice(0, limit).map((item) => ({
    id: clean(item.id),
    title: clean(item.summary || "Evento de Calendar"),
    occurredAt: clean(item.start?.dateTime || item.start?.date),
    snippet: clean(item.description, 1_000),
    url: clean(item.htmlLink, 2_000),
    calendarId: "primary",
  }));
}

async function readGmail(item, context) {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}`);
  url.searchParams.set("format", "full");
  const message = await authorizedRequest(url, context);
  return {
    id: message.id,
    subject: header(message, "subject"),
    from: header(message, "from"),
    to: header(message, "to"),
    date: header(message, "date"),
    text: gmailText(message.payload) || message.snippet || "",
  };
}

async function readDrive(item, context) {
  const googleMimeExports = {
    "application/vnd.google-apps.document": "text/plain",
    "application/vnd.google-apps.spreadsheet": "text/csv",
    "application/vnd.google-apps.presentation": "text/plain",
  };
  const exportMime = googleMimeExports[item.mimeType];
  let url;
  if (exportMime) {
    url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.id)}/export`);
    url.searchParams.set("mimeType", exportMime);
  } else if (/^(text\/|application\/(json|xml))/.test(item.mimeType || "")) {
    url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.id)}`);
    url.searchParams.set("alt", "media");
  } else {
    throw new Error("FENIX solo lee documentos Google o ficheros textuales de Drive.");
  }
  const payload = await authorizedRequest(url, context);
  return { id: item.id, title: item.title, mimeType: item.mimeType, text: payload.raw || payload };
}

async function readCalendar(item, context) {
  const calendarId = encodeURIComponent(item.calendarId || "primary");
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(item.id)}`);
  const event = await authorizedRequest(url, context);
  return {
    id: event.id,
    summary: event.summary,
    description: event.description,
    location: event.location,
    start: event.start,
    end: event.end,
    attendees: (event.attendees || []).map(({ email, responseStatus }) => ({ email, responseStatus })),
    htmlLink: event.htmlLink,
  };
}

export function createGoogleWorkspaceTools(options = {}) {
  const config = options.config || {};
  const rootDirectory = options.rootDirectory || googleWorkspaceRootDirectory(config);
  const request = options.request || requestJson;
  const accessToken = options.accessToken || googleWorkspaceAccessToken;
  const repositoryEvidence = options.repositoryEvidence || new Set();
  const repositoryReadEnabled = options.repositoryReadEnabled !== false;
  const discovered = new Map();
  const context = { config, rootDirectory, request, accessToken };

  const search = async ({ query, sources, limit = 5 }) => {
    const normalizedQuery = String(query || "").trim().slice(0, 200);
    const normalizedSources = [...new Set(sources || [])].filter((source) => GOOGLE_SOURCES.has(source));
    const normalizedLimit = Math.min(MAX_RESULTS, Math.max(1, Number(limit) || 5));
    if (!normalizedQuery || !normalizedSources.length) throw new Error("Google Workspace search requires a query and at least one source.");
    if (repositoryReadEnabled && repositoryEvidence.size === 0) {
      throw new Error("Revisa primero evidencia del repositorio antes de consultar Google Workspace.");
    }
    const output = {};
    for (const source of normalizedSources) {
      try {
        const items = source === "gmail"
          ? await searchGmail(normalizedQuery, normalizedLimit, context)
          : source === "drive"
            ? await searchDrive(normalizedQuery, normalizedLimit, context)
            : await searchCalendar(normalizedQuery, normalizedLimit, context);
        output[source] = { status: "available", items: bounded(items) };
        options.onCheck?.({ sourceType: source, query: normalizedQuery, status: "available", resultCount: items.length });
        for (const item of items) {
          discovered.set(`${source}:${item.id}`, { ...item, sourceType: source });
          options.onSource?.({ sourceType: source, operation: "search", sourceId: item.id, title: item.title, url: item.url, occurredAt: item.occurredAt });
        }
      } catch (error) {
        output[source] = { status: "unavailable", error: error.message };
        options.onCheck?.({ sourceType: source, query: normalizedQuery, status: "unavailable", resultCount: 0 });
      }
    }
    return bounded({ untrustedData: true, sources: output });
  };

  const read = async ({ source, id }) => {
    const item = discovered.get(`${source}:${clean(id)}`);
    if (!item) throw new Error("Google Workspace reads require an item returned by fenix_google_search in this execution.");
    const payload = source === "gmail"
      ? await readGmail(item, context)
      : source === "drive"
        ? await readDrive(item, context)
        : await readCalendar(item, context);
    options.onSource?.({ sourceType: source, operation: "read", sourceId: item.id, title: item.title, url: item.url, occurredAt: item.occurredAt });
    return bounded({ untrustedData: true, source, item: payload });
  };

  return [
    {
      name: "fenix_google_search",
      description: "Busca en Gmail, Google Drive y Google Calendar autorizados, siempre en solo lectura. Debe usarse después de revisar el repositorio cuando este esté disponible.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1, maxLength: 200 },
          sources: { type: "array", minItems: 1, maxItems: 3, uniqueItems: true, items: { type: "string", enum: [...GOOGLE_SOURCES] } },
          limit: { type: "integer", minimum: 1, maximum: MAX_RESULTS },
        },
        required: ["query", "sources"],
        additionalProperties: false,
      },
      skipPermission: true,
      defer: "never",
      handler: search,
    },
    {
      name: "fenix_google_read",
      description: "Lee en modo solo lectura un correo, documento o evento descubierto previamente por fenix_google_search.",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", enum: [...GOOGLE_SOURCES] },
          id: { type: "string", minLength: 1, maxLength: 500 },
        },
        required: ["source", "id"],
        additionalProperties: false,
      },
      skipPermission: true,
      defer: "never",
      handler: read,
    },
  ];
}