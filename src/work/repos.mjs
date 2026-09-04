import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { runCommand } from "../util/process.mjs";
import { pathExists, readJson, writeJson } from "../util/fs.mjs";
import { cacheDir } from "../kdd/layout.mjs";

/**
 * Repositorios locales para el módulo Knowledge-Driven Development. El usuario selecciona carpetas,
 * KDD Studio busca `.git` dentro (hasta 3 niveles) y trabaja directamente sobre esos checkouts: sin
 * clones gestionados ni worktrees. La lista de repos conocidos se guarda por base de conocimiento en
 * `.kdd-studio/repositories.json` para que la detección del cambio pueda proponerlos.
 */
const IGNORED_DIRS = new Set(["node_modules", ".git", "target", "build", "dist", ".gradle", ".idea", ".vscode", "__pycache__", "vendor", ".venv", "venv"]);

async function isGitRepo(dir) {
  return pathExists(path.join(dir, ".git"));
}

export async function scanForRepositories(rootPaths, { maxDepth = 3 } = {}) {
  const found = new Map();
  const walk = async (dir, depth) => {
    if (found.size > 200) return;
    if (await isGitRepo(dir)) {
      found.set(path.resolve(dir), await inspectRepository(dir));
      return;
    }
    if (depth >= maxDepth) return;
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      await walk(path.join(dir, entry.name), depth + 1);
    }
  };
  for (const root of Array.isArray(rootPaths) ? rootPaths : [rootPaths]) {
    if (!root || !(await pathExists(root))) continue;
    await walk(path.resolve(root), 0);
  }
  return [...found.values()];
}

const STACK_MARKERS = [
  { id: "maven", files: ["pom.xml"], label: "Java (Maven)", test: ["mvn", ["-q", "test"]], build: ["mvn", ["-q", "-DskipTests", "package"]] },
  { id: "gradle", files: ["build.gradle", "build.gradle.kts"], label: "Java/Kotlin (Gradle)", test: ["gradle", ["test"]], build: ["gradle", ["build", "-x", "test"]] },
  { id: "node", files: ["package.json"], label: "Node.js", test: ["npm", ["test"]], build: ["npm", ["run", "build"]] },
  { id: "python", files: ["pyproject.toml", "requirements.txt", "setup.py"], label: "Python", test: ["pytest", []], build: null },
  { id: "dotnet", files: ["*.sln", "*.csproj"], label: ".NET", test: ["dotnet", ["test"]], build: ["dotnet", ["build"]] },
  { id: "go", files: ["go.mod"], label: "Go", test: ["go", ["test", "./..."]], build: ["go", ["build", "./..."]] },
  { id: "nova", files: ["nova.yml"], label: "NOVA", test: null, build: null },
];

export async function detectStacks(dir) {
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const stacks = [];
  for (const marker of STACK_MARKERS) {
    const hit = marker.files.some((file) => (file.startsWith("*.") ? names.some((name) => name.endsWith(file.slice(1))) : names.includes(file)));
    if (hit) stacks.push({ id: marker.id, label: marker.label, testCommand: marker.test, buildCommand: marker.build });
  }
  return stacks;
}

export async function inspectRepository(dir) {
  const resolved = path.resolve(dir);
  const [branch, remote, status, lastCommit] = await Promise.all([
    runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: resolved, timeoutMs: 15000 }),
    runCommand("git", ["remote", "get-url", "origin"], { cwd: resolved, timeoutMs: 15000 }),
    runCommand("git", ["status", "--porcelain"], { cwd: resolved, timeoutMs: 20000 }),
    runCommand("git", ["log", "-1", "--format=%h %s (%cr)"], { cwd: resolved, timeoutMs: 15000 }),
  ]);
  const stacks = await detectStacks(resolved);
  const readme = await readReadmeSummary(resolved);
  return {
    id: randomUUID(),
    name: path.basename(resolved),
    path: resolved,
    branch: branch.ok ? branch.stdout.trim() : "",
    remote: remote.ok ? remote.stdout.trim() : "",
    dirty: status.ok ? status.stdout.split("\n").filter(Boolean).length : 0,
    lastCommit: lastCommit.ok ? lastCommit.stdout.trim() : "",
    stacks,
    summary: readme,
  };
}

async function readReadmeSummary(dir) {
  for (const name of ["README.md", "readme.md", "README.MD", "README.txt", "README"]) {
    const file = path.join(dir, name);
    if (await pathExists(file)) {
      const text = await readFile(file, "utf8").catch(() => "");
      return text.replace(/^#.*$/m, "").replace(/\s+/g, " ").trim().slice(0, 400);
    }
  }
  return "";
}

/* ---------- Registro por base de conocimiento ---------- */

function registryFile(sourceDir) {
  return path.join(cacheDir(sourceDir), "repositories.json");
}

export async function listRegisteredRepositories(sourceDir) {
  const data = await readJson(registryFile(sourceDir), { repositories: [] });
  const repositories = Array.isArray(data?.repositories) ? data.repositories : [];
  const out = [];
  for (const repo of repositories) {
    const exists = await pathExists(repo.path);
    out.push({ ...repo, exists });
  }
  return out;
}

export async function registerRepositories(sourceDir, repositories) {
  const current = await listRegisteredRepositories(sourceDir);
  const map = new Map(current.map((repo) => [repo.path.toLowerCase(), repo]));
  for (const repo of repositories) {
    const key = path.resolve(repo.path).toLowerCase();
    const existing = map.get(key);
    map.set(key, { ...(existing || {}), ...repo, id: existing?.id || repo.id || randomUUID(), path: path.resolve(repo.path), registeredAt: existing?.registeredAt || new Date().toISOString() });
  }
  const next = [...map.values()].map(({ exists, ...repo }) => repo);
  await writeJson(registryFile(sourceDir), { repositories: next });
  return next;
}

export async function unregisterRepository(sourceDir, repoId) {
  const current = await listRegisteredRepositories(sourceDir);
  const next = current.filter((repo) => repo.id !== repoId).map(({ exists, ...repo }) => repo);
  await writeJson(registryFile(sourceDir), { repositories: next });
  return next;
}

/** Refresca rama/estado de los repos registrados que existen. */
export async function refreshRepositories(sourceDir) {
  const current = await listRegisteredRepositories(sourceDir);
  const refreshed = [];
  for (const repo of current) {
    if (!repo.exists) {
      refreshed.push(repo);
      continue;
    }
    const info = await inspectRepository(repo.path);
    refreshed.push({ ...repo, ...info, id: repo.id });
  }
  return refreshed;
}

/* ---------- Operaciones git sobre un repositorio ---------- */

export async function git(repoPath, args, { timeoutMs = 60000 } = {}) {
  const fullArgs = process.platform === "win32" ? ["-c", "core.longpaths=true", ...args] : args;
  return runCommand("git", fullArgs, { cwd: repoPath, timeoutMs });
}

export async function currentBranch(repoPath) {
  const result = await git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return result.ok ? result.stdout.trim() : "";
}

export async function ensureBranch(repoPath, branchName) {
  const current = await currentBranch(repoPath);
  if (current === branchName) return { created: false, branch: branchName };
  const exists = await git(repoPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${branchName}`]);
  const result = exists.ok
    ? await git(repoPath, ["switch", branchName])
    : await git(repoPath, ["switch", "-c", branchName]);
  if (!result.ok) throw new Error(`No se pudo cambiar a la rama ${branchName}: ${result.error}`);
  return { created: !exists.ok, branch: branchName };
}

export async function workingTreeStatus(repoPath) {
  const status = await git(repoPath, ["status", "--porcelain"]);
  const files = (status.stdout || "").split("\n").filter(Boolean).map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(3).trim() }));
  return files;
}

export async function diffWorkingTree(repoPath, { staged = false, maxChars = 200000 } = {}) {
  const args = staged ? ["diff", "--cached"] : ["diff"];
  const tracked = await git(repoPath, args, { timeoutMs: 60000 });
  const untracked = await git(repoPath, ["ls-files", "--others", "--exclude-standard"]);
  let text = tracked.stdout || "";
  for (const file of (untracked.stdout || "").split("\n").filter(Boolean)) {
    const full = path.join(repoPath, file);
    const info = await stat(full).catch(() => null);
    if (!info || info.size > 200000) continue;
    const content = await readFile(full, "utf8").catch(() => "");
    text += `\ndiff --git a/${file} b/${file}\nnew file\n--- /dev/null\n+++ b/${file}\n${content.split("\n").map((line) => `+${line}`).join("\n")}\n`;
  }
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…(diff truncado)` : text;
}

export async function commitAll(repoPath, message, { author } = {}) {
  const add = await git(repoPath, ["add", "-A"]);
  if (!add.ok) throw new Error(`git add falló: ${add.error}`);
  const args = ["commit", "-m", message];
  if (author) args.push("--author", author);
  const commit = await git(repoPath, args, { timeoutMs: 120000 });
  if (!commit.ok) {
    if (/nothing to commit/i.test(`${commit.stdout}\n${commit.stderr}`)) return { committed: false, message: "No hay cambios que confirmar." };
    throw new Error(`git commit falló: ${commit.error}`);
  }
  const sha = await git(repoPath, ["rev-parse", "--short", "HEAD"]);
  return { committed: true, sha: sha.stdout.trim(), output: commit.stdout };
}

export async function pushBranch(repoPath, branchName) {
  const result = await git(repoPath, ["push", "--set-upstream", "origin", branchName], { timeoutMs: 180000 });
  if (!result.ok) throw new Error(`git push falló: ${result.error}`);
  return { pushed: true, output: result.stdout || result.stderr };
}

export async function recentLog(repoPath, count = 10) {
  const result = await git(repoPath, ["log", `-${count}`, "--format=%h|%an|%cr|%s"]);
  return (result.stdout || "").split("\n").filter(Boolean).map((line) => {
    const [sha, author, when, ...subject] = line.split("|");
    return { sha, author, when, subject: subject.join("|") };
  });
}

/** Crea una pull request con gh en el remoto GitHub del repositorio. */
export async function createPullRequest(repoPath, { title, body, base, host }) {
  const args = ["pr", "create", "--title", title, "--body", body || "", "--fill-first"];
  if (base) args.push("--base", base);
  const result = await runCommand("gh", args, { cwd: repoPath, timeoutMs: 120000, env: host ? { ...process.env, GH_HOST: host } : undefined });
  if (!result.ok) throw new Error(`gh pr create falló: ${result.error}`);
  const url = /(https?:\/\/\S+)/.exec(`${result.stdout}\n${result.stderr}`)?.[1] || "";
  return { url, output: result.stdout };
}

export function slugBranch(text, max = 40) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max) || "cambio";
}
