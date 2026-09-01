import { mapWithConcurrency } from "../concurrency.mjs";
import { runCommand } from "../process.mjs";
import { normalizeApiError, requestJson, resolveProxyUrl } from "./http-client.mjs";
import { pullRequestDetailCache } from "./pull-request-cache.mjs";

const PR_DETAIL_CONCURRENCY = 6;
const GITHUB_TOKEN_TTL_MS = 30_000;
const githubTokenCache = new Map();

export async function inspectGitHubCli(host) {
  const version = await runCommand("gh", ["--version"]);
  if (!version.ok) {
    return {
      installed: false,
      authenticated: false,
      error: version.error || "GitHub CLI is not installed.",
    };
  }

  const auth = await runCommand("gh", ["auth", "status", "--hostname", host], { timeoutMs: 20000 });
  return {
    installed: true,
    version: version.stdout.split(/\r?\n/)[0],
    authenticated: auth.ok,
    authOutput: auth.ok ? auth.stdout || auth.stderr : auth.stderr || auth.stdout,
  };
}

export function remoteMatchesHost(remote, host) {
  if (!remote) return false;
  const normalized = String(remote).toLowerCase();
  return normalized.includes(String(host).toLowerCase());
}

function normalizeHostname(host) {
  return String(host || "").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/**
 * Builds the REST API base for a GitHub host, following GitHub's own hosting split:
 * github.com and GHE Cloud custom subdomains use api.<host>, self-hosted GHE Server instances
 * are reached at <host>/api/v3.
 */
export function githubApiBase(host, type) {
  const hostname = normalizeHostname(host);
  if (!hostname) {
    throw new Error("github.host is required to access GitHub.");
  }
  if (hostname === "github.com") return "https://api.github.com";
  if (type === "ghes") return `https://${hostname}/api/v3`;
  return `https://api.${hostname}`;
}

/**
 * Reuses the `gh` CLI's signed-in session instead of asking for a stored PAT, matching how
 * Copilot authentication already works in this app (signed-in-user, no BYOK).
 */
export function clearGitHubTokenCache(host = "") {
  if (host) githubTokenCache.delete(normalizeHostname(host));
  else githubTokenCache.clear();
}

export async function resolveGitHubToken(host) {
  const hostname = normalizeHostname(host);
  const cached = githubTokenCache.get(hostname);
  if (cached?.expiresAt > Date.now()) return cached.promise;
  const entry = {
    expiresAt: Date.now() + GITHUB_TOKEN_TTL_MS,
    promise: runCommand("gh", ["auth", "token", "--hostname", hostname], { timeoutMs: 15000 })
      .then((result) => {
        if (!result.ok || !result.stdout) {
          throw new Error(`No hay sesión activa de GitHub CLI para ${hostname}. Ejecuta "gh auth login --hostname ${hostname}".`);
        }
        return result.stdout.trim();
      }),
  };
  githubTokenCache.set(hostname, entry);
  try {
    return await entry.promise;
  } catch (error) {
    if (githubTokenCache.get(hostname) === entry) githubTokenCache.delete(hostname);
    throw error;
  }
}

function ensureRepoSlug(repository) {
  const slug = String(repository.remoteProjectId || repository.gitlabProjectId || "").trim();
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(slug);
  if (!match) {
    throw new Error(`Repository ${repository.id} does not define a valid GitHub "owner/repo" identifier (got "${slug || "empty"}").`);
  }
  return { owner: match[1], repo: match[2] };
}

async function githubRequest({ config, repository, method, endpoint, body, token: providedToken }) {
  if (!config.github?.host) {
    throw new Error("github.host is required to access GitHub.");
  }

  const token = providedToken || await resolveGitHubToken(config.github.host);
  const apiBase = githubApiBase(config.github.host, config.github.type);
  const { owner, repo } = ensureRepoSlug(repository);
  const url = `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${endpoint}`;

  try {
    const response = await requestJson(url, {
      method,
      headers: {
        "content-type": "application/json",
        "accept": "application/vnd.github+json",
        "authorization": `Bearer ${token}`,
        "user-agent": "fenix",
        "x-github-api-version": "2022-11-28",
      },
      body: body ? JSON.stringify(body) : undefined,
      allowInsecureTls: false,
      proxyUrl: resolveProxyUrl(config),
    });

    if (!response.ok) {
      throw new Error(`GitHub request failed for ${repository.id}: ${normalizeApiError(response.payload, response.status)}`);
    }

    return response.payload;
  } catch (error) {
    if (/^GitHub request failed for/.test(error.message)) {
      throw error;
    }
    const code = error.code ? `${error.code}: ` : "";
    throw new Error(`GitHub request failed for ${repository.id} at ${apiBase}: ${code}${error.message}`);
  }
}

// Normalized to the same shape as gitlab.mjs's summarizeMergeRequest (iid, webUrl, mergeStatus,
// pipelineStatus, changes[], ...) so downstream consumers (buildPullRequestAttachment, the
// pull-requests UI, PR validation) work unchanged regardless of which provider a repo uses.
function summarizePullRequest(raw, repository) {
  return {
    repositoryId: repository.id,
    repositoryName: repository.name,
    projectId: String(repository.remoteProjectId || repository.gitlabProjectId || repository.id || ""),
    iid: Number(raw.number),
    title: raw.title || `PR ${raw.number}`,
    description: raw.body || "",
    webUrl: raw.html_url || "",
    state: raw.merged_at || raw.merged ? "merged" : (raw.state || "open"),
    sourceBranch: raw.head?.ref || "",
    targetBranch: raw.base?.ref || "",
    author: raw.user?.login || "",
    authorUsername: raw.user?.login || "",
    draft: Boolean(raw.draft),
    updatedAt: raw.updated_at || raw.created_at || "",
    createdAt: raw.created_at || "",
    sha: raw.head?.sha || "",
    mergeStatus: raw.mergeable_state || (raw.mergeable === false ? "conflict" : ""),
    pipelineStatus: "",
    changesCount: Number(raw.changed_files || 0),
  };
}

// Mirrors gitlab.mjs's listPendingMergeRequests: the list endpoint omits mergeable_state and
// changed_files, so each item is enriched with a single GET of the full PR.
export async function listPendingPullRequests({
  config,
  repository,
  refresh = false,
  resolveToken = resolveGitHubToken,
  request = githubRequest,
  detailCache = pullRequestDetailCache,
  detailConcurrency = PR_DETAIL_CONCURRENCY,
}) {
  if (!config.github?.host) throw new Error("github.host is required to access GitHub.");
  const token = await resolveToken(config.github.host);
  const payload = await request({
    config,
    repository,
    method: "GET",
    endpoint: "/pulls?state=open&sort=updated&direction=desc&per_page=50",
    token,
  });

  if (!Array.isArray(payload)) return [];

  const enriched = await mapWithConcurrency(payload, detailConcurrency, async (item) => {
    try {
      const slug = String(repository.remoteProjectId || repository.gitlabProjectId || repository.id || "");
      return await detailCache.get({
        key: `github:${config.configPath || config.project?.id || "default"}:${config.github.host}:${slug}:${item.number}`,
        version: `${item.updated_at || ""}:${item.head?.sha || ""}`,
        refresh,
        load: () => request({
          config,
          repository,
          method: "GET",
          endpoint: `/pulls/${encodeURIComponent(item.number)}`,
          token,
        }),
      });
    } catch (error) {
      console.error(`[github] Could not fetch detail for ${repository.id} #${item.number}: ${error.message}`);
      return { ...item, __detailError: error.message };
    }
  });

  return enriched.map((item) => {
    const summary = summarizePullRequest(item, repository);
    if (item.__detailError) summary.detailError = item.__detailError;
    return summary;
  });
}

export async function listClosedPullRequests({
  config,
  repository,
  perPage = 20,
  resolveToken = resolveGitHubToken,
  request = githubRequest,
}) {
  const token = await resolveToken(config.github.host);
  const payload = await request({
    config,
    repository,
    method: "GET",
    endpoint: `/pulls?state=closed&sort=updated&direction=desc&per_page=${encodeURIComponent(perPage)}`,
    token,
  });
  return Array.isArray(payload) ? payload.map((item) => summarizePullRequest(item, repository)) : [];
}

export async function getPullRequestDetails({ config, repository, mergeRequestIid }) {
  const [pr, files] = await Promise.all([
    githubRequest({ config, repository, method: "GET", endpoint: `/pulls/${encodeURIComponent(mergeRequestIid)}` }),
    githubRequest({ config, repository, method: "GET", endpoint: `/pulls/${encodeURIComponent(mergeRequestIid)}/files?per_page=100` }),
  ]);

  return {
    ...summarizePullRequest(pr, repository),
    changes: Array.isArray(files)
      ? files.map((file) => ({
        oldPath: file.previous_filename || file.filename || "",
        newPath: file.filename || "",
        diff: file.patch || "",
        newFile: file.status === "added",
        renamedFile: file.status === "renamed",
        deletedFile: file.status === "removed",
      }))
      : [],
  };
}

export async function createPullRequestNote({ config, repository, mergeRequestIid, body }) {
  return githubRequest({
    config,
    repository,
    method: "POST",
    endpoint: `/issues/${encodeURIComponent(mergeRequestIid)}/comments`,
    body: { body },
  });
}

/** Resolves the identity behind the `gh` CLI session, used to detect "own" pull requests. */
export async function getAuthenticatedGitHubUser({ config }) {
  const token = await resolveGitHubToken(config.github.host);
  const apiBase = githubApiBase(config.github.host, config.github.type);
  const response = await requestJson(`${apiBase}/user`, {
    method: "GET",
    headers: {
      "accept": "application/vnd.github+json",
      "authorization": `Bearer ${token}`,
      "user-agent": "fenix",
      "x-github-api-version": "2022-11-28",
    },
    allowInsecureTls: false,
    proxyUrl: resolveProxyUrl(config),
  });
  if (!response.ok) {
    throw new Error(`GitHub request failed: ${normalizeApiError(response.payload, response.status)}`);
  }
  return { username: response.payload.login || "", name: response.payload.name || "" };
}

// GitHub review comments (file/line-anchored) are grouped into threads via in_reply_to_id; the
// REST API has no "resolved" concept for review threads (that's GraphQL-only), so every thread is
// reported as not resolvable/not resolved — callers treat every open thread as a candidate.
export async function listPullRequestReviewThreads({ config, repository, mergeRequestIid }) {
  const comments = await githubRequest({
    config,
    repository,
    method: "GET",
    endpoint: `/pulls/${encodeURIComponent(mergeRequestIid)}/comments?per_page=100`,
  });

  if (!Array.isArray(comments)) return [];

  const roots = comments.filter((comment) => !comment.in_reply_to_id);
  return roots.map((root) => {
    const replies = comments.filter((comment) => comment.in_reply_to_id === root.id);
    return {
      id: String(root.id),
      resolvable: false,
      resolved: false,
      notes: [root, ...replies].map((comment) => ({
        id: comment.id,
        author: comment.user?.login || "",
        authorUsername: comment.user?.login || "",
        body: comment.body || "",
        system: false,
        createdAt: comment.created_at || "",
      })),
    };
  });
}

export async function replyToPullRequestReviewComment({ config, repository, mergeRequestIid, discussionId, body }) {
  return githubRequest({
    config,
    repository,
    method: "POST",
    endpoint: `/pulls/${encodeURIComponent(mergeRequestIid)}/comments/${encodeURIComponent(discussionId)}/replies`,
    body: { body },
  });
}

export async function createGitHubPullRequest({ config, repository, title, description, sourceBranch, targetBranch }) {
  const payload = await githubRequest({
    config,
    repository,
    method: "POST",
    endpoint: "/pulls",
    body: {
      title,
      body: description,
      head: sourceBranch,
      base: targetBranch,
    },
  });

  return {
    id: payload.number,
    webUrl: payload.html_url,
    sourceBranch,
    targetBranch,
    title,
  };
}
