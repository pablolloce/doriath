// Renders the Markdown dossier handed to Copilot for PR/MR validation. Provider-agnostic: it only
// relies on the normalized shape produced by gitlab.mjs's summarizeMergeRequest and github.mjs's
// summarizePullRequest (iid, webUrl, state, mergeStatus, pipelineStatus, changes[], ...).

function trimDiff(diff, maxCharacters = 1200) {
    const text = String(diff || "").trim();
    if (!text) return "[Sin diff textual disponible]";
    if (text.length <= maxCharacters) return text;
    return `${text.slice(0, maxCharacters)}\n\n[Diff truncado para mantener el contexto manejable.]`;
}

export function buildPullRequestAttachment(pr) {
    const files = Array.isArray(pr.changes) ? pr.changes : [];
    const changedFiles = files.length
        ? files.map((file) => `- ${file.newPath}${file.deletedFile ? " (deleted)" : file.newFile ? " (new)" : file.renamedFile ? ` (renamed from ${file.oldPath})` : ""}`).join("\n")
        : "- No se devolvió la lista de cambios.";

    const diffSections = files.length
        ? files.map((file) => [`### ${file.newPath}`, "```diff", trimDiff(file.diff), "```"].join("\n")).join("\n\n")
        : "No hay diff disponible.";

    return [
        `# Dossier PR ${pr.repositoryName} !${pr.iid}`,
        "",
        `- Repositorio: ${pr.repositoryName} (${pr.repositoryId})`,
        `- Título: ${pr.title}`,
        `- URL: ${pr.webUrl}`,
        `- Autor: ${pr.author || pr.authorUsername || "Desconocido"}`,
        `- Estado: ${pr.state}`,
        `- Merge status: ${pr.mergeStatus || "desconocido"}`,
        `- Pipeline: ${pr.pipelineStatus || "sin pipeline"}`,
        `- Source branch: ${pr.sourceBranch}`,
        `- Target branch: ${pr.targetBranch}`,
        `- SHA: ${pr.sha || "n/d"}`,
        `- Draft: ${pr.draft ? "sí" : "no"}`,
        "",
        "## Descripción",
        pr.description || "Sin descripción.",
        "",
        "## Ficheros cambiados",
        changedFiles,
        "",
        "## Diff",
        diffSections,
    ].join("\n");
}
