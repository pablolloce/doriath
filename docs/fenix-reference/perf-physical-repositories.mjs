import path from "node:path";
import { performance } from "node:perf_hooks";
import { loadConfig } from "../src/config.mjs";
import { inspectRepositoriesByPhysicalClone, inspectRepository } from "../src/discovery.mjs";

const configPath = String(process.argv[2] || "").trim();
const iterations = Math.max(1, Number(process.argv[3] || 3));
if (!configPath) throw new Error("Usage: node scripts/perf-physical-repositories.mjs <configPath> [iterations]");
if (!Number.isSafeInteger(iterations)) throw new Error("iterations must be a positive integer.");

const config = await loadConfig(path.resolve(configPath));
const physicalRepositories = new Set(
    (config.repositories || []).map((repository) => repository.repoKey || repository.rootPath || repository.url || repository.id),
).size;

async function measure(load) {
    const samples = [];
    for (let index = 0; index < iterations; index += 1) {
        const startedAt = performance.now();
        await load();
        samples.push(performance.now() - startedAt);
    }
    const sorted = [...samples].sort((left, right) => left - right);
    return {
        samplesMs: samples.map((value) => Number(value.toFixed(3))),
        medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)),
        averageMs: Number((samples.reduce((total, value) => total + value, 0) / samples.length).toFixed(3)),
    };
}

const logical = await measure(() => Promise.all(
    config.repositories.map((repository) => inspectRepository(config, repository)),
));
const physical = await measure(() => inspectRepositoriesByPhysicalClone(config));

process.stdout.write(`${JSON.stringify({
    kind: "fenix-physical-repository-benchmark",
    parameters: {
        logicalRepositories: config.repositories.length,
        physicalRepositories,
        iterations,
    },
    logical,
    physical,
    medianReductionPercent: Number(((1 - physical.medianMs / logical.medianMs) * 100).toFixed(1)),
}, null, 2)}\n`);
