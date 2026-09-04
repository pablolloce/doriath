/**
 * Definición de herramientas independiente del proveedor.
 *
 * Una herramienta es un objeto plano: nombre, descripción, esquema de parámetros y función. Cada
 * proveedor la traduce a lo suyo —Copilot las recibe en la sesión, Codex las publica por MCP—, pero
 * el catálogo de `tools.mjs` se escribe una sola vez y no sabe con qué modelo va a hablar.
 *
 * El envoltorio hace dos cosas siempre: devolver texto (los modelos leen texto, no objetos) y
 * convertir una excepción en un `ERROR: …` legible, porque una herramienta que revienta no debe
 * tumbar el turno: el modelo puede leer el fallo y probar otra cosa.
 */
export function defineKddTool(name, { description, parameters, handler }) {
  return {
    name,
    description,
    parameters: parameters || { type: "object", properties: {} },
    handler: async (args, invocation) => {
      try {
        const result = await handler(args || {}, invocation);
        if (typeof result === "string") return result;
        return JSON.stringify(result ?? null, null, 2);
      } catch (error) {
        return `ERROR: ${error.message}`;
      }
    },
  };
}
