import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { appRoot, installRoot } from "./paths.mjs";

/**
 * Las dos ediciones del producto.
 *
 * Es el mismo código: cambian el nombre, con qué cuenta se inicia sesión y qué módulos se ven.
 *
 *  - **studio**    la aplicación entera. Sesión con Copilot, contra GitHub Enterprise.
 *  - **assistant** solo el chat y la importación de bases. Sesión con Codex, contra ChatGPT.
 *
 * La edición se decide al construir y viaja en `edition.json` junto a la app. En desarrollo se
 * fuerza con `KDD_EDITION=assistant`, que es como se prueban las dos sin reinstalar nada.
 */
export const EDITIONS = Object.freeze({
  studio: {
    id: "studio",
    name: "KDD Studio",
    tagline: "Conocimiento, asistente y desarrollo",
    provider: "copilot",
    // Los tres módulos. El orden es el del menú.
    modules: ["knowledge", "assistant", "work"],
    // El Studio administra la base: analizador, grafo, gobernanza, specs.
    canManageKnowledge: true,
    executable: "KDD-Studio",
  },
  assistant: {
    id: "assistant",
    name: "KDD Assistant",
    tagline: "Pregunta a tus bases de conocimiento",
    provider: "codex",
    // Solo el chat. Las bases se añaden e importan documentos, pero no se mantienen desde aquí.
    modules: ["assistant"],
    canManageKnowledge: false,
    executable: "KDD-Assistant",
  },
});

function detect() {
  const forced = String(process.env.KDD_EDITION || "").trim().toLowerCase();
  if (EDITIONS[forced]) return forced;
  for (const base of [installRoot, appRoot]) {
    if (!base) continue;
    const file = path.join(base, "edition.json");
    if (!existsSync(file)) continue;
    try {
      const declared = String(JSON.parse(readFileSync(file, "utf8"))?.edition || "").toLowerCase();
      if (EDITIONS[declared]) return declared;
    } catch {
      // Un edition.json corrupto no debe impedir arrancar: se cae a la edición completa.
    }
  }
  return "studio";
}

export const edition = EDITIONS[detect()];

/** ¿Está disponible este módulo en la edición actual? */
export function hasModule(id) {
  return edition.modules.includes(id);
}
