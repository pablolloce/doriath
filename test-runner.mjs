import path from "node:path";
import { pathExists } from "../config.mjs";
import { runCommand } from "../process.mjs";

const NOVA_FATAL_OUTPUT_PATTERNS = [
    /Unable to process APIs from nova\.yml/i,
    /Unable to run API generator/i,
];

export function normalizeRepositoryCommandResult(command, result) {
    if (command !== "nova" || !result.ok) return result;

    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (!NOVA_FATAL_OUTPUT_PATTERNS.some((pattern) => pattern.test(output))) return result;

    return {
        ...result,
        ok: false,
        error: "NOVA reported an API generation failure despite exiting with code 0.",
    };
}

// `npm ci` requires an existing lockfile (package-lock.json / npm-shrinkwrap.json). Repositories
// that don't commit one would otherwise always fail the install step with EUSAGE, so fall back to
// `npm install` in that case and report the substitution in the returned message.
async function resolveNpmCiFallback(repository, command, args) {
    if (command !== "npm" || !args.includes("ci")) return null;

    const hasLockfile =
        (await pathExists(path.join(repository.path, "package-lock.json"))) ||
        (await pathExists(path.join(repository.path, "npm-shrinkwrap.json")));
    if (hasLockfile) return null;

    return args.map((item) => (item === "ci" ? "install" : item));
}

// NOVA_HOME itself is set for every step: several nova-cli internals (e.g. activemq.custom.js)
// do `path.join(process.env.NOVA_HOME, ...)` and throw ERR_INVALID_ARG_TYPE if it's unset, even
// when they're invoked indirectly (e.g. an npm script that shells out to generated nova code).
// The yarn-linked bin dir and bundled nodejs are only prepended to PATH when `command` is
// literally "nova" (mirrors what start-nova-cmd.bat sets up before `nova` resolves) — nova's
// bundled Node is old (v10.x) and breaks modern toolchains (Angular CLI, etc.) if it shadows the
// system Node for every other command a repository runs. `novaHomePath` is optional/machine-
// specific (see config.mjs normalizeNovaConfig); when unset, this returns the input env unchanged.
export function withNovaPath(env, novaHomePath, command) {
    if (!novaHomePath) return env;

    if (command !== "nova") {
        return { ...env, NOVA_HOME: novaHomePath };
    }

    const novaPathEntries = [
        path.join(novaHomePath, "nova-deps", "yarn-global", "bin"),
        path.join(novaHomePath, "nodejs"),
    ];
    const basePath = (env && env.PATH) || process.env.PATH || "";
    return {
        ...env,
        NOVA_HOME: novaHomePath,
        PATH: [...novaPathEntries, basePath].filter(Boolean).join(path.delimiter),
    };
}

async function readNovaNpmRegistry(novaHomePath, env) {
    const nodeExecutable = path.join(novaHomePath, "nodejs", process.platform === "win32" ? "node.exe" : "node");
    const npmCli = path.join(novaHomePath, "nodejs", "node_modules", "npm", "bin", "npm-cli.js");
    if (!(await pathExists(nodeExecutable)) || !(await pathExists(npmCli))) return "";

    const result = await runCommand(nodeExecutable, [npmCli, "config", "get", "registry"], {
        timeoutMs: 10000,
        env: { ...process.env, ...env },
    });
    const registry = String(result.stdout || "").trim();
    return result.ok && /^https?:\/\//i.test(registry) ? registry : "";
}

export async function withNovaRegistry(env, novaHomePath, command, resolveRegistry = readNovaNpmRegistry) {
    if (!novaHomePath || command !== "nova" || env?.YARN_REGISTRY) return env;

    const registry = await resolveRegistry(novaHomePath, env);
    return registry ? { ...env, YARN_REGISTRY: registry } : env;
}

export async function runRepositoryCommand({
    repository,
    command,
    args = [],
    timeoutMs = 300000,
    env,
    novaHomePath,
    onChunk,
    cancellationToken,
}) {
    if (!command) {
        return {
            ok: true,
            skipped: true,
            code: 0,
            stdout: "",
            stderr: "",
            message: `No command configured for repository ${repository.id}.`,
        };
    }

    const fallbackArgs = await resolveNpmCiFallback(repository, command, args);
    const effectiveArgs = fallbackArgs || args;

    const novaPathEnv = withNovaPath(env, novaHomePath, command);
    const effectiveEnv = await withNovaRegistry(novaPathEnv, novaHomePath, command);
    const commandResult = await runCommand(command, effectiveArgs, {
        cwd: repository.path,
        timeoutMs,
        env: effectiveEnv ? { ...process.env, ...effectiveEnv } : undefined,
        onChunk,
        cancellationToken,
    });
    const result = normalizeRepositoryCommandResult(command, commandResult);

    const fallbackNote = fallbackArgs
        ? `No package-lock.json/npm-shrinkwrap.json found; used "npm ${fallbackArgs.join(" ")}" instead of "npm ci". `
        : "";

    return {
        ...result,
        skipped: false,
        message: result.ok
            ? `${fallbackNote}Command ${command} ${effectiveArgs.join(" ")} completed successfully.`
            : `${fallbackNote}${result.error || `Command ${command} failed.`}`,
    };
}
