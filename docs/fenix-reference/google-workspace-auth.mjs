import { createHash, randomBytes } from "node:crypto";
import {
  clearGoogleWorkspaceCredential,
  clearGoogleWorkspaceOAuthConfiguration,
  readGoogleWorkspaceCredential,
  readGoogleWorkspaceOAuthConfiguration,
  storeGoogleWorkspaceCredential,
  storeGoogleWorkspaceOAuthConfiguration,
} from "../security/google-workspace-credential-store.mjs";
import { requestJson, resolveProxyUrl } from "./http-client.mjs";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const PENDING_TTL_MS = 10 * 60 * 1000;
const pendingAuthorizations = new Map();
const accessTokenCache = new Map();

export const GOOGLE_WORKSPACE_SCOPES = Object.freeze([
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
]);

function normalizeAllowedDomains(value) {
  return (Array.isArray(value) ? value : String(value || "").split(","))
    .map((value) => value.trim().toLowerCase())
    .filter((value, index, values) => value && values.indexOf(value) === index);
}

function normalizeOAuthConfiguration(value = {}, configurationSource = null) {
  const clientId = String(value.clientId || "").trim();
  const clientSecret = String(value.clientSecret || "").trim();
  const allowedDomains = normalizeAllowedDomains(value.allowedDomains);
  const missingConfiguration = [
    ...(!clientId ? ["clientId"] : []),
    ...(!clientSecret ? ["clientSecret"] : []),
    ...(!allowedDomains.length ? ["allowedDomains"] : []),
  ];
  return {
    clientId,
    clientSecret,
    allowedDomains,
    missingConfiguration,
    configured: missingConfiguration.length === 0,
    configurationSource,
  };
}

function environmentOAuthConfiguration(env = process.env) {
  return normalizeOAuthConfiguration({
    clientId: env.FENIX_GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.FENIX_GOOGLE_OAUTH_CLIENT_SECRET,
    allowedDomains: env.FENIX_GOOGLE_WORKSPACE_ALLOWED_DOMAINS,
  }, "environment");
}

async function resolveOAuthConfiguration(rootDirectory, options = {}) {
  const environment = environmentOAuthConfiguration(options.env);
  if (environment.configured) return environment;
  const stored = await (options.readConfiguration || readGoogleWorkspaceOAuthConfiguration)(rootDirectory);
  return stored
    ? normalizeOAuthConfiguration(stored, "fenix")
    : { ...environment, configurationSource: null };
}

function publicOAuthConfiguration(configuration) {
  return {
    configured: configuration.configured,
    configurationSource: configuration.configurationSource,
    clientId: configuration.configurationSource === "fenix" ? configuration.clientId : "",
    allowedDomains: configuration.allowedDomains,
    hasClientSecret: Boolean(configuration.clientSecret),
    missingConfiguration: configuration.missingConfiguration,
  };
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function formBody(values) {
  return new URLSearchParams(Object.entries(values).filter(([, value]) => value != null)).toString();
}

async function postToken(values, { config, oauth, request = requestJson } = {}) {
  const response = await request(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: formBody({ ...values, client_id: oauth.clientId, client_secret: oauth.clientSecret }),
    proxyUrl: resolveProxyUrl(config),
  });
  if (!response.ok) {
    throw new Error(`Google OAuth token exchange failed (${response.status}): ${response.payload?.error_description || response.payload?.error || "unknown error"}`);
  }
  return response.payload;
}

function assertAuthorizedIdentity(user, allowedDomains) {
  const email = String(user?.email || "").trim().toLowerCase();
  const domain = email.split("@")[1] || "";
  if (!user?.email_verified || !allowedDomains.includes(domain)) {
    throw new Error("La cuenta Google no pertenece a un dominio corporativo autorizado.");
  }
  return email;
}

export async function beginGoogleWorkspaceAuthorization({
  rootDirectory,
  redirectUri,
  env = process.env,
  now = Date.now,
  readConfiguration,
} = {}) {
  const oauth = await resolveOAuthConfiguration(rootDirectory, { env, readConfiguration });
  if (!oauth.configured) {
    throw new Error("La integración directa de Google Workspace para Copilot está deshabilitada.");
  }
  const state = base64Url(randomBytes(32));
  const verifier = base64Url(randomBytes(64));
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  pendingAuthorizations.set(state, { verifier, redirectUri, oauth, expiresAt: now() + PENDING_TTL_MS });
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: oauth.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_WORKSPACE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    hd: oauth.allowedDomains[0],
  }).toString();
  return { authorizationUrl: url.toString(), state };
}

export async function completeGoogleWorkspaceAuthorization({
  rootDirectory,
  state,
  code,
  config,
  now = Date.now,
  request = requestJson,
  storeCredential = storeGoogleWorkspaceCredential,
} = {}) {
  const pending = pendingAuthorizations.get(String(state || ""));
  pendingAuthorizations.delete(String(state || ""));
  if (!pending || pending.expiresAt < now()) throw new Error("Google OAuth state is invalid or expired.");
  if (!code) throw new Error("Google OAuth did not return an authorization code.");
  const token = await postToken({
    code,
    code_verifier: pending.verifier,
    redirect_uri: pending.redirectUri,
    grant_type: "authorization_code",
  }, { config, oauth: pending.oauth, request });
  if (!token.refresh_token) throw new Error("Google OAuth did not return a refresh token.");
  const userResponse = await request(USERINFO_ENDPOINT, {
    method: "GET",
    headers: { authorization: `Bearer ${token.access_token}` },
    proxyUrl: resolveProxyUrl(config),
  });
  if (!userResponse.ok) throw new Error("Google OAuth could not verify the authorized identity.");
  const email = assertAuthorizedIdentity(userResponse.payload, pending.oauth.allowedDomains);
  const grantedScopes = new Set(String(token.scope || "").split(/\s+/).filter(Boolean));
  const missingScopes = GOOGLE_WORKSPACE_SCOPES.filter((scope) => !grantedScopes.has(scope));
  if (missingScopes.length) {
    throw new Error(`Google OAuth did not grant every required read-only scope: ${missingScopes.join(", ")}`);
  }
  const credential = {
    refreshToken: token.refresh_token,
    email,
    scopes: [...grantedScopes],
    connectedAt: new Date(now()).toISOString(),
  };
  await storeCredential(rootDirectory, credential);
  accessTokenCache.set(rootDirectory, {
    token: token.access_token,
    expiresAt: now() + Math.max(60, Number(token.expires_in) || 3600) * 1000,
  });
  return { connected: true, email, scopes: credential.scopes, connectedAt: credential.connectedAt };
}

export async function googleWorkspaceStatus(rootDirectory, options = {}) {
  const oauth = await resolveOAuthConfiguration(rootDirectory, options);
  if (!oauth.configured) {
    return {
      ...publicOAuthConfiguration(oauth),
      connected: false,
    };
  }
  const credential = await (options.readCredential || readGoogleWorkspaceCredential)(rootDirectory);
  return {
    ...publicOAuthConfiguration(oauth),
    connected: Boolean(credential?.refreshToken),
    email: credential?.email || "",
    scopes: credential?.scopes || [],
    connectedAt: credential?.connectedAt || null,
  };
}

export async function googleWorkspaceAccessToken(rootDirectory, config, options = {}) {
  const now = options.now || Date.now;
  const cached = accessTokenCache.get(rootDirectory);
  if (cached?.token && cached.expiresAt > now() + 60_000) return cached.token;
  const credential = await (options.readCredential || readGoogleWorkspaceCredential)(rootDirectory);
  if (!credential?.refreshToken) throw new Error("Google Workspace no está conectado en FENIX.");
  const oauth = await resolveOAuthConfiguration(rootDirectory, options);
  if (!oauth.configured) throw new Error("El cliente OAuth de Google Workspace ya no está configurado.");
  const token = await postToken({ refresh_token: credential.refreshToken, grant_type: "refresh_token" }, {
    config,
    oauth,
    request: options.request || requestJson,
  });
  accessTokenCache.set(rootDirectory, {
    token: token.access_token,
    expiresAt: now() + Math.max(60, Number(token.expires_in) || 3600) * 1000,
  });
  return token.access_token;
}

export async function disconnectGoogleWorkspace(rootDirectory, options = {}) {
  accessTokenCache.delete(rootDirectory);
  await (options.clearCredential || clearGoogleWorkspaceCredential)(rootDirectory);
  return googleWorkspaceStatus(rootDirectory, options);
}

export async function saveGoogleWorkspaceOAuthConfiguration(rootDirectory, input = {}, options = {}) {
  const environment = environmentOAuthConfiguration(options.env);
  if (environment.configured) {
    throw new Error("La configuración OAuth está administrada por la instalación de FENIX.");
  }
  const readConfiguration = options.readConfiguration || readGoogleWorkspaceOAuthConfiguration;
  const existing = await readConfiguration(rootDirectory);
  const configuration = normalizeOAuthConfiguration({
    clientId: input.clientId,
    clientSecret: String(input.clientSecret || "").trim() || existing?.clientSecret,
    allowedDomains: input.allowedDomains,
  }, "fenix");
  if (!configuration.configured) throw new Error("Client ID, Client Secret y dominio autorizado son obligatorios.");
  if (!configuration.clientId.endsWith(".apps.googleusercontent.com")) {
    throw new Error("El Client ID debe pertenecer a una aplicación OAuth Desktop de Google.");
  }
  if (configuration.allowedDomains.some((domain) => !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))) {
    throw new Error("Incluye únicamente dominios corporativos válidos, separados por comas.");
  }
  await (options.storeConfiguration || storeGoogleWorkspaceOAuthConfiguration)(rootDirectory, {
    clientId: configuration.clientId,
    clientSecret: configuration.clientSecret,
    allowedDomains: configuration.allowedDomains,
  });
  accessTokenCache.delete(rootDirectory);
  await (options.clearCredential || clearGoogleWorkspaceCredential)(rootDirectory);
  return { ...publicOAuthConfiguration(configuration), connected: false };
}

export async function clearGoogleWorkspaceConfiguration(rootDirectory, options = {}) {
  const environment = environmentOAuthConfiguration(options.env);
  if (environment.configured) {
    throw new Error("La configuración OAuth está administrada por la instalación de FENIX.");
  }
  accessTokenCache.delete(rootDirectory);
  await Promise.all([
    (options.clearConfiguration || clearGoogleWorkspaceOAuthConfiguration)(rootDirectory),
    (options.clearCredential || clearGoogleWorkspaceCredential)(rootDirectory),
  ]);
  return googleWorkspaceStatus(rootDirectory, options);
}