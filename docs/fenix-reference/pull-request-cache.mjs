import { performanceMonitor } from "../performance-monitor.mjs";

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_ENTRIES = 500;

export class PullRequestDetailCache {
    constructor({ ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES, now = Date.now, monitor = performanceMonitor } = {}) {
        this.ttlMs = ttlMs;
        this.maxEntries = maxEntries;
        this.now = now;
        this.monitor = monitor;
        this.entries = new Map();
    }

    async get({ key, version = "", refresh = false, load }) {
        const current = this.entries.get(key);
        if (!refresh && current && current.version === version && current.expiresAt > this.now()) {
            this.monitor.record("pr.detail-cache-hit", 0);
            this.entries.delete(key);
            this.entries.set(key, current);
            return current.promise;
        }

        const entry = {
            version,
            expiresAt: this.now() + this.ttlMs,
            promise: Promise.resolve().then(load),
        };
        this.entries.delete(key);
        this.entries.set(key, entry);
        while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
        try {
            return await entry.promise;
        } catch (error) {
            if (this.entries.get(key) === entry) this.entries.delete(key);
            throw error;
        }
    }

    clear() {
        this.entries.clear();
    }
}

export const pullRequestDetailCache = new PullRequestDetailCache();

export function clearPullRequestDetailCache() {
    pullRequestDetailCache.clear();
}
