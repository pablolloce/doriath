import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PerformanceMonitor } from "../src/performance-monitor.mjs";
import { createRunAgentResolutionCache, loadSkillsForAgentResolution } from "../src/workflow/agent-resolution.mjs";

const iterations = Math.max(1, Number(process.argv[2] || 10));
if (!Number.isSafeInteger(iterations)) throw new Error("iterations must be a positive integer.");

const directory = await mkdtemp(path.join(os.tmpdir(), "fenix-perf-skills-"));
try {
    const repositoryPath = path.join(directory, "repo");
    const skillsPath = path.join(directory, "skills");
    await mkdir(path.join(repositoryPath, ".ai"), { recursive: true });
    await mkdir(skillsPath, { recursive: true });
    await Promise.all([
        writeFile(path.join(repositoryPath, "pom.xml"), "<project />", "utf8"),
        writeFile(path.join(repositoryPath, ".ai", "project.md"), "# Synthetic project\nJava 21 and Maven", "utf8"),
    ]);
    const globalSkills = [];
    for (let index = 0; index < 12; index += 1) {
        const skillPath = path.join(skillsPath, `skill-${index}.md`);
        await writeFile(skillPath, `# Synthetic skill ${index}\n${"x".repeat(2000)}`, "utf8");
        globalSkills.push({
            id: `skill-${index}`,
            repositoryId: "__global__",
            path: skillPath,
            capabilities: ["testing"],
            stacks: ["java"],
        });
    }
    const project = {
        repositories: [{ id: "back", path: repositoryPath }],
        skills: [],
        globalSkills,
    };
    const request = {
        project,
        repositoryIds: ["back"],
        resolutions: [{ resolvedBy: "global-fallback" }],
        requiredCapabilities: ["testing"],
    };

    const uncachedMonitor = new PerformanceMonitor({ enabled: true });
    for (let index = 0; index < iterations; index += 1) {
        await loadSkillsForAgentResolution({ ...request, monitor: uncachedMonitor });
    }

    const cachedMonitor = new PerformanceMonitor({ enabled: true });
    const resolutionCache = createRunAgentResolutionCache({ monitor: cachedMonitor });
    for (let index = 0; index < iterations; index += 1) {
        await loadSkillsForAgentResolution({ ...request, monitor: cachedMonitor, resolutionCache });
    }

    process.stdout.write(`${JSON.stringify({
        kind: "fenix-skill-resolution-benchmark",
        iterations,
        skillFiles: globalSkills.length,
        uncached: uncachedMonitor.snapshot().metrics,
        cached: cachedMonitor.snapshot().metrics,
    }, null, 2)}\n`);
} finally {
    await rm(directory, { recursive: true, force: true });
}
