import { inferRepositoryBlueprint, selectFilesToFetch } from "../repository-blueprint.mjs";
import { parseRepositoryUrl } from "../repository-url.mjs";
import { resolveGitlabToken } from "../secrets.mjs";
import { githubApiBase, resolveGitHubToken } from "./github.mjs";
import { normalizeApiError, requestJson, resolveProxyUrl } from "./http-client.mjs";

/**
 * Reads a repository's shape straight from GitLab/GitHub, without cloning it.
 *
 * This is what makes onboarding a repository something other than typing nine fields per unit: the
 * recursive tree endpoint returns the whole file listing in a handful of calls, and from there
 * repository-blueprint.mjs can tell batches from daemons, find the modules and derive the build
 * commands. A clone of a corporate monorepo takes minutes and gigabytes; this takes seconds.
 *
 * Every optional signal degrades on its own: a token without access to pipeline schedules loses the
 * strongest batch hint and says so in `notes`, but still returns modules and stacks. Only the
 * project metadata and the tree are load-bearing.
 */

// A repository whose tree does not fit in these pages is a repository nobody reads in one sitting
// either; the units are found near the surface, so the deep tail costs calls without adding signal.
const MAX_TREE_PAGES = 20;
const TREE_PAGE_SIZE = 100;
const MAX_FETCHED_FILES = 80;
const FILE_FETCH_CONCURRENCY = 6;
const REQUEST_TIMEOUT_NOTE = "Algunas llamadas a la API fallaron; la detección puede estar incompleta.";

async function mapWithLimit(items, limit, mapper) {
    const results = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await mapper(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}

async function completeTruncatedGitLabTree({ request, projectId, branch, paths, notes }) {
    const rootDirectories = [];
    for (let page = 1; page <= MAX_TREE_PAGES; page += 1) {
        const rootResponse = await request(
            `/projects/${projectId}/repository/tree?per_page=${TREE_PAGE_SIZE}&page=${page}`
            + (branch ? `&ref=${encodeURIComponent(branch)}` : ""),
        );
        if (!rootResponse.ok || !Array.isArray(rootResponse.payload)) {
            notes.push(`El árbol superó ${MAX_TREE_PAGES * TREE_PAGE_SIZE} entradas y no se pudo completar por carpetas.`);
            return;
        }
        rootDirectories.push(...rootResponse.payload
            .filter((entry) => entry?.type === "tree" && entry.path)
            .map((entry) => String(entry.path)));
        if (rootResponse.payload.length < TREE_PAGE_SIZE) break;
        if (page === MAX_TREE_PAGES) {
            notes.push(`La raíz supera ${MAX_TREE_PAGES * TREE_PAGE_SIZE} entradas: puede faltar alguna carpeta superior.`);
        }
    }

    const collected = new Set(paths);
    let truncatedDirectories = 0;
    let failedDirectories = 0;

    await mapWithLimit(rootDirectories, FILE_FETCH_CONCURRENCY, async (directory) => {
        for (let page = 1; page <= MAX_TREE_PAGES; page += 1) {
            const response = await request(
                `/projects/${projectId}/repository/tree?path=${encodeURIComponent(directory)}`
                + `&recursive=true&per_page=${TREE_PAGE_SIZE}&page=${page}`
                + (branch ? `&ref=${encodeURIComponent(branch)}` : ""),
            );
            if (!response.ok || !Array.isArray(response.payload)) {
                failedDirectories += 1;
                break;
            }
            for (const entry of response.payload) {
                if (entry?.type === "blob" && entry.path) collected.add(String(entry.path));
            }
            if (response.payload.length < TREE_PAGE_SIZE) break;
            if (page === MAX_TREE_PAGES) truncatedDirectories += 1;
        }
    });

    paths.splice(0, paths.length, ...collected);
    if (truncatedDirectories) {
        notes.push(`${truncatedDirectories} carpeta(s) superaron ${MAX_TREE_PAGES * TREE_PAGE_SIZE} entradas: puede faltar algún módulo profundo.`);
    }
    if (failedDirectories) {
        notes.push(`No se pudieron completar ${failedDirectories} carpeta(s) del árbol. ${REQUEST_TIMEOUT_NOTE}`);
    }
}

function normalizeHost(host) {
    return String(host || "").replace(/\/+$/, "");
}

/**
 * Raw file bodies come back as text, but requestJson parses anything that happens to be valid JSON
 * (package.json, angular.json, lerna.json...). Re-serializing is lossless for the purposes here —
 * the blueprint either JSON.parses it again or looks for dependency names inside it.
 */
function payloadAsText(payload) {
    if (payload == null) return "";
    if (typeof payload === "string") return payload;
    if (typeof payload.raw === "string") return payload.raw;
    try {
        return JSON.stringify(payload);
    } catch {
        return "";
    }
}

/* ── GitLab ─────────────────────────────────────────────────── */

function gitlabRequester({ config, token }) {
    const host = normalizeHost(config.gitlab?.host);
    return async (endpoint) => {
        const response = await requestJson(`${host}/api/v4${endpoint}`, {
            method: "GET",
            headers: { "content-type": "application/json", "PRIVATE-TOKEN": token },
            allowInsecureTls: Boolean(config.gitlab?.allowInsecureTls),
            proxyUrl: resolveProxyUrl(config),
        });
        return response;
    };
}

async function inspectGitLabRepository({ config, remoteProjectId, ref }) {
    if (!config.gitlab?.host) {
        throw new Error("Configura gitlab.host antes de analizar un repositorio de GitLab.");
    }
    const token = await resolveGitlabToken(config);
    if (!token) {
        const tokenName = config.gitlab.tokenEnvVar || "GITLAB_TOKEN";
        throw new Error(`Falta el token de GitLab. Configúralo en Configuración o en la variable ${tokenName}.`);
    }

    const request = gitlabRequester({ config, token });
    const projectId = encodeURIComponent(remoteProjectId);
    const notes = [];

    const projectResponse = await request(`/projects/${projectId}`);
    if (!projectResponse.ok) {
        throw new Error(`GitLab no devolvió el proyecto: ${normalizeApiError(projectResponse.payload, projectResponse.status)}`);
    }
    const raw = projectResponse.payload;
    const branch = String(ref || raw.default_branch || "").trim();

    if (raw.empty_repo) {
        return {
            project: { name: raw.name, defaultBranch: branch, webUrl: raw.web_url, description: raw.description },
            paths: [], files: {}, languages: {}, pipelineSchedules: [],
            notes: ["El repositorio está vacío en el remoto."],
        };
    }

    const paths = [];
    let truncated = false;
    for (let page = 1; page <= MAX_TREE_PAGES; page += 1) {
        const treeResponse = await request(
            `/projects/${projectId}/repository/tree?recursive=true&per_page=${TREE_PAGE_SIZE}&page=${page}`
            + (branch ? `&ref=${encodeURIComponent(branch)}` : ""),
        );
        if (!treeResponse.ok) {
            notes.push(`No se pudo listar el árbol completo: ${normalizeApiError(treeResponse.payload, treeResponse.status)}`);
            break;
        }
        const entries = Array.isArray(treeResponse.payload) ? treeResponse.payload : [];
        for (const entry of entries) {
            if (entry?.type === "blob" && entry.path) paths.push(String(entry.path));
        }
        if (entries.length < TREE_PAGE_SIZE) break;
        if (page === MAX_TREE_PAGES) truncated = true;
    }
    if (truncated) await completeTruncatedGitLabTree({ request, projectId, branch, paths, notes });

    const languagesResponse = await request(`/projects/${projectId}/languages`);
    const languages = languagesResponse.ok && languagesResponse.payload && !Array.isArray(languagesResponse.payload)
        ? languagesResponse.payload
        : {};
    if (!languagesResponse.ok) notes.push("El token no pudo leer los lenguajes del proyecto.");

    // Reporter role or above. Worth asking for anyway: a scheduled pipeline is the single most
    // reliable batch signal GitLab exposes.
    const schedulesResponse = await request(`/projects/${projectId}/pipeline_schedules?per_page=50`);
    const pipelineSchedules = schedulesResponse.ok && Array.isArray(schedulesResponse.payload)
        ? schedulesResponse.payload.map((schedule) => ({
            description: schedule.description || "",
            cron: schedule.cron || "",
            ref: schedule.ref || "",
            active: Boolean(schedule.active),
        }))
        : [];
    if (!schedulesResponse.ok) {
        notes.push("Sin permiso para leer las planificaciones de pipeline: la detección de batches pierde su señal más fiable.");
    }

    const wanted = selectFilesToFetch(paths, { maxFiles: MAX_FETCHED_FILES });
    const files = {};
    let failedFiles = 0;
    await mapWithLimit(wanted, FILE_FETCH_CONCURRENCY, async (filePath) => {
        const endpoint = `/projects/${projectId}/repository/files/${encodeURIComponent(filePath)}/raw`
            + (branch ? `?ref=${encodeURIComponent(branch)}` : "");
        try {
            const response = await request(endpoint);
            if (response.ok) files[filePath] = payloadAsText(response.payload);
            else failedFiles += 1;
        } catch {
            failedFiles += 1;
        }
    });
    if (failedFiles) notes.push(`No se pudieron leer ${failedFiles} manifiesto(s). ${REQUEST_TIMEOUT_NOTE}`);

    return {
        project: {
            name: raw.name || "",
            defaultBranch: branch,
            webUrl: raw.web_url || "",
            description: raw.description || "",
            namespacePath: raw.namespace?.full_path || "",
        },
        paths,
        files,
        languages,
        pipelineSchedules,
        notes,
    };
}

/* ── GitHub ─────────────────────────────────────────────────── */

async function inspectGitHubRepository({ config, remoteProjectId, ref }) {
    const [owner, repo] = String(remoteProjectId).split("/");
    const apiBase = githubApiBase(config.github?.host, config.github?.type);
    const token = await resolveGitHubToken(config.github?.host);
    const notes = ["GitHub no expone planificaciones de pipeline: los batches se detectan solo por manifiestos y CI."];

    const request = async (endpoint, accept = "application/vnd.github+json") => requestJson(`${apiBase}${endpoint}`, {
        method: "GET",
        headers: {
            accept,
            authorization: `Bearer ${token}`,
            "user-agent": "fenix",
            "x-github-api-version": "2022-11-28",
        },
        allowInsecureTls: false,
        proxyUrl: resolveProxyUrl(config),
    });

    const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const projectResponse = await request(repoPath);
    if (!projectResponse.ok) {
        throw new Error(`GitHub no devolvió el repositorio: ${normalizeApiError(projectResponse.payload, projectResponse.status)}`);
    }
    const raw = projectResponse.payload;
    const branch = String(ref || raw.default_branch || "main").trim();

    const treeResponse = await request(`${repoPath}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
    const paths = treeResponse.ok && Array.isArray(treeResponse.payload?.tree)
        ? treeResponse.payload.tree.filter((entry) => entry.type === "blob").map((entry) => String(entry.path))
        : [];
    if (!treeResponse.ok) notes.push("No se pudo listar el árbol del repositorio.");
    if (treeResponse.payload?.truncated) notes.push("GitHub truncó el árbol: puede faltar algún módulo profundo.");

    const languagesResponse = await request(`${repoPath}/languages`);
    // GitHub reports bytes per language, GitLab percentages: normalize to percentages so the
    // blueprint (and the UI) do not need to know which platform answered.
    const languages = {};
    if (languagesResponse.ok && languagesResponse.payload && typeof languagesResponse.payload === "object") {
        const total = Object.values(languagesResponse.payload).reduce((sum, value) => sum + (Number(value) || 0), 0);
        if (total > 0) {
            for (const [name, bytes] of Object.entries(languagesResponse.payload)) {
                languages[name] = Math.round((Number(bytes) / total) * 1000) / 10;
            }
        }
    }

    const wanted = selectFilesToFetch(paths, { maxFiles: MAX_FETCHED_FILES });
    const files = {};
    let failedFiles = 0;
    await mapWithLimit(wanted, FILE_FETCH_CONCURRENCY, async (filePath) => {
        try {
            const response = await request(
                `${repoPath}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`,
                "application/vnd.github.raw",
            );
            if (response.ok) files[filePath] = payloadAsText(response.payload);
            else failedFiles += 1;
        } catch {
            failedFiles += 1;
        }
    });
    if (failedFiles) notes.push(`No se pudieron leer ${failedFiles} manifiesto(s). ${REQUEST_TIMEOUT_NOTE}`);

    return {
        project: {
            name: raw.name || "",
            defaultBranch: branch,
            webUrl: raw.html_url || "",
            description: raw.description || "",
            namespacePath: raw.owner?.login || "",
        },
        paths,
        files,
        languages,
        pipelineSchedules: [],
        notes,
    };
}

/* ── Entry point ────────────────────────────────────────────── */

/**
 * Probes a repository by url and returns the blueprint of units it suggests configuring.
 * Nothing is persisted: the repositories screen shows this for the user to confirm.
 */
export async function inspectRemoteRepository({ config, url, platform = "gitlab", ref = "" }) {
    const normalizedPlatform = platform === "github" ? "github" : "gitlab";
    const { remoteProjectId } = parseRepositoryUrl(url, normalizedPlatform);

    const probe = normalizedPlatform === "github"
        ? await inspectGitHubRepository({ config, remoteProjectId, ref })
        : await inspectGitLabRepository({ config, remoteProjectId, ref });

    const blueprint = inferRepositoryBlueprint(probe);
    return {
        ...blueprint,
        platform: normalizedPlatform,
        url: String(url).trim(),
        remoteProjectId,
        scannedFiles: probe.paths.length,
        inspectedManifests: Object.keys(probe.files).length,
    };
}

/**
 * Sibling projects of the same GitLab group, so onboarding one repository can offer the rest of its
 * ecosystem instead of making the user paste ten urls. Never fatal: an empty list just means the
 * offer is not made.
 */
export async function listGroupProjects({ config, url }) {
    if (!config.gitlab?.host) return { projects: [], groupPath: "" };
    const token = await resolveGitlabToken(config);
    if (!token) return { projects: [], groupPath: "" };

    const { remoteProjectId } = parseRepositoryUrl(url, "gitlab");
    const segments = remoteProjectId.split("/").filter(Boolean);
    if (segments.length < 2) return { projects: [], groupPath: "" };
    const groupPath = segments.slice(0, -1).join("/");

    const request = gitlabRequester({ config, token });
    const response = await request(
        `/groups/${encodeURIComponent(groupPath)}/projects?per_page=100&archived=false&order_by=last_activity_at`,
    );
    if (!response.ok || !Array.isArray(response.payload)) return { projects: [], groupPath };

    return {
        groupPath,
        projects: response.payload
            .filter((project) => project.path_with_namespace !== remoteProjectId)
            .map((project) => ({
                name: project.name || "",
                pathWithNamespace: project.path_with_namespace || "",
                webUrl: project.web_url || "",
                description: project.description || "",
                lastActivityAt: project.last_activity_at || "",
            })),
    };
}
