import { randomUUID } from "node:crypto";
import { runCommand } from "../process.mjs";
import { gitlabAuthArgs, gitlabSslArgs } from "./repository-clone.mjs";

// Provider-agnostic local git operations (branch/commit/push) shared by the GitLab and GitHub
// integrations, so creating a merge request or a pull request only differs in the remote API call.

// GitHub pushes ride on the `gh`-managed credential.helper already registered for the host (see
// cloneGitHubRepository in repository-clone.mjs), but on-prem GitLab has no such session: without
// these, `git push` falls back to an interactive username/password prompt that has no terminal to
// read from when spawned here, and fails with "Could not read Username ... No such file or directory".
async function pushAuthArgs(config, repository) {
    if (repository?.platform === "github") return [];
    return [...gitlabSslArgs(config), ...(await gitlabAuthArgs(config))];
}

function slugifyBranchSegment(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/^[a-z]+:\s*/i, "")
        .replace(/\[[^\]]+\]\s*$/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
}

export function extractExplicitFeatureBranch(value) {
    const match = String(value || "").match(/\b(feature\/[a-z0-9][a-z0-9._/-]*)/i);
    return match ? match[1].replace(/[./-]+$/g, "") : null;
}

export function extractJiraTicket(value) {
    const match = String(value || "").match(/\b((?!RUN-)[a-z][a-z0-9]{1,9}-\d+)\b/i);
    return match ? match[1].toUpperCase() : null;
}

export function hasBranchNamingContext(value) {
    return Boolean(extractExplicitFeatureBranch(value) || extractJiraTicket(value));
}

function ticketBranchDescription(value, ticket) {
    const text = String(value || "");
    const ticketIndex = text.toUpperCase().lastIndexOf(ticket);
    const answerTail = ticketIndex >= 0
        ? text.slice(ticketIndex + ticket.length).split(/\r?\n/, 1)[0]
        : "";
    const source = slugifyBranchSegment(answerTail) || slugifyBranchSegment(text.replace(new RegExp(ticket, "ig"), ""));
    return source.split("-").filter(Boolean).slice(0, 3).join("-") || "cambio";
}

export function buildAutomaticSourceBranchName(title, suffix = randomUUID().slice(0, 8)) {
    const explicitBranch = extractExplicitFeatureBranch(title);
    if (explicitBranch) return explicitBranch;

    const ticket = extractJiraTicket(title);
    if (ticket) return `feature/${ticket}-${ticketBranchDescription(title, ticket)}`;

    const slug = slugifyBranchSegment(title) || "change";
    return `feature/no-ticket-${slug}-${suffix}`;
}

export async function currentBranch(repository) {
    const branch = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: repository.path,
        timeoutMs: 20000,
    });
    if (!branch.ok || !branch.stdout) {
        throw new Error(`Could not read current branch for ${repository.id}. ${branch.error || ""}`.trim());
    }
    return branch.stdout.trim();
}

/**
 * Checks out an existing remote branch — e.g. a PR/MR's own source branch — inside a repository
 * that may only have started with its target branch checked out (see run-workspace.mjs's
 * prepareRunWorktrees, which detaches new run worktrees at origin/<targetBranch>). Re-fetches that
 * specific branch first (in case commits landed on it after the worktree/clone was created), then
 * resets a local branch of the same name to track it, ready to receive further commits/pushes.
 */
export async function checkoutExistingRemoteBranch({ repository, branchName, config }) {
    const fetch = await runCommand("git", [...(await pushAuthArgs(config, repository)), "fetch", "origin", branchName], {
        cwd: repository.path,
        timeoutMs: 120000,
    });
    if (!fetch.ok) {
        throw new Error(`Could not fetch branch ${branchName} for ${repository.id}. ${fetch.error || ""}`.trim());
    }

    const checkout = await runCommand("git", ["checkout", "-B", branchName, `origin/${branchName}`], {
        cwd: repository.path,
        timeoutMs: 30000,
    });
    if (!checkout.ok) {
        throw new Error(`Could not checkout branch ${branchName} for ${repository.id}. ${checkout.error || ""}`.trim());
    }
}

export async function createAndPushBranch(repository, branchName, config) {
    const createBranch = await runCommand("git", ["switch", "-c", branchName], {
        cwd: repository.path,
        timeoutMs: 20000,
    });
    if (!createBranch.ok) {
        const fallback = await runCommand("git", ["checkout", "-b", branchName], {
            cwd: repository.path,
            timeoutMs: 20000,
        });
        if (!fallback.ok) {
            throw new Error(`Could not create branch ${branchName} for ${repository.id}. ${fallback.error || createBranch.error || ""}`.trim());
        }
    }

    const push = await runCommand("git", [...(await pushAuthArgs(config, repository)), "push", "--set-upstream", "origin", branchName], {
        cwd: repository.path,
        timeoutMs: 120000,
    });
    if (!push.ok) {
        throw new Error(`Could not push branch ${branchName} for ${repository.id}. ${push.error || ""}`.trim());
    }
}

export async function pushCurrentBranch(repository, config) {
    const branchName = await currentBranch(repository);
    const push = await runCommand("git", [...(await pushAuthArgs(config, repository)), "push", "--set-upstream", "origin", branchName], {
        cwd: repository.path,
        timeoutMs: 120000,
    });
    if (!push.ok) {
        throw new Error(`Could not push branch ${branchName} for ${repository.id}. ${push.error || ""}`.trim());
    }
}

export async function commitAndPushWorkingTree(repository, commitMessage, config) {
    const status = await runCommand("git", ["status", "--porcelain"], {
        cwd: repository.path,
        timeoutMs: 20000,
    });
    if (!status.ok) {
        throw new Error(`Could not inspect working tree for ${repository.id}. ${status.error || ""}`.trim());
    }

    if (!status.stdout) {
        return false;
    }

    const add = await runCommand("git", ["add", "-A"], {
        cwd: repository.path,
        timeoutMs: 20000,
    });
    if (!add.ok) {
        throw new Error(`Could not stage changes for ${repository.id}. ${add.error || ""}`.trim());
    }

    const commit = await runCommand("git", ["commit", "-m", commitMessage], {
        cwd: repository.path,
        timeoutMs: 120000,
    });
    if (!commit.ok) {
        throw new Error(`Could not commit changes for ${repository.id}. ${commit.error || ""}`.trim());
    }

    await pushCurrentBranch(repository, config);
    return true;
}

export async function ensureSourceBranch({ repository, targetBranch, title, pushBranch = true, config }) {
    const sourceBranch = await currentBranch(repository);
    if (sourceBranch !== targetBranch) {
        if (pushBranch) {
            await pushCurrentBranch(repository, config);
        }
        return sourceBranch;
    }

    const automaticBranch = buildAutomaticSourceBranchName(title);
    if (pushBranch) {
        await createAndPushBranch(repository, automaticBranch, config);
    } else {
        const createBranch = await runCommand("git", ["switch", "-c", automaticBranch], {
            cwd: repository.path,
            timeoutMs: 20000,
        });
        if (!createBranch.ok) {
            const fallback = await runCommand("git", ["checkout", "-b", automaticBranch], {
                cwd: repository.path,
                timeoutMs: 20000,
            });
            if (!fallback.ok) {
                throw new Error(`Could not create branch ${automaticBranch} for ${repository.id}. ${fallback.error || createBranch.error || ""}`.trim());
            }
        }
    }
    return automaticBranch;
}

/**
 * Commits/pushes whatever is needed for a PR/MR (dirty working tree or an already-pushed branch)
 * and returns the resolved source branch name. Shared by createGitLabMergeRequest and
 * createGitHubPullRequest so both only differ in the remote API call that follows.
 */
export async function prepareSourceBranch({ repository, targetBranch, title, config }) {
    const dirtyStatus = await runCommand("git", ["status", "--porcelain"], {
        cwd: repository.path,
        timeoutMs: 20000,
    });
    if (!dirtyStatus.ok) {
        throw new Error(`Could not inspect working tree for ${repository.id}. ${dirtyStatus.error || ""}`.trim());
    }

    const hasChanges = Boolean(dirtyStatus.stdout);
    const sourceBranch = await ensureSourceBranch({
        repository,
        targetBranch,
        title,
        pushBranch: !hasChanges,
        config,
    });

    if (hasChanges) {
        await commitAndPushWorkingTree(repository, title, config);
    } else {
        await pushCurrentBranch(repository, config);
    }

    return sourceBranch;
}
