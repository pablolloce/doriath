import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * GitHub Rulesets support — loads and validates repository rulesets.
 * Rulesets can be defined locally in `.github/rulesets.json` or fetched from GitHub API.
 * Agents use this to enforce commit message formats, branch naming, and other policies.
 */

const DEFAULT_RULESETS = {
    commitMessagePattern: null, // e.g., /^(feat|fix|chore|docs|refactor|test)(\(.+\))?:.+/i
    maxCommitMessageLines: 1,
    requireCommitCoAuthor: false,
    maxFilesPerCommit: 200,
    minFilesPerCommit: 1,
    branchNamePattern: null, // e.g., /^(main|develop|feature\/.+|hotfix\/.+)$/i
    allowedBranchPrefixes: ["feature/", "hotfix/", "release/", "docs/", "chore/"],
    requireReviewForMerge: false,
    requireStatusChecks: false,
    statusCheckRequirements: [], // e.g., ["tests", "sonar", "lint"]
};

/**
 * Load rulesets from local .github/rulesets.json or return defaults
 */
export async function loadRulesets(projectRoot) {
    try {
        const rulesPath = join(projectRoot, ".github", "rulesets.json");
        const content = await readFile(rulesPath, "utf-8");
        const rulesets = JSON.parse(content);
        return normalizeRulesets(rulesets);
    } catch (error) {
        // File not found or invalid JSON — use defaults
        return { ...DEFAULT_RULESETS };
    }
}

/**
 * Normalize rulesets to ensure all expected fields exist
 */
function normalizeRulesets(rawRulesets) {
    const normalized = { ...DEFAULT_RULESETS, ...rawRulesets };

    // Compile regex patterns if provided as strings
    if (typeof normalized.commitMessagePattern === "string") {
        const match = normalized.commitMessagePattern.match(/^\/(.+)\/([gimuy]*)$/);
        if (match) {
            normalized.commitMessagePattern = new RegExp(match[1], match[2]);
        } else {
            normalized.commitMessagePattern = new RegExp(normalized.commitMessagePattern);
        }
    }

    if (typeof normalized.branchNamePattern === "string") {
        const match = normalized.branchNamePattern.match(/^\/(.+)\/([gimuy]*)$/);
        if (match) {
            normalized.branchNamePattern = new RegExp(match[1], match[2]);
        } else {
            normalized.branchNamePattern = new RegExp(normalized.branchNamePattern);
        }
    }

    return normalized;
}

/**
 * Validate commit message against rulesets
 */
export function validateCommitMessage(message, rulesets) {
    const errors = [];

    if (!message || typeof message !== "string") {
        errors.push("Commit message is required");
        return { valid: false, errors };
    }

    const lines = message.split("\n").filter((line) => line.trim());
    if (lines.length === 0) {
        errors.push("Commit message cannot be empty");
        return { valid: false, errors };
    }

    const firstLine = lines[0];

    // Check max lines
    if (rulesets.maxCommitMessageLines && lines.length > rulesets.maxCommitMessageLines) {
        errors.push(`Commit message must be ${rulesets.maxCommitMessageLines} line(s) only`);
    }

    // Check commit message pattern
    if (rulesets.commitMessagePattern && !rulesets.commitMessagePattern.test(firstLine)) {
        errors.push(
            `Commit message does not match required pattern: ${rulesets.commitMessagePattern.source}`
        );
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Validate branch name against rulesets
 */
export function validateBranchName(branchName, rulesets) {
    const errors = [];

    if (!branchName || typeof branchName !== "string") {
        errors.push("Branch name is required");
        return { valid: false, errors };
    }

    // Check branch name pattern
    if (rulesets.branchNamePattern && !rulesets.branchNamePattern.test(branchName)) {
        errors.push(`Branch name does not match required pattern: ${rulesets.branchNamePattern.source}`);
    }

    // Check allowed prefixes
    if (rulesets.allowedBranchPrefixes && rulesets.allowedBranchPrefixes.length > 0) {
        const hasAllowedPrefix = rulesets.allowedBranchPrefixes.some((prefix) =>
            branchName.startsWith(prefix)
        );
        if (!hasAllowedPrefix && branchName !== "main" && branchName !== "develop") {
            errors.push(
                `Branch must start with one of: ${rulesets.allowedBranchPrefixes.join(", ")}`
            );
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Validate file count against rulesets
 */
export function validateFileCount(fileCount, rulesets) {
    const errors = [];

    if (typeof fileCount !== "number" || fileCount < 0) {
        errors.push("File count must be a non-negative number");
        return { valid: false, errors };
    }

    if (rulesets.minFilesPerCommit && fileCount < rulesets.minFilesPerCommit) {
        errors.push(`Commit must include at least ${rulesets.minFilesPerCommit} file(s)`);
    }

    if (rulesets.maxFilesPerCommit && fileCount > rulesets.maxFilesPerCommit) {
        errors.push(`Commit cannot exceed ${rulesets.maxFilesPerCommit} file(s)`);
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Build an agent-friendly description of active rulesets
 */
export function buildRulesetsContext(rulesets) {
    const rules = [];

    if (rulesets.commitMessagePattern) {
        rules.push(`- **Commit message format**: Must match pattern \`${rulesets.commitMessagePattern.source}\``);
    }

    if (rulesets.maxCommitMessageLines === 1) {
        rules.push("- **Commit message**: Single line only (no body/footer)");
    }

    if (rulesets.allowedBranchPrefixes && rulesets.allowedBranchPrefixes.length > 0) {
        rules.push(
            `- **Branch naming**: Must start with one of: ${rulesets.allowedBranchPrefixes.join(", ")}`
        );
    }

    if (rulesets.maxFilesPerCommit) {
        rules.push(`- **Files per commit**: Maximum ${rulesets.maxFilesPerCommit} files`);
    }

    if (rulesets.requireStatusChecks && rulesets.statusCheckRequirements.length > 0) {
        rules.push(
            `- **Status checks**: Must pass: ${rulesets.statusCheckRequirements.join(", ")}`
        );
    }

    if (rules.length === 0) {
        return "No specific rulesets configured. Use standard commit messages and branch naming.";
    }

    return `**Repository Rulesets:**\n\n${rules.join("\n")}`;
}

export { DEFAULT_RULESETS };

