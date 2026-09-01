import { mapWithConcurrency } from "../concurrency.mjs";
import { resolveGitlabToken } from "../secrets.mjs";
import {
    buildAutomaticSourceBranchName,
    commitAndPushWorkingTree,
    ensureSourceBranch,
    prepareSourceBranch,
} from "./git-ops.mjs";
import { normalizeApiError, requestJson, resolveProxyUrl } from "./http-client.mjs";
import { pullRequestDetailCache } from "./pull-request-cache.mjs";
import { buildPullRequestAttachment } from "./pull-request-view.mjs";

const MR_DETAIL_CONCURRENCY = 6;

export { buildAutomaticSourceBranchName, buildPullRequestAttachment, commitAndPushWorkingTree, ensureSourceBranch };

function normalizeHost(host) {
    return String(host || "").replace(/\/+$/, "");
}

// Exported for testing: this is the ONLY place repository.gitlabProjectId gets percent-encoded.
// It must stay raw (literal "/") everywhere upstream — see repository-url.mjs's parseRepositoryUrl
// for why double-encoding subgroup paths here previously produced a 404 from GitLab.
export function ensureProjectId(repository) {
    const projectId = String(repository.gitlabProjectId || repository.id || "").trim();
    if (!projectId) {
        throw new Error(`Repository ${repository.id} does not define gitlabProjectId.`);
    }
    return encodeURIComponent(projectId);
}

async function gitlabRequest({ config, repository, method, endpoint, body, token: providedToken }) {
    if (!config.gitlab?.host) {
        throw new Error("gitlab.host is required to access GitLab.");
    }

    const token = providedToken || await resolveGitlabToken(config);
    if (!token) {
        const tokenName = config.gitlab.tokenEnvVar || "GITLAB_TOKEN";
        throw new Error(`Missing GitLab token. Set it from the Settings screen or the ${tokenName} env var.`);
    }

    const host = normalizeHost(config.gitlab.host);
    const projectId = ensureProjectId(repository);
    const url = `${host}/api/v4/projects/${projectId}${endpoint}`;

    try {
        const response = await requestJson(url, {
            method,
            headers: {
                "content-type": "application/json",
                "PRIVATE-TOKEN": token,
            },
            body: body ? JSON.stringify(body) : undefined,
            allowInsecureTls: Boolean(config.gitlab?.allowInsecureTls),
            proxyUrl: resolveProxyUrl(config),
        });

        if (!response.ok) {
            throw new Error(`GitLab request failed for ${repository.id}: ${normalizeApiError(response.payload, response.status)}`);
        }

        return response.payload;
    } catch (error) {
        if (/^GitLab request failed for/.test(error.message)) {
            throw error;
        }
        const code = error.code ? `${error.code}: ` : "";
        throw new Error(`GitLab request failed for ${repository.id} at ${host}: ${code}${error.message}`);
    }
}

// Unlike gitlabRequest, this is not scoped to a single project — used for host-level endpoints
// such as /user (the authenticated identity behind the stored token), needed to detect whether a
// merge request was authored by the current user.
async function gitlabHostRequest({ config, method, endpoint, body }) {
    if (!config.gitlab?.host) {
        throw new Error("gitlab.host is required to access GitLab.");
    }

    const token = await resolveGitlabToken(config);
    if (!token) {
        const tokenName = config.gitlab.tokenEnvVar || "GITLAB_TOKEN";
        throw new Error(`Missing GitLab token. Set it from the Settings screen or the ${tokenName} env var.`);
    }

    const host = normalizeHost(config.gitlab.host);
    const url = `${host}/api/v4${endpoint}`;

    try {
        const response = await requestJson(url, {
            method,
            headers: {
                "content-type": "application/json",
                "PRIVATE-TOKEN": token,
            },
            body: body ? JSON.stringify(body) : undefined,
            allowInsecureTls: Boolean(config.gitlab?.allowInsecureTls),
            proxyUrl: resolveProxyUrl(config),
        });

        if (!response.ok) {
            throw new Error(`GitLab request failed: ${normalizeApiError(response.payload, response.status)}`);
        }

        return response.payload;
    } catch (error) {
        if (/^GitLab request failed/.test(error.message)) {
            throw error;
        }
        const code = error.code ? `${error.code}: ` : "";
        throw new Error(`GitLab request failed at ${host}: ${code}${error.message}`);
    }
}

/** Resolves the identity behind the configured GitLab token, used to detect "own" merge requests. */
export async function getAuthenticatedGitlabUser({ config }) {
    const payload = await gitlabHostRequest({ config, method: "GET", endpoint: "/user" });
    return { username: payload.username || "", name: payload.name || "" };
}

function summarizeMergeRequest(raw, repository) {
    return {
        repositoryId: repository.id,
        repositoryName: repository.name,
        projectId: String(repository.gitlabProjectId || repository.id || ""),
        iid: Number(raw.iid),
        title: raw.title || `MR ${raw.iid}`,
        description: raw.description || "",
        webUrl: raw.web_url || "",
        state: raw.state || "opened",
        sourceBranch: raw.source_branch || "",
        targetBranch: raw.target_branch || "",
        author: raw.author?.name || raw.author?.username || "",
        authorUsername: raw.author?.username || "",
        draft: Boolean(raw.draft || String(raw.title || "").startsWith("Draft:")),
        updatedAt: raw.updated_at || raw.created_at || "",
        createdAt: raw.created_at || "",
        sha: raw.sha || raw.diff_refs?.head_sha || "",
        mergeStatus: raw.merge_status || raw.detailed_merge_status || "",
        pipelineStatus: raw.head_pipeline?.status || "",
        changesCount: Number(raw.changes_count || 0),
    };
}

// The list endpoint does not return changes_count or head_pipeline (GitLab only fills those in
// on the single-MR endpoint), so every card would otherwise show "Cambios 0" and "sin pipeline"
// regardless of the real state. Enrich each item with a single lightweight GET (no diffs, unlike
// /changes) so the summary reflects reality.
export async function listPendingMergeRequests({
    config,
    repository,
    refresh = false,
    resolveToken = resolveGitlabToken,
    request = gitlabRequest,
    detailCache = pullRequestDetailCache,
    detailConcurrency = MR_DETAIL_CONCURRENCY,
}) {
    const token = await resolveToken(config);
    if (!token) throw new Error("Missing GitLab token.");
    const payload = await request({
        config,
        repository,
        method: "GET",
        endpoint: `/merge_requests?state=opened&order_by=updated_at&sort=desc`,
        token,
    });

    if (!Array.isArray(payload)) return [];

    const enriched = await mapWithConcurrency(payload, detailConcurrency, async (item) => {
        try {
            const projectId = String(repository.gitlabProjectId || repository.id || "");
            return await detailCache.get({
                key: `gitlab:${config.configPath || config.project?.id || "default"}:${config.gitlab.host}:${projectId}:${item.iid}`,
                version: `${item.updated_at || ""}:${item.sha || item.diff_refs?.head_sha || ""}`,
                refresh,
                load: () => request({
                    config,
                    repository,
                    method: "GET",
                    endpoint: `/merge_requests/${encodeURIComponent(item.iid)}`,
                    token,
                }),
            });
        } catch (error) {
            console.error(`[gitlab] Could not fetch detail for ${repository.id} !${item.iid}: ${error.message}`);
            return { ...item, __detailError: error.message };
        }
    });

    return enriched.map((item) => {
        const summary = summarizeMergeRequest(item, repository);
        if (item.__detailError) summary.detailError = item.__detailError;
        return summary;
    });
}

// Lists the most-recently-updated closed or merged MRs for a repository (last N, default 20).
// Does NOT enrich with single-MR details (expensive) — uses list-endpoint fields only.
export async function listClosedMergeRequests({
    config,
    repository,
    perPage = 20,
    resolveToken = resolveGitlabToken,
    request = gitlabRequest,
}) {
    const token = await resolveToken(config);
    const [merged, closed] = await Promise.all(["merged", "closed"].map((state) => request({
        config,
        repository,
        method: "GET",
        endpoint: `/merge_requests?state=${state}&order_by=updated_at&sort=desc&per_page=${encodeURIComponent(perPage)}`,
        token,
    })));
    const byIid = new Map([...Array.isArray(merged) ? merged : [], ...Array.isArray(closed) ? closed : []]
        .map((item) => [item.iid, item]));
    return [...byIid.values()]
        .sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")))
        .slice(0, perPage)
        .map((item) => summarizeMergeRequest(item, repository));
}

export async function getMergeRequestDetails({ config, repository, mergeRequestIid }) {
    const payload = await gitlabRequest({
        config,
        repository,
        method: "GET",
        endpoint: `/merge_requests/${encodeURIComponent(mergeRequestIid)}/changes`,
    });

    return {
        ...summarizeMergeRequest(payload, repository),
        changes: Array.isArray(payload.changes)
            ? payload.changes.map((file) => ({
                oldPath: file.old_path || "",
                newPath: file.new_path || "",
                diff: file.diff || "",
                newFile: Boolean(file.new_file),
                renamedFile: Boolean(file.renamed_file),
                deletedFile: Boolean(file.deleted_file),
            }))
            : [],
    };
}

export async function createMergeRequestNote({ config, repository, mergeRequestIid, body }) {
    return gitlabRequest({
        config,
        repository,
        method: "POST",
        endpoint: `/merge_requests/${encodeURIComponent(mergeRequestIid)}/notes`,
        body: { body },
    });
}

// Discussions are GitLab's grouping of review comment threads (a single top-level note plus its
// replies). "resolvable" notes are the ones tied to a review thread (as opposed to plain
// timeline notes); a discussion counts as resolved only once every resolvable note in it is.
export async function listMergeRequestDiscussions({ config, repository, mergeRequestIid }) {
    const payload = await gitlabRequest({
        config,
        repository,
        method: "GET",
        endpoint: `/merge_requests/${encodeURIComponent(mergeRequestIid)}/discussions?per_page=100`,
    });

    if (!Array.isArray(payload)) return [];

    return payload.map((discussion) => {
        const notes = Array.isArray(discussion.notes) ? discussion.notes : [];
        const resolvableNotes = notes.filter((note) => note.resolvable);
        return {
            id: discussion.id,
            resolvable: resolvableNotes.length > 0,
            resolved: resolvableNotes.length > 0 && resolvableNotes.every((note) => note.resolved),
            notes: notes.map((note) => ({
                id: note.id,
                author: note.author?.name || note.author?.username || "",
                authorUsername: note.author?.username || "",
                body: note.body || "",
                system: Boolean(note.system),
                createdAt: note.created_at || "",
            })),
        };
    });
}

export async function replyToMergeRequestDiscussion({ config, repository, mergeRequestIid, discussionId, body }) {
    return gitlabRequest({
        config,
        repository,
        method: "POST",
        endpoint: `/merge_requests/${encodeURIComponent(mergeRequestIid)}/discussions/${encodeURIComponent(discussionId)}/notes`,
        body: { body },
    });
}

export async function resolveMergeRequestDiscussion({ config, repository, mergeRequestIid, discussionId }) {
    return gitlabRequest({
        config,
        repository,
        method: "PUT",
        endpoint: `/merge_requests/${encodeURIComponent(mergeRequestIid)}/discussions/${encodeURIComponent(discussionId)}?resolved=true`,
    });
}

export async function createGitLabMergeRequest({ config, repository, title, description }) {
    const targetBranch = repository.targetBranch || config.gitlab.defaultTargetBranch || "develop";
    const sourceBranch = await prepareSourceBranch({ repository, targetBranch, title, config });

    const payload = await gitlabRequest({
        config,
        repository,
        method: "POST",
        endpoint: "/merge_requests",
        body: {
            source_branch: sourceBranch,
            target_branch: targetBranch,
            title,
            description,
            remove_source_branch: false,
        },
    });

    return {
        id: payload.iid,
        webUrl: payload.web_url,
        sourceBranch,
        targetBranch,
        title,
    };
}
