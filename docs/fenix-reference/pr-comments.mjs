// Provider-agnostic layer for the "Trabajar en comentarios" PR action: detects whether a merge
// request/pull request belongs to the current user, lists its unresolved review comment threads
// ("discussions"), builds the dossier handed to Copilot for classification, and posts replies /
// resolutions back once the workflow decides what to do with each thread. Routes to gitlab.mjs or
// github.mjs based on repository.platform, mirroring the existing pattern in gitlab.mjs/
// pull-request-view.mjs (summarizeMergeRequest/summarizePullRequest share one normalized shape).

import { getAuthenticatedGitHubUser, listPullRequestReviewThreads, replyToPullRequestReviewComment } from "./github.mjs";
import { getAuthenticatedGitlabUser, listMergeRequestDiscussions, replyToMergeRequestDiscussion, resolveMergeRequestDiscussion } from "./gitlab.mjs";
import { PullRequestDetailCache } from "./pull-request-cache.mjs";
import { buildPullRequestAttachment } from "./pull-request-view.mjs";

// The authenticated username rarely changes mid-session; caching it avoids one extra API round
// trip per PR every time the Pull Requests view refreshes (it lists PRs across every repository).
const usernameCache = new Map();
const USERNAME_CACHE_TTL_MS = 10 * 60 * 1000;
const discussionCache = new PullRequestDetailCache({ ttlMs: 20_000, maxEntries: 200 });

function platformOf(repository) {
    return repository.platform === "github" ? "github" : "gitlab";
}

/** Resolves the identity behind the configured token/session for this repository's platform. */
export async function resolveCurrentUsername({
    config,
    repository,
    refresh = false,
    getGitHubUser = getAuthenticatedGitHubUser,
    getGitlabUser = getAuthenticatedGitlabUser,
}) {
    const platform = platformOf(repository);
    const host = platform === "github" ? config.github?.host : config.gitlab?.host;
    const tokenIdentity = platform === "github"
        ? `${config.github?.type || ""}:${config.github?.host || ""}`
        : `${config.gitlab?.tokenEnvVar || ""}:${config.gitlab?.host || ""}`;
    const cacheKey = `${config.configPath || config.project?.id || "default"}:${platform}:${host || ""}:${tokenIdentity}`;
    const cached = usernameCache.get(cacheKey);
    if (!refresh && cached && cached.expiresAt > Date.now()) return cached.promise;

    const entry = {
        expiresAt: Date.now() + USERNAME_CACHE_TTL_MS,
        promise: (platform === "github"
            ? getGitHubUser({ config })
            : getGitlabUser({ config }))
            .then((user) => user.username),
    };
    usernameCache.set(cacheKey, entry);
    try {
        return await entry.promise;
    } catch (error) {
        if (usernameCache.get(cacheKey) === entry) usernameCache.delete(cacheKey);
        throw error;
    }
}

export function clearPullRequestIdentityCache() {
    usernameCache.clear();
    discussionCache.clear();
}

/** Whether the given normalized PR/MR summary (see summarizeMergeRequest/summarizePullRequest) was authored by the current user. */
export async function isOwnPullRequest({ config, repository, pr, refreshIdentity = false, ...identityServices }) {
    if (!pr?.authorUsername) return false;
    try {
        const username = await resolveCurrentUsername({
            config,
            repository,
            refresh: refreshIdentity,
            ...identityServices,
        });
        return Boolean(username) && username.toLowerCase() === String(pr.authorUsername).toLowerCase();
    } catch {
        return false;
    }
}

export async function listPullRequestDiscussions({
    config, repository, mergeRequestIid, useCache = false, refresh = false,
}) {
    const load = () => platformOf(repository) === "github"
        ? listPullRequestReviewThreads({ config, repository, mergeRequestIid })
        : listMergeRequestDiscussions({ config, repository, mergeRequestIid });
    if (!useCache) return load();
    const host = platformOf(repository) === "github" ? config.github?.host : config.gitlab?.host;
    const project = repository.remoteProjectId || repository.gitlabProjectId || repository.repoKey || repository.id;
    return discussionCache.get({
        key: `${config.configPath || config.project?.id || "default"}:${platformOf(repository)}:${host || ""}:${project}:${mergeRequestIid}`,
        version: "open",
        refresh,
        load,
    });
}

/**
 * Gates both the UI button and the launch endpoint: only unresolved threads with at least one
 * non-system note are candidates. Whether a candidate is actually a code suggestion/correction
 * (vs. a question, praise, or something needing justification) is a semantic judgement left to
 * the classification workflow step — this is only the cheap "are there validation comments at
 * all" pre-check described in the feature request.
 */
export function filterActionableDiscussions(discussions) {
    return (discussions || []).filter((discussion) => {
        if (discussion.resolved) return false;
        const notes = (discussion.notes || []).filter((note) => !note.system);
        return notes.length > 0;
    });
}

/** Markdown dossier: the existing PR summary plus every actionable discussion, each tagged with a stable ID the model must echo back verbatim. */
export function buildPullRequestCommentsAttachment(pr, discussions) {
    const base = buildPullRequestAttachment(pr);
    const list = discussions || [];
    const sections = list.length
        ? list.map((discussion) => {
            const notes = (discussion.notes || []).filter((note) => !note.system);
            const body = notes
                .map((note) => `**${note.author || note.authorUsername || "Autor desconocido"}** (${note.createdAt || "s/f"}):\n${note.body}`)
                .join("\n\n");
            return `### Comentario [ID: ${discussion.id}]\n\n${body}`;
        }).join("\n\n")
        : "No hay comentarios de validacion pendientes.";

    return [
        base,
        "",
        "## Comentarios de validacion pendientes",
        "",
        "Cada comentario incluye un ID literal entre corchetes (`[ID: ...]`) que debes usar exactamente igual al referenciarlo.",
        "",
        sections,
    ].join("\n");
}

export async function replyToPullRequestDiscussion({ config, repository, mergeRequestIid, discussionId, body }) {
    const result = await (platformOf(repository) === "github"
        ? replyToPullRequestReviewComment({ config, repository, mergeRequestIid, discussionId, body })
        : replyToMergeRequestDiscussion({ config, repository, mergeRequestIid, discussionId, body }));
    discussionCache.clear();
    return result;
}

/** No-op on GitHub: resolving a review thread is only exposed via GitHub's GraphQL API, not REST. */
export async function resolvePullRequestDiscussion({ config, repository, mergeRequestIid, discussionId }) {
    if (platformOf(repository) === "github") return null;
    const result = await resolveMergeRequestDiscussion({ config, repository, mergeRequestIid, discussionId });
    discussionCache.clear();
    return result;
}

const VALID_DECISIONS = new Set(["fix", "justify", "skip"]);

/**
 * Parses the classification step's response into a plan the "each-repository-pr-comments"
 * workflow step can act on. Expects a fenced ```json code block containing an array of
 * `{discussionId, decision, summary, reply}` objects — see workflows/pr-comment-resolution.json's
 * classify-comments step prompt for the exact contract. Entries referencing an unknown
 * discussionId (when `discussionMeta` is provided) are dropped rather than acted upon, since the
 * only IDs safe to reply to/resolve are the ones actually fetched for this run.
 */
export function parseCommentResolutionPlan(text, discussionMeta = []) {
    const match = /```json\s*([\s\S]*?)```/i.exec(String(text || ""));
    if (!match) {
        throw new Error("No se encontro un bloque JSON con la clasificacion de comentarios en la respuesta del paso anterior.");
    }

    let parsed;
    try {
        parsed = JSON.parse(match[1]);
    } catch (error) {
        throw new Error(`El bloque JSON de clasificacion de comentarios no es valido: ${error.message}`);
    }
    if (!Array.isArray(parsed)) {
        throw new Error("La clasificacion de comentarios debe ser un array JSON.");
    }

    const knownIds = new Set((discussionMeta || []).map((item) => String(item.id)));
    return parsed
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
            discussionId: String(item.discussionId ?? item.id ?? "").trim(),
            decision: VALID_DECISIONS.has(item.decision) ? item.decision : "skip",
            summary: String(item.summary || "").trim(),
            reply: String(item.reply || "").trim(),
        }))
        .filter((item) => item.discussionId && (knownIds.size === 0 || knownIds.has(item.discussionId)));
}
