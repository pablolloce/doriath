import path from "node:path";

/**
 * Perfiles de permisos para el runtime Copilot (segunda barrera además de `availableTools`).
 *
 *  - readonly:       solo lecturas y herramientas propias (chats de conocimiento, análisis).
 *  - implementation: lecturas, escrituras y shell dentro del directorio de trabajo (ejecución KDD).
 *  - none:           rechaza todo.
 */
const READ_KINDS = new Set(["read", "custom-tool", "mcp", "url"]);

function insideWorkspace(target, roots) {
  if (!target) return true;
  const resolved = path.resolve(String(target));
  return roots.some((root) => {
    const relative = path.relative(path.resolve(root), resolved);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}

function deny(reason) {
  return { kind: "denied-by-rules", rules: [{ id: "doriath", description: reason }] };
}

export function createPermissionHandler(profile, { workspaceRoots = [], allowNetwork = false } = {}) {
  return (request) => {
    const kind = String(request?.kind || "");
    if (profile === "none") return deny("Perfil sin herramientas.");
    if (kind === "url" && !allowNetwork) return deny("Acceso a red deshabilitado en Doriath.");
    if (READ_KINDS.has(kind)) return { kind: "approved" };
    if (profile !== "implementation") return deny(`Operación ${kind} no permitida en un chat de solo lectura.`);

    if (kind === "write") {
      const target = request.fileName || request.path || "";
      if (workspaceRoots.length && !insideWorkspace(target, workspaceRoots)) {
        return deny("Escritura fuera de los repositorios seleccionados.");
      }
      return { kind: "approved" };
    }
    if (kind === "shell" || kind === "commands") {
      const commands = Array.isArray(request.commands) ? request.commands.map(String) : [String(request.command || "")];
      const dangerous = commands.some((command) => /\b(rm\s+-rf\s+[\/~]|format\s+[a-z]:|del\s+\/s\s+\/q\s+[a-z]:\\\s*$|shutdown|reg\s+delete|git\s+push\s+--force)/i.test(command));
      if (dangerous) return deny("Comando potencialmente destructivo bloqueado por Doriath.");
      return { kind: "approved" };
    }
    if (kind === "memory" || kind === "hook") return { kind: "approved" };
    return deny(`Operación ${kind} no contemplada.`);
  };
}

export const TOOL_PROFILES = Object.freeze({
  none: [],
  readonly: ["grep", "glob", "view"],
  implementation: ["grep", "glob", "view", "edit", "create", "apply_patch", "str_replace_editor", "bash", "powershell"],
});
