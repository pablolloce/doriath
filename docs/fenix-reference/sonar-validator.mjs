import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "../config.mjs";
import { fetchSonarqubeProject } from "./sonarqube-api.mjs";

/**
 * Solo lectura: informa de si un repositorio tiene análisis de SonarQube y de si su project key
 * existe en el servidor. No escribe nada en el repositorio.
 *
 * Hubo aquí una función que generaba sonar-project.properties (y un script "sonar" en package.json)
 * en una rama nueva y abría el MR/PR. Se retiró: la configuración de Sonar la fija el equipo que
 * gobierna la calidad en cada repositorio, y una herramienta local abriendo PRs para imponer un
 * fichero generado no es la forma de hacerlo.
 */

async function readIfExists(repoPath, fileName) {
    try {
        return await readFile(path.join(repoPath, fileName), "utf8");
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
}

function buildStatus(repository, { supported, mechanism = null, detail }) {
    return {
        repositoryId: repository.id,
        repositoryName: repository.name,
        supported: Boolean(supported),
        mechanism,
        detail,
    };
}

/**
 * Detect whether a repository already has some form of SonarQube/SonarScanner
 * configuration, by inspecting well-known local files. Read-only, never modifies
 * the repository.
 */
async function checkLocalRepositorySonarSupport(repository) {
    const repoPath = repository.path;

    if (!repoPath || !(await pathExists(repoPath))) {
        return buildStatus(repository, {
            supported: false,
            detail: "El repositorio no está clonado localmente (workspace no encontrado).",
        });
    }

    if (await pathExists(path.join(repoPath, "sonar-project.properties"))) {
        return buildStatus(repository, {
            supported: true,
            mechanism: "sonar-project.properties",
            detail: "El repositorio ya tiene sonar-project.properties.",
        });
    }

    const packageJsonRaw = await readIfExists(repoPath, "package.json");
    if (packageJsonRaw) {
        try {
            const packageJson = JSON.parse(packageJsonRaw);
            if (packageJson.scripts && packageJson.scripts.sonar) {
                return buildStatus(repository, {
                    supported: true,
                    mechanism: "npm-script",
                    detail: `package.json define el script "sonar": ${packageJson.scripts.sonar}`,
                });
            }
        } catch {
            // Malformed package.json: ignore and keep checking other mechanisms.
        }
    }

    const pomXml = await readIfExists(repoPath, "pom.xml");
    if (pomXml && /sonar-maven-plugin|sonar\.host\.url|sonarsource/i.test(pomXml)) {
        return buildStatus(repository, {
            supported: true,
            mechanism: "maven-plugin",
            detail: "pom.xml incluye el plugin sonar-maven-plugin.",
        });
    }

    for (const gradleFile of ["build.gradle", "build.gradle.kts"]) {
        const gradleContent = await readIfExists(repoPath, gradleFile);
        if (gradleContent && /org\.sonarqube/i.test(gradleContent)) {
            return buildStatus(repository, {
                supported: true,
                mechanism: "gradle-plugin",
                detail: `${gradleFile} incluye el plugin org.sonarqube.`,
            });
        }
    }

    return buildStatus(repository, {
        supported: false,
        detail: "No se detectó configuración de SonarQube en el repositorio.",
    });
}

/**
 * Combine local scanner detection with the optional SonarQube project link. A repository can be
 * validly linked even when an external platform owns the analysis and no scanner files exist.
 */
export async function checkRepositorySonarSupport(repository, {
    config,
    fetchProject = fetchSonarqubeProject,
} = {}) {
    const localStatus = await checkLocalRepositorySonarSupport(repository);
    const projectKey = String(repository.sonarProjectKey || "").trim();
    const baseStatus = {
        ...localStatus,
        sonarProjectKey: projectKey || null,
        scannerConfigured: localStatus.supported,
        scannerMechanism: localStatus.mechanism,
        projectLinked: null,
        remoteStatus: projectKey ? "unavailable" : "not-configured",
    };

    if (!projectKey) return baseStatus;

    try {
        const project = await fetchProject({ config, projectKey, repository });
        if (!project.exists) {
            return {
                ...baseStatus,
                projectLinked: false,
                remoteStatus: "not-found",
                detail: `No existe un proyecto SonarQube con la clave "${projectKey}".${localStatus.supported ? ` ${localStatus.detail}` : ""}`,
            };
        }

        return {
            ...baseStatus,
            supported: true,
            mechanism: localStatus.supported ? localStatus.mechanism : "sonarqube-project",
            projectLinked: true,
            remoteStatus: "verified",
            sonarProject: project,
            detail: localStatus.supported
                ? `Proyecto SonarQube "${project.name}" vinculado. ${localStatus.detail}`
                : `Proyecto SonarQube "${project.name}" vinculado; no se detectó configuración local del scanner.`,
        };
    } catch (error) {
        return {
            ...baseStatus,
            detail: `La clave SonarQube "${projectKey}" está configurada, pero no se pudo validar: ${error.message}${localStatus.supported ? ` ${localStatus.detail}` : ""}`,
        };
    }
}
