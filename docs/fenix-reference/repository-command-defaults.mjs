import { readFile } from "node:fs/promises";
import path from "node:path";
import { detectStacks } from "../ecosystem-analyzer.mjs";
import { resolveCommandStack, STACK_COMMAND_DEFAULTS } from "../stack-catalog.mjs";

const NOVA_GENERATE_DEFAULT = { command: "nova", args: ["generate-api-code"] };
const NO_COMMAND = { command: undefined, args: [] };

const LEGACY_GENERIC_DEFAULTS = {
  installCommand: STACK_COMMAND_DEFAULTS.node.installCommand,
  unitTestCommand: STACK_COMMAND_DEFAULTS.node.unitTestCommand,
  sonarCommand: STACK_COMMAND_DEFAULTS.node.sonarCommand,
};

const DETECTED_COMMAND_FIELDS = new Set([
  "installCommand",
  "preInstallCommand",
  "postInstallCommand",
  "unitTestCommand",
  "sonarCommand",
]);

async function hasNpmScript(repositoryPath, scriptName) {
  try {
    const raw = await readFile(path.join(repositoryPath, "package.json"), "utf8");
    const parsed = JSON.parse(raw);
    return Boolean(parsed.scripts && parsed.scripts[scriptName]);
  } catch {
    return false;
  }
}

function sameCommand(candidate, expected) {
  return candidate.command === expected.command
    && JSON.stringify(candidate.args || []) === JSON.stringify(expected.args || []);
}

export function isLegacyGenericRepositoryCommandDefault(commandField, command, args = []) {
  const legacyDefault = LEGACY_GENERIC_DEFAULTS[commandField];
  if (!legacyDefault) return false;
  return sameCommand({ command, args }, legacyDefault);
}

async function detectDefaultCommand(repository, commandField) {
  const stacks = await detectStacks(repository.path).catch(() => []);
  const stackIds = new Set(stacks.map((stack) => stack.id));

  if (commandField === "preInstallCommand") {
    return stackIds.has("nova-platform") ? NOVA_GENERATE_DEFAULT : NO_COMMAND;
  }

  if (commandField === "postInstallCommand") {
    if (stackIds.has("node") && (await hasNpmScript(repository.path, "prepare-apis"))) {
      return { command: "npm", args: ["run", "prepare-apis"] };
    }
    return NO_COMMAND;
  }

  const commandStack = resolveCommandStack(stackIds);
  return STACK_COMMAND_DEFAULTS[commandStack]?.[commandField] || NO_COMMAND;
}

/**
 * Resolves the command/args to run for repository-scoped workflow steps.
 * Explicit repository config wins, except for the historical placeholder defaults
 * (`npm ci`, `npm test`, `npm run sonar`) that older FENIX versions persisted for every
 * repository regardless of stack; those are treated as implicit and replaced when the actual
 * repository files indicate a better Java/Gradle default.
 */
export async function resolveRepositoryCommand({ repository, commandField, argsField }) {
  const explicitCommand = String(repository?.[commandField] || "").trim();
  const explicitArgs = Array.isArray(repository?.[argsField]) ? repository[argsField] : [];

  if (!DETECTED_COMMAND_FIELDS.has(commandField)) {
    return { command: explicitCommand || undefined, args: explicitArgs };
  }

  const hasExplicitCommand = Boolean(explicitCommand);
  const isLegacyPlaceholder = hasExplicitCommand
    && isLegacyGenericRepositoryCommandDefault(commandField, explicitCommand, explicitArgs);

  if (hasExplicitCommand && !isLegacyPlaceholder) {
    return { command: explicitCommand, args: explicitArgs };
  }

  const detectedDefault = await detectDefaultCommand(repository, commandField);
  if (detectedDefault.command) {
    return detectedDefault;
  }

  if (hasExplicitCommand) {
    return { command: explicitCommand, args: explicitArgs };
  }

  return NO_COMMAND;
}

/**
 * Resolves the command/args to run for a repository's install-pipeline step
 * (installCommand, preInstallCommand, postInstallCommand). An explicit value already
 * configured on the repository always wins; detection only fills the gap when unset, so a
 * Maven backend never inherits a Node frontend's npm-flavored defaults (or a NOVA codegen
 * step it doesn't need) and vice versa. Detection is based on the repository's actual files
 * (reusing ecosystem-analyzer's detectStacks) rather than the repository's declared `kind`,
 * so it stays correct even for repositories that don't set `kind`.
 */
export async function resolveInstallStepCommand({ repository, commandField, argsField }) {
  return resolveRepositoryCommand({ repository, commandField, argsField });
}
