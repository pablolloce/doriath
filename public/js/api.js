/** Cliente HTTP mínimo para la API local de Doriath. */
export async function api(path, { method = "GET", body, headers = {} } = {}) {
  const options = { method, headers: { ...headers } };
  if (body !== undefined) {
    options.headers["content-type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const error = new Error(payload?.error || `${response.status} ${response.statusText}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export const get = (path) => api(path);
export const post = (path, body = {}) => api(path, { method: "POST", body });
export const put = (path, body = {}) => api(path, { method: "PUT", body });
export const del = (path) => api(path, { method: "DELETE" });

/**
 * Suscripción SSE a uno o varios canales. Devuelve una función para cerrar.
 * `handler(event)` recibe { id, channel, type, data, at }.
 */
export function subscribe(channels, handler) {
  const list = Array.isArray(channels) ? channels : [channels];
  const source = new EventSource(`/api/events?channels=${encodeURIComponent(list.join(","))}`);
  const listener = (event) => {
    try {
      handler(JSON.parse(event.data));
    } catch (error) {
      console.error("SSE", error);
    }
  };
  source.onmessage = listener;
  // Los eventos llevan `event: <tipo>`; escuchamos los tipos conocidos y el genérico.
  for (const type of ["delta", "reasoning", "message", "tool", "tool_done", "error", "turn_start", "turn_end", "user", "assistant", "file", "package-persisted", "log", "progress", "model", "done", "failed", "cancelled", "confirmed", "discarded", "preview-updated", "task"]) {
    source.addEventListener(type, listener);
  }
  return () => source.close();
}

export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
