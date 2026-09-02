import { performance } from "node:perf_hooks";
import { loadPendingPullRequestRepositories } from "../src/routes/pull-requests.mjs";

const logicalRepositories = Math.max(1, Number(process.argv[2] || 18));
const physicalRepositories = Math.max(1, Number(process.argv[3] || 3));
const pullRequestsPerRepository = Math.max(1, Number(process.argv[4] || 50));
const repositories = Array.from({ length: logicalRepositories }, (_, index) => ({
    id: `unit-${index}`,
    name: `Unit ${index}`,
    repoKey: `physical-${index % physicalRepositories}`,
    platform: "gitlab",
}));
let listCalls = 0;
let divergenceCalls = 0;
let commentCalls = 0;
let activeGroups = 0;
let maxActiveGroups = 0;
const startedAt = performance.now();

const result = await loadPendingPullRequestRepositories({
    config: { repositories },
    loadList: async () => {
        listCalls += 1;
        activeGroups += 1;
        maxActiveGroups = Math.max(maxActiveGroups, activeGroups);
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeGroups -= 1;
        return Array.from({ length: pullRequestsPerRepository }, (_, iid) => ({ iid: iid + 1 }));
    },
    attachDivergence: async (_config, _repository, pullRequests) => {
        divergenceCalls += 1;
        return pullRequests;
    },
    attachCommentSignals: async (_config, _repository, pullRequests) => {
        commentCalls += 1;
        return pullRequests;
    },
});

process.stdout.write(`${JSON.stringify({
    kind: "fenix-pull-request-benchmark",
    parameters: { logicalRepositories, physicalRepositories, pullRequestsPerRepository },
    result: {
        renderedRepositoryGroups: result.length,
        physicalListCalls: listCalls,
        physicalDivergencePasses: divergenceCalls,
        physicalCommentPasses: commentCalls,
        maxConcurrentPhysicalRepositories: maxActiveGroups,
        durationMs: Number((performance.now() - startedAt).toFixed(3)),
    },
}, null, 2)}\n`);
