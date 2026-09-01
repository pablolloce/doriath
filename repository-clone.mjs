import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathExists } from "../config.mjs";
import { runCommand } from "../process.mjs";
import { resolveGitlabToken } from "../secrets.mjs";

// Windows keeps checked-out file paths under the 260-character MAX_PATH limit by default; deeply
// nested repos (or ones cloned into this app's own storage subdirectories, see branch-update.mjs
// and run-workspace.mjs's own worktrees) then fail clone/checkout with "Filename too long" even
// though the same repository works fine elsewhere. core.longpaths=true lets git use the \\?\
// long-path prefix internally, without any system-wide Windows/Git config change. Exported so
// branch-update.mjs and run-workspace.mjs can apply the same flag to their worktree git calls
// instead of each keeping their own copy.
export function withLongPathSupport(args) {
  return process.platform === "win32" ? ["-c", "core.longpaths=true", ...args] : args;
}

// GitLab has no signed-in CLI session like `gh` does for GitHub, so the stored/env
// Personal Access Token (already used for the REST API, see integrations/gitlab.mjs)
// doubles as the git http password. GitLab accepts any non-empty username with a PAT
// as the password; "oauth2" is the convention GitLab's own docs use.
function redactToken(text, token) {
  if (!token) return String(text || "");
  return String(text || "").split(token).join("***");
}

// Same corporate-network trust override the REST API layer already honors (see
// integrations/http-client.mjs's rejectUnauthorized), applied to the git CLI too: on-prem GitLab
// instances behind a self-signed cert would otherwise fail every clone/fetch with
// "SSL certificate ... self-signed certificate in certificate chain" even though the REST calls
// (which set rejectUnauthorized themselves) succeed.
export function gitlabSslArgs(config) {
  return config?.gitlab?.allowInsecureTls ? ["-c", "http.sslVerify=false"] : [];
}

/**
 * Per-invocation auth args for a GitLab git operation (clone/fetch/push), as a one-off
 * `-c http.extraheader=...` argument rather than a token embedded in the remote URL. git persists
 * whatever URL a `clone`/`remote add` is given verbatim in .git/config, so an embedded token would
 * sit there in plaintext for as long as the clone exists; the extraheader form is never written to
 * disk — every caller (here, integrations/run-workspace.mjs, integrations/branch-update.mjs)
 * supplies it fresh for each command instead.
 */
export async function gitlabAuthArgs(config) {
  // No configPath means resolveGitlabToken has no secrets.json to look up — treat that the same
  // as "no token available" instead of crashing (a caller further from a real, loaded config,
  // e.g. some test fixtures, may not need auth at all for the operation it's running).
  if (!config?.configPath) return [];
  const token = await resolveGitlabToken(config);
  if (!token) return [];
  const basicAuth = Buffer.from(`oauth2:${token}`).toString("base64");
  return ["-c", `http.extraheader=Authorization: Basic ${basicAuth}`];
}

// Best-effort ordering for a ref dropdown: numeric segments are compared numerically (so v2.10.0
// sorts before v2.9.0 — i.e. newest first — instead of a plain string compare putting "2.1" ahead
// of "2.10"). Not a strict semver parser, just enough to surface the newest-looking tag/branch
// first for the common case; anything without comparable numbers falls back to locale compare.
export function compareRefsForDisplay(a, b) {
  const numsA = a.match(/\d+/g);
  const numsB = b.match(/\d+/g);
  if (numsA && numsB) {
    const len = Math.max(numsA.length, numsB.length);
    for (let i = 0; i < len; i += 1) {
      const diff = Number(numsB[i] || 0) - Number(numsA[i] || 0);
      if (diff !== 0) return diff;
    }
  }
  return a.localeCompare(b);
}

const MAX_REFS_PER_REPOSITORY = 50;

/**
 * Lists tag or branch names available on a repository's remote — powers the "Referencia A/B"
 * pickers in the run wizard (see resolveWorkflowInputs' `refs` input, workflow-engine.mjs).
 * Queries the remote directly via `git ls-remote`: no local clone is required or triggered, so this
 * works even before the repository has ever been used in a workflow run.
 */
export async function listRemoteRefs({ config, repository, type }) {
  const flag = type === "branch" ? "--heads" : "--tags";
  const gitArgs = repository.platform === "github"
    ? []
    : [...gitlabSslArgs(config), ...(await gitlabAuthArgs(config))];

  const result = await runCommand("git", [...gitArgs, "ls-remote", flag, repository.url], { timeoutMs: 30000 });
  if (!result.ok) {
    return { ok: false, error: result.error || "No se pudo consultar el repositorio remoto." };
  }

  // Annotated tags appear twice (the tag object itself, and a dereferenced `^{}` entry pointing at
  // the commit) — only the tag-object line is kept; resolveGitRef's `^{commit}` peel already
  // handles annotated tags fine without needing the dereferenced entry here.
  const prefix = type === "branch" ? "refs/heads/" : "refs/tags/";
  const refs = result.stdout
    .split("\n")
    .map((line) => line.split("\t")[1] || "")
    .filter((ref) => ref.startsWith(prefix) && !ref.endsWith("^{}"))
    .map((ref) => ref.slice(prefix.length));

  const unique = [...new Set(refs)].sort(compareRefsForDisplay).slice(0, MAX_REFS_PER_REPOSITORY);
  return { ok: true, refs: unique };
}

async function cloneGitLabRepository({ config, repository, destination }) {
  const token = await resolveGitlabToken(config);
  if (!token) {
    const tokenName = config.gitlab?.tokenEnvVar || "GITLAB_TOKEN";
    throw new Error(
      `Missing GitLab token to clone ${repository.id}. Set it from the Settings screen or the ${tokenName} env var.`,
    );
  }

  const result = await runCommand(
    "git",
    withLongPathSupport([
      ...gitlabSslArgs(config),
      ...(await gitlabAuthArgs(config)),
      "clone",
      repository.url,
      destination,
    ]),
    { timeoutMs: 300000 },
  );
  if (!result.ok) {
    throw new Error(`Could not clone ${repository.id} from GitLab. ${redactToken(result.error, token)}`.trim());
  }
}

// Reuses the `gh` CLI's signed-in session (same mechanism as resolveGitHubToken in
// integrations/github.mjs) instead of handling a token ourselves: `gh repo clone` accepts a
// full repository URL and resolves the right host/credentials on its own.
async function cloneGitHubRepository({ repository, destination }) {
  // `--` passes the trailing flags straight through to the underlying `git clone` (gh's own syntax
  // for this), so the same core.longpaths flag withLongPathSupport prepends for plain git calls
  // still lands on Windows.
  const longPathFlags = process.platform === "win32" ? ["-c", "core.longpaths=true"] : [];
  const result = await runCommand(
    "gh",
    ["repo", "clone", repository.url, destination, "--", ...longPathFlags],
    { timeoutMs: 300000 },
  );
  if (!result.ok) {
    throw new Error(`Could not clone ${repository.id} from GitHub. ${result.error || ""}`.trim());
  }
}

/**
 * Clones a repository into its managed root path (see config.mjs's loadConfig, which computes
 * repository.rootPath as .workbench/projects/<projectId>/repos/<repoKey>) the first time it's
 * needed. Always clones the repo root, never repository.path directly — when a repository entry
 * declares a projectPath (the real project lives in a subfolder, or several entries share one
 * repoKey), repository.path points inside that not-yet-existing clone, which git clone can't
 * target directly. A no-op once the root directory already exists.
 */
export async function ensureRepositoryCloned({ config, repository }) {
  if (await pathExists(repository.rootPath)) {
    return { cloned: false };
  }

  await mkdir(path.dirname(repository.rootPath), { recursive: true });

  if (repository.platform === "github") {
    await cloneGitHubRepository({ repository, destination: repository.rootPath });
  } else {
    await cloneGitLabRepository({ config, repository, destination: repository.rootPath });
  }

  return { cloned: true };
}

export async function syncRepositoryToTargetBranch({ config, repository }, { run = runCommand } = {}) {
  const repositoryRoot = repository.rootPath || repository.path;
  const targetBranch = repository.targetBranch || config?.gitlab?.defaultTargetBranch || "develop";
  const status = await run("git", ["status", "--porcelain"], { cwd: repositoryRoot, timeoutMs: 30000 });
  if (!status.ok) {
    throw new Error(`Could not inspect the working tree for ${repository.id}. ${status.error || ""}`.trim());
  }
  if (status.stdout.trim()) {
    return { synced: false, dirty: true, branch: targetBranch };
  }

  const authArgs = repository.platform === "github"
    ? []
    : [...gitlabSslArgs(config), ...(await gitlabAuthArgs(config))];
  const fetch = await run("git", [...authArgs, "fetch", "origin"], { cwd: repositoryRoot, timeoutMs: 180000 });
  if (!fetch.ok) {
    throw new Error(`Could not fetch origin for ${repository.id}. ${fetch.error || ""}`.trim());
  }

  const checkout = await run(
    "git",
    ["checkout", "-B", targetBranch, `origin/${targetBranch}`],
    { cwd: repositoryRoot, timeoutMs: 30000 },
  );
  if (!checkout.ok) {
    throw new Error(`Could not checkout origin/${targetBranch} for ${repository.id}. ${checkout.error || ""}`.trim());
  }

  return { synced: true, branch: targetBranch };
}
