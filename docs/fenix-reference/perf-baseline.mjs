import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PerformanceMonitor } from "../src/performance-monitor.mjs";
import { RunStore, writeJsonAtomic } from "../src/run-store.mjs";

function option(name, fallback = "") {
    const prefix = `--${name}=`;
    const inline = process.argv.find((item) => item.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

function positiveInteger(name, fallback, positionalIndex) {
    const value = Number(option(name, process.argv[positionalIndex] || fallback));
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`--${name} must be a positive integer.`);
    return value;
}

function syntheticRun(index) {
    const createdAt = new Date(Date.UTC(2026, 0, 1) + index * 60000).toISOString();
    return {
        id: `PERF-${String(index).padStart(6, "0")}`,
        workflowId: index % 2 ? "code-implementation" : "functional-analysis",
        workflowName: "Synthetic workflow",
        status: index % 10 === 0 ? "failed" : "completed",
        requirement: "Synthetic requirement used only to measure local serialization and listing costs.",
        repositoryIds: ["repo-a", "repo-b", "repo-c"],
        createdAt,
        updatedAt: createdAt,
        completedAt: createdAt,
        model: "synthetic-model",
        usage: { inputTokens: 12000, outputTokens: 2400, nanoAiu: 1000000000, models: ["synthetic-model"] },
        steps: Array.from({ length: 8 }, (_, stepIndex) => ({
            key: `step-${stepIndex}:repo-a`,
            stepId: `step-${stepIndex}`,
            repositoryId: "repo-a",
            name: `Synthetic step ${stepIndex}`,
            status: "completed",
            startedAt: createdAt,
            completedAt: createdAt,
            agents: [{ id: "synthetic-agent", repositoryId: "repo-a" }],
            skills: [{ id: "synthetic-skill", repositoryId: "repo-a" }],
        })),
        artifacts: Array.from({ length: 4 }, (_, artifactIndex) => ({
            stepKey: `step-${artifactIndex}`,
            repositoryId: "repo-a",
            name: `artifact-${artifactIndex}.md`,
            path: `synthetic/artifact-${artifactIndex}.md`,
        })),
        runtime: { nextStepIndex: 8, outputByStep: {} },
        metadata: {},
    };
}

async function createSyntheticStorage(runCount) {
    const storageDirectory = await mkdtemp(path.join(os.tmpdir(), "fenix-perf-"));
    const batchSize = 25;
    for (let start = 0; start < runCount; start += batchSize) {
        const end = Math.min(runCount, start + batchSize);
        await Promise.all(Array.from({ length: end - start }, (_, offset) => {
            const run = syntheticRun(start + offset);
            return writeJsonAtomic(path.join(storageDirectory, "runs", run.id, "run.json"), run);
        }));
    }
    return storageDirectory;
}

const runCount = positiveInteger("runs", 200, 2);
const iterations = positiveInteger("iterations", 5, 3);
const configuredStorage = String(option("storage", "")).trim();
const outputPath = String(option("output", "")).trim();
const view = String(option("view", process.argv[4] || "summary")).trim().toLowerCase();
const pageSize = positiveInteger("page-size", 50);
if (!["summary", "full"].includes(view)) throw new Error("--view must be summary or full.");
const synthetic = !configuredStorage;
const storageDirectory = synthetic
    ? await createSyntheticStorage(runCount)
    : path.resolve(configuredStorage);
if (!synthetic) {
    const runsDirectory = path.join(storageDirectory, "runs");
    const runsStat = await stat(runsDirectory).catch(() => null);
    if (!runsStat?.isDirectory()) throw new Error(`Runs directory does not exist: ${runsDirectory}`);
}

try {
    const readRuns = async (store) => view === "summary"
        ? store.listSummaries({ limit: pageSize })
        : { runs: await store.list(runCount), total: runCount, nextCursor: null };
    const before = process.memoryUsage();
    const coldMonitor = new PerformanceMonitor({ enabled: true, maxSamples: Math.max(1024, runCount) });
    const coldStore = new RunStore(storageDirectory, { monitor: coldMonitor });
    const coldResult = await readRuns(coldStore);
    const returnedRuns = coldResult.runs.length;
    const responseBytes = Buffer.byteLength(JSON.stringify(coldResult));

    const warmMonitor = new PerformanceMonitor({ enabled: true, maxSamples: Math.max(1024, iterations) });
    const warmStore = new RunStore(storageDirectory, { monitor: warmMonitor });
    for (let iteration = 0; iteration < iterations; iteration += 1) {
        await readRuns(warmStore);
    }
    const after = process.memoryUsage();
    const coldSnapshot = coldMonitor.snapshot();
    const warmSnapshot = warmMonitor.snapshot();
    const report = {
        kind: "fenix-performance-baseline",
        mode: synthetic ? "synthetic" : "real-local-readonly",
        generatedAt: warmSnapshot.generatedAt,
        parameters: { requestedRuns: runCount, warmIterations: iterations, view, pageSize },
        result: {
            returnedRuns,
            totalRuns: coldResult.total,
            responseBytes,
            heapDeltaBytes: after.heapUsed - before.heapUsed,
            rssDeltaBytes: after.rss - before.rss,
        },
        metrics: {
            cold: coldSnapshot.metrics,
            warm: warmSnapshot.metrics,
        },
    };
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (outputPath) {
        const target = path.resolve(outputPath);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, json, "utf8");
    }
    process.stdout.write(json);
} finally {
    if (synthetic) await rm(storageDirectory, { recursive: true, force: true });
}
