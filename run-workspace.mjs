import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { mapWithConcurrency } from "../concurrency.mjs";
import { pathExists } from "../config.mjs";
import { runCommand } from "../process.mjs";
import { ensureRepositoryCloned, gitlabAuthArgs, gitlabSslArgs, withLongPathSupport } from "./repository-clone.mjs";

const cleanupQueues = new Map();

async function git(args, cwd, timeoutMs = 60000) {
  return runCommand("git", withLongPathSupport(args), { cwd, timeoutMs });
}

function resolveTargetBranch(config, repository) {
  return repository.targetBranch || config.gitlab?.defaultTargetBranch || "develop";
}

// Keep ephemeral checkouts out of the longer runs/<runId>/worktrees hierarchy: legacy NOVA/JDK
// subprocesses still reject working directories at Windows MAX_PATH even when Git supports them.
function compactRunKey(runId) {
  return createHash("sha256").update(String(runId)).digest("hex").slice(0, 16);
}

// Kept materialized in a sparse worktree regardless of the unit's own subfolder: the repository's
// agents/skills and its permanent agent context live at the root of the physical repository and are
// shared by every unit of it (see discovery.mjs's resolveAgentsBasePaths and agent-context.mjs).
const SPARSE_ALWAYS_INCLUDED = [".github", ".ai"];

/**
 * Restricts a worktree to the unit's own subfolder instead of checking out the whole repository.
 *
 * A repository split into ten units used to materialize ten complete working trees per run — they
 * share the object database, but not the checkout. Cone mode still includes every file at the
 * repository root and at each parent of the selected folder, so root manifests (pom.xml,
 * settings.gradle, package.json) remain available to the build; only sibling modules are left out.
 *
 * That last part is exactly why this is opt-in per unit (repository.sparseCheckout): a module of a
 * Maven/Gradle reactor may need its siblings to resolve, while a standalone batch in a shared
 * repository never does. Detection sets it only for the latter (see repository-blueprint.mjs).
 *
 * Never fatal: any failure degrades to a full checkout, which is always correct, just bigger.
 */
async function applySparseCheckout(worktreePath, projectPath) {
  const sparse = await git(["sparse-checkout", "set", "--cone", projectPath, ...SPARSE_ALWAYS_INCLUDED], worktreePath, 60000);
  if (!sparse.ok) {
    await git(["sparse-checkout", "disable"], worktreePath, 30000).catch(() => undefined);
  }
  return sparse.ok;
}

function worktreePathFor(config, runId, repositoryId) {
  return path.join(config.storage.directory, "wt", compactRunKey(runId), repositoryId);
}

// Isolated worktree for a repository's *external* agents source (see repository.agentsRepositoryId
// / discovery.mjs's resolveAgentsBasePath) — namespaced per requesting code-repository id, just
// like the logical-unit worktrees above, so several selected units pointing at the same physical
// agents repository still get isolated checkouts/branches (see prepareRunWorktrees).
function agentsWorktreePathFor(config, runId, forRepositoryId) {
  return path.join(config.storage.directory, "aw", compactRunKey(runId), forRepositoryId);
}

function samePath(left, right) {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

// Recomputed rather than read off repository.rootPath, since callers may pass either the plain
// config (canonical clone paths) or the workspace config prepareRunWorktrees itself returns
// (worktree paths) — baseDirectory is invariant across both, so this is unambiguous either way.
function canonicalRepositoryPath(config, repoKey) {
  return path.join(config.baseDirectory, "repos", repoKey);
}

async function resolveCleanupCanonicalPath(config, repoKey, worktreePath, gitCommand) {
  if (repoKey) return canonicalRepositoryPath(config, repoKey);
  const commonDir = await gitCommand(["rev-parse", "--path-format=absolute", "--git-common-dir"], worktreePath, 15000)
    .catch(() => null);
  if (!commonDir?.ok || !commonDir.stdout) return null;
  const gitDirectory = path.resolve(worktreePath, commonDir.stdout.trim());
  return path.basename(gitDirectory).toLowerCase() === ".git" ? path.dirname(gitDirectory) : null;
}

async function withCleanupLock(key, task) {
  const previous = cleanupQueues.get(key) || Promise.resolve();
  const operation = previous.then(task, task);
  const queued = operation.catch(() => undefined);
  cleanupQueues.set(key, queued);
  try {
    return await operation;
  } finally {
    if (cleanupQueues.get(key) === queued) cleanupQueues.delete(key);
  }
}

/**
 * Gives a run one isolated git worktree per logical repository unit. Units sharing repoKey reuse
 * one canonical clone/fetch, but receive separate worktrees so concurrent implementation, command,
 * Sonar and MR steps cannot race on the same checkout or branch.
 *
 * Idempotent across the several executeRun invocations a single run can have
 * (clarification/approval resumption, relaunch-from-failure): an already-recorded worktree that
 * still exists on disk is reused as-is, preserving whatever branch/commits it already has.
 */
export async function prepareRunWorktrees({ config, store, runId, selectedRepositories, workflow }) {
  const run = await store.get(runId);
  const existingWorktrees = run.runtime?.worktrees || {};
  const existingAgentsWorktrees = run.runtime?.agentsWorktrees || {};

  await store.update(runId, (current) => ({
    ...current,
    runtime: {
      ...(current.runtime || {}),
      worktreeRepoKeys: {
        ...(current.runtime?.worktreeRepoKeys || {}),
        ...Object.fromEntries(selectedRepositories.map((repository) => [repository.id, repository.repoKey || repository.id])),
      },
    },
  }));

  const repositoriesByRepoKey = new Map();
  for (const repository of selectedRepositories) {
    const siblings = repositoriesByRepoKey.get(repository.repoKey) || [];
    siblings.push(repository);
    repositoriesByRepoKey.set(repository.repoKey, siblings);
  }

  const worktreeRootByRepositoryId = {};
  await Promise.all([...repositoriesByRepoKey.values()].map(async (repositories) => {
    const missingRepositories = [];
    for (const repository of repositories) {
      const existingPath = existingWorktrees[repository.id];
      if (existingPath && (await pathExists(existingPath))) {
        const compactPath = worktreePathFor(config, runId, repository.id);
        if (!samePath(existingPath, compactPath)) {
          await mkdir(path.dirname(compactPath), { recursive: true });
          const canonicalPath = canonicalRepositoryPath(config, repository.repoKey);
          const moved = await git(["worktree", "move", existingPath, compactPath], canonicalPath, 120000);
          if (!moved.ok) {
            throw new Error(`Could not move the existing worktree for ${repository.id} to its compact path. ${moved.error || ""}`.trim());
          }
          await store.update(runId, (current) => ({
            ...current,
            runtime: {
              ...(current.runtime || {}),
              worktrees: { ...(current.runtime?.worktrees || {}), [repository.id]: compactPath },
            },
          }));
          worktreeRootByRepositoryId[repository.id] = compactPath;
        } else {
          worktreeRootByRepositoryId[repository.id] = existingPath;
        }
      } else {
        missingRepositories.push(repository);
      }
    }
    if (!missingRepositories.length) return;

    // All siblings share this canonical clone. Clone/fetch once, then add their worktrees
    // sequentially because multiple simultaneous `git worktree add` operations on one clone are
    // not guaranteed to be safe.
    const representative = repositories[0];
    const rootPath = representative.rootPath;
    await ensureRepositoryCloned({ config, repository: representative });
    const gitlabArgs = representative.platform === "github"
      ? []
      : [...gitlabSslArgs(config), ...(await gitlabAuthArgs(config))];
    const fetch = await git([...gitlabArgs, "fetch", "origin"], rootPath, 180000);
    if (!fetch.ok) {
      throw new Error(`Could not fetch origin for ${representative.id}. ${fetch.error || ""}`.trim());
    }

    for (const repository of missingRepositories) {
      const worktreePath = worktreePathFor(config, runId, repository.id);
      await mkdir(path.dirname(worktreePath), { recursive: true });
      const targetBranch = resolveTargetBranch(config, repository);
      const sparseProjectPath = repository.sparseCheckout ? String(repository.projectPath || "") : "";
      const added = await git(
        [
          "worktree", "add", "--detach",
          ...(sparseProjectPath ? ["--no-checkout"] : []),
          worktreePath, `origin/${targetBranch}`,
        ],
        rootPath,
        120000,
      );
      if (!added.ok) {
        throw new Error(`Could not create an isolated worktree for ${repository.id}. ${added.error || ""}`.trim());
      }

      // With --no-checkout the working tree is still empty at this point: the sparse patterns have
      // to be in place before the files are written, which is the whole point of deferring it.
      if (sparseProjectPath) {
        await applySparseCheckout(worktreePath, sparseProjectPath);
        const checkout = await git(["checkout"], worktreePath, 180000);
        if (!checkout.ok) {
          throw new Error(`Could not check out the worktree for ${repository.id}. ${checkout.error || ""}`.trim());
        }
      }

      worktreeRootByRepositoryId[repository.id] = worktreePath;
      await store.update(runId, (current) => ({
        ...current,
        runtime: {
          ...(current.runtime || {}),
          worktrees: { ...(current.runtime?.worktrees || {}), [repository.id]: worktreePath },
        },
      }));
    }
  }));

  // Only workflows that actually write agents/skills (each-repository-agent-authoring, always
  // followed by an each-repository-gitlab MR step — see create-repo-agent.json,
  // agent-skill-training.json, ecosystem-analysis.json) need a worktree for a repository's
  // external agents source. Ordinary workflows (implementation, tests, ...) never touch it, even
  // when the selected repository happens to have agentsRepositoryId configured — they edit and
  // open MRs against the code repository itself.
  const needsAgentsWorktrees = Array.isArray(workflow?.steps)
    && workflow.steps.some((step) => step.scope === "each-repository-agent-authoring");

  const agentsSourceRepoByRepositoryId = new Map();
  if (needsAgentsWorktrees) {
    for (const repository of selectedRepositories) {
      if (!repository.agentsRepositoryId) continue;
      const agentsSourceRepo = config.repositories.find((candidate) => candidate.id === repository.agentsRepositoryId);
      if (agentsSourceRepo) agentsSourceRepoByRepositoryId.set(repository.id, agentsSourceRepo);
    }
  }

  const agentsWorktreePathByRepositoryId = {};
  if (agentsSourceRepoByRepositoryId.size) {
    // Phase A: clone + fetch each *unique* underlying agents repository once (several code
    // repositories can share the same agents repository) before any worktree is added off it —
    // ensureRepositoryCloned/fetch racing on the same canonical clone from multiple concurrent
    // callers is not safe, unlike worktree add (see phase B).
    const uniqueAgentsSourceRepos = new Map();
    for (const agentsSourceRepo of agentsSourceRepoByRepositoryId.values()) {
      if (!uniqueAgentsSourceRepos.has(agentsSourceRepo.repoKey)) {
        uniqueAgentsSourceRepos.set(agentsSourceRepo.repoKey, agentsSourceRepo);
      }
    }
    await Promise.all([...uniqueAgentsSourceRepos.values()].map(async (agentsSourceRepo) => {
      await ensureRepositoryCloned({ config, repository: agentsSourceRepo });
      const gitlabArgs = agentsSourceRepo.platform === "github"
        ? []
        : [...gitlabSslArgs(config), ...(await gitlabAuthArgs(config))];
      const fetch = await git([...gitlabArgs, "fetch", "origin"], agentsSourceRepo.rootPath, 180000);
      if (!fetch.ok) {
        throw new Error(`Could not fetch origin for agents repository ${agentsSourceRepo.id}. ${fetch.error || ""}`.trim());
      }
    }));

    // Phase B: one isolated worktree per requesting code-repository (not shared, unlike the
    // repoKey-based worktrees above), created sequentially since `git worktree add` off the same
    // canonical clone is not guaranteed safe to run concurrently.
    for (const [forRepositoryId, agentsSourceRepo] of agentsSourceRepoByRepositoryId) {
      const existing = existingAgentsWorktrees[forRepositoryId];
      if (existing?.path && (await pathExists(existing.path))) {
        agentsWorktreePathByRepositoryId[forRepositoryId] = existing;
        continue;
      }

      const worktreePath = agentsWorktreePathFor(config, runId, forRepositoryId);
      await mkdir(path.dirname(worktreePath), { recursive: true });
      const targetBranch = resolveTargetBranch(config, agentsSourceRepo);
      const added = await git(["worktree", "add", "--detach", worktreePath, `origin/${targetBranch}`], agentsSourceRepo.rootPath, 120000);
      if (!added.ok) {
        throw new Error(`Could not create an isolated worktree for agents repository ${agentsSourceRepo.id} (for ${forRepositoryId}). ${added.error || ""}`.trim());
      }

      agentsWorktreePathByRepositoryId[forRepositoryId] = { repoKey: agentsSourceRepo.repoKey, path: worktreePath };
      await store.update(runId, (current) => ({
        ...current,
        runtime: {
          ...(current.runtime || {}),
          agentsWorktrees: {
            ...(current.runtime?.agentsWorktrees || {}),
            [forRepositoryId]: agentsWorktreePathByRepositoryId[forRepositoryId],
          },
        },
      }));
    }
  }

  // Every selected logical unit gets its own worktree and then resolves its projectPath inside it.
  const updatedRepositories = selectedRepositories.map((repository) => {
    const worktreeRoot = worktreeRootByRepositoryId[repository.id];
    const agentsWorktree = agentsWorktreePathByRepositoryId[repository.id];
    const agentsSourceRepo = agentsSourceRepoByRepositoryId.get(repository.id);
    return {
      ...repository,
      isRunWorktree: true,
      rootPath: worktreeRoot,
      path: path.join(worktreeRoot, repository.projectPath || ""),
      ...(agentsWorktree && agentsSourceRepo
        ? {
          // Resolved location for this repository's agents/skills when they live in a separate
          // repository (see repository.agentsRepositoryId). `path`/`rootPath` both point at the
          // isolated worktree root — step handlers that write agents (see
          // step-handlers/agent-authoring.mjs) join it with the code repository's own id to get
          // the actual subfolder, matching discovery.mjs's resolveAgentsBasePath.
          agentsRepository: {
            id: agentsSourceRepo.id,
            name: agentsSourceRepo.name,
            url: agentsSourceRepo.url,
            platform: agentsSourceRepo.platform,
            gitlabProjectId: agentsSourceRepo.gitlabProjectId,
            remoteProjectId: agentsSourceRepo.remoteProjectId,
            targetBranch: agentsSourceRepo.targetBranch,
            rootPath: agentsWorktree.path,
            path: agentsWorktree.path,
          },
        }
        : {}),
    };
  });

  const overrideById = new Map(updatedRepositories.map((repository) => [repository.id, repository]));
  const workspaceConfig = {
    ...config,
    repositories: config.repositories.map((repository) => overrideById.get(repository.id) || repository),
  };

  return { config: workspaceConfig, selectedRepositories: updatedRepositories };
}

/** Best-effort cleanup used once a run's worktrees are no longer needed (see callers). */
export async function removeRunWorktrees({
  config,
  run,
  gitCommand = git,
  removePath = rm,
  maxConcurrentClones = 3,
}) {
  const groups = new Map();
  const pendingEntries = [];
  const addPendingPath = (repoKey, worktreePath) => {
    if (!worktreePath) return;
    pendingEntries.push({ repoKey: repoKey || null, worktreePath });
  };
  const worktrees = run?.runtime?.worktrees || {};
  const worktreeRepoKeys = run?.runtime?.worktreeRepoKeys || {};

  for (const [repositoryId, worktreePath] of Object.entries(worktrees)) {
    const repository = config.repositories.find((item) => item.id === repositoryId || item.repoKey === repositoryId);
    addPendingPath(worktreeRepoKeys[repositoryId] || repository?.repoKey || null, worktreePath);
  }

  const agentsWorktrees = run?.runtime?.agentsWorktrees || {};
  for (const entry of Object.values(agentsWorktrees)) {
    addPendingPath(entry?.repoKey, entry?.path);
  }

  for (const entry of pendingEntries) {
    const canonicalPath = await resolveCleanupCanonicalPath(config, entry.repoKey, entry.worktreePath, gitCommand);
    const groupKey = canonicalPath || `unknown:${entry.repoKey || entry.worktreePath}`;
    const group = groups.get(groupKey) || { canonicalPath, paths: new Set() };
    group.paths.add(entry.worktreePath);
    groups.set(groupKey, group);
  }

  await mapWithConcurrency([...groups.values()], maxConcurrentClones, async (group) => {
    const canonicalPath = group.canonicalPath;
    const firstPath = group.paths.values().next().value;
    const lockKey = canonicalPath || `unknown:${group.repoKey || firstPath}`;
    await withCleanupLock(lockKey, async () => {
      for (const worktreePath of group.paths) {
        if (canonicalPath) {
          await gitCommand(["worktree", "remove", "--force", worktreePath], canonicalPath, 30000).catch(() => undefined);
        }
        await removePath(worktreePath, { recursive: true, force: true }).catch(() => undefined);
      }
      if (canonicalPath) await gitCommand(["worktree", "prune"], canonicalPath, 15000).catch(() => undefined);
    });
  });

  if (run?.id) {
    const runKey = compactRunKey(run.id);
    await removePath(path.join(config.storage.directory, "wt", runKey), { recursive: true, force: true }).catch(() => undefined);
    await removePath(path.join(config.storage.directory, "aw", runKey), { recursive: true, force: true }).catch(() => undefined);
  }
}
