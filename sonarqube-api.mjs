import { resolveSonarqubeToken } from "../secrets.mjs";
import { normalizeApiError, requestJson, resolveProxyUrl } from "./http-client.mjs";

export function resolveSonarqubeHost(config, repository) {
    const defaultHost = String(config.sonarqube?.host || "").trim();
    if (repository?.platform === "github") {
        return String(config.sonarqube?.githubHost || "").trim() || defaultHost;
    }
    return defaultHost;
}

export function resolveRepositorySonarProjectKey(repository) {
    const projectKey = String(repository?.sonarProjectKey || "").trim();
    if (!projectKey) {
        throw new Error(`Repository unit ${repository?.id || "unknown"} has no sonarProjectKey configured.`);
    }
    return projectKey;
}

/**
 * Resolve a SonarQube component by its stable project key.
 * A missing component is a normal result so callers can distinguish it from connectivity errors.
 */
export async function fetchSonarqubeProject({ config, projectKey, repository }) {
    const host = resolveSonarqubeHost(config, repository);
    if (!host) {
        throw new Error("sonarqube.host is not configured.");
    }

    const normalizedProjectKey = String(projectKey || "").trim();
    if (!normalizedProjectKey) {
        throw new Error("SonarQube projectKey is required.");
    }

    const token = await resolveSonarqubeToken(config, repository);
    if (!token) {
        throw new Error("Missing SonarQube token. Configure it in Configuración or set the SONARQUBE_TOKEN env var.");
    }

    const url = `${host.replace(/\/+$/, "")}/api/components/show?component=${encodeURIComponent(normalizedProjectKey)}`;
    const response = await requestJson(url, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/json",
        },
        allowInsecureTls: true,
        proxyUrl: resolveProxyUrl(config),
    });

    if (response.status === 404) {
        return { exists: false, key: normalizedProjectKey };
    }

    if (!response.ok) {
        const message = normalizeApiError(response.payload, `HTTP ${response.status}`);
        throw new Error(`SonarQube API error: ${message}`);
    }

    const component = response.payload?.component || {};
    return {
        exists: true,
        key: component.key || normalizedProjectKey,
        name: component.name || normalizedProjectKey,
        qualifier: component.qualifier || "",
        visibility: component.visibility || "",
    };
}

/**
 * Query SonarQube Quality Gate status for a project via REST API.
 * Requires config.sonarqube.host and a stored/env token.
 */
export async function fetchQualityGateStatus({ config, projectKey, repository }) {
    const host = resolveSonarqubeHost(config, repository);
    if (!host) {
        throw new Error("sonarqube.host is not configured.");
    }

    const token = await resolveSonarqubeToken(config, repository);
    if (!token) {
        throw new Error("Missing SonarQube token. Configure it in Configuración or set the SONARQUBE_TOKEN env var.");
    }

    const url = `${host.replace(/\/+$/, "")}/api/qualitygates/project_status?projectKey=${encodeURIComponent(projectKey)}`;
    const response = await requestJson(url, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/json",
        },
        allowInsecureTls: true,
        proxyUrl: resolveProxyUrl(config),
    });

    if (!response.ok) {
        const message = normalizeApiError(response.payload, `HTTP ${response.status}`);
        throw new Error(`SonarQube API error: ${message}`);
    }

    const status = response.payload?.projectStatus?.status || "UNKNOWN";
    return {
        ok: status === "OK",
        status,
        conditions: response.payload?.projectStatus?.conditions || [],
    };
}

/**
 * Repository-aware entry point for workflows. Keeps the logical unit identity attached to the
 * SonarQube response when several units share one physical Git repository.
 */
export async function fetchRepositoryQualityGateStatus({ config, repository }) {
    const projectKey = resolveRepositorySonarProjectKey(repository);
    const result = await fetchQualityGateStatus({ config, projectKey, repository });
    return {
        repositoryId: repository.id,
        repositoryName: repository.name,
        projectKey,
        ...result,
    };
}

/**
 * Validate connectivity to SonarQube (used by the UI to test the token).
 */
export async function testSonarqubeConnection({ config }) {
    const host = config.sonarqube?.host;
    if (!host) {
        throw new Error("sonarqube.host is not configured.");
    }

    const token = await resolveSonarqubeToken(config);
    if (!token) {
        throw new Error("Missing SonarQube token.");
    }

    const url = `${host.replace(/\/+$/, "")}/api/authentication/validate`;
    const response = await requestJson(url, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/json",
        },
        allowInsecureTls: true,
        proxyUrl: resolveProxyUrl(config),
    });

    if (!response.ok) {
        const message = normalizeApiError(response.payload, `HTTP ${response.status}`);
        throw new Error(`SonarQube connection failed: ${message}`);
    }

    return { valid: response.payload?.valid === true };
}
