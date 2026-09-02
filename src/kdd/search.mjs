/**
 * Búsqueda léxica BM25 sobre specs y documentos. Sin dependencias nativas: suficiente para que el
 * asistente localice specs por vocabulario; el modelo lee después el cuerpo con `read_spec`.
 */
const STOPWORDS = new Set(("a al algo ante antes como con contra cual cuando de del desde donde dos el ella ellas ellos en entre era erais eran eras eres es esa esas ese eso esos esta estaba estado estamos estan estar estas este esto estos fue fueron ha hace hacia han hasta hay la las le les lo los mas me mi mis mucho muy nada ni no nos nosotros o os otra otras otro otros para pero poco por porque que quien se sea sean segun ser si sin sobre son su sus tambien tanto te tener tiene tienen toda todas todo todos tu tus un una uno unos y ya "
  + "the a an and or of to in on for with by is are was were be been being this that these those it its as at from into over under not no yes if then than so such can could should would may might will shall do does did have has had").split(/\s+/));

export function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

export class Bm25Index {
  constructor({ k1 = 1.4, b = 0.75 } = {}) {
    this.k1 = k1;
    this.b = b;
    this.docs = new Map();
    this.df = new Map();
    this.totalLength = 0;
  }

  add(id, fields, payload) {
    const termFrequencies = new Map();
    let length = 0;
    for (const [field, weight] of Object.entries(fields)) {
      if (!weight?.text) continue;
      for (const token of tokenize(weight.text)) {
        termFrequencies.set(token, (termFrequencies.get(token) || 0) + (weight.boost || 1));
        length += 1;
      }
    }
    if (this.docs.has(id)) this.remove(id);
    this.docs.set(id, { termFrequencies, length, payload });
    this.totalLength += length;
    for (const token of termFrequencies.keys()) this.df.set(token, (this.df.get(token) || 0) + 1);
  }

  remove(id) {
    const doc = this.docs.get(id);
    if (!doc) return;
    this.docs.delete(id);
    this.totalLength -= doc.length;
    for (const token of doc.termFrequencies.keys()) {
      const count = (this.df.get(token) || 1) - 1;
      if (count <= 0) this.df.delete(token);
      else this.df.set(token, count);
    }
  }

  search(query, { limit = 10, filter } = {}) {
    const tokens = tokenize(query);
    if (!tokens.length || !this.docs.size) return [];
    const avgLength = this.totalLength / this.docs.size || 1;
    const results = [];
    for (const [id, doc] of this.docs) {
      if (filter && !filter(doc.payload)) continue;
      let score = 0;
      for (const token of tokens) {
        const tf = doc.termFrequencies.get(token);
        if (!tf) continue;
        const df = this.df.get(token) || 0;
        const idf = Math.log(1 + (this.docs.size - df + 0.5) / (df + 0.5));
        score += idf * (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * (doc.length / avgLength)));
      }
      if (score > 0) results.push({ id, score, payload: doc.payload });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

export function buildSpecIndex(specs) {
  const index = new Bm25Index();
  for (const spec of specs) {
    index.add(spec.id, {
      id: { text: spec.id.replace(/-/g, " "), boost: 3 },
      title: { text: spec.title, boost: 3 },
      tags: { text: (spec.tags || []).join(" "), boost: 2 },
      domain: { text: `${spec.domain || ""} ${spec.subdomain || ""}`, boost: 1.5 },
      body: { text: spec.body, boost: 1 },
    }, { id: spec.id, layer: spec.layer, axis: spec.axis, title: spec.title, status: spec.status, confidence: spec.confidence });
  }
  return index;
}

export function snippetFor(text, query, width = 220) {
  const tokens = tokenize(query);
  const lower = String(text || "").toLowerCase();
  let position = -1;
  for (const token of tokens) {
    position = lower.indexOf(token);
    if (position >= 0) break;
  }
  if (position < 0) return String(text || "").replace(/\s+/g, " ").slice(0, width);
  const start = Math.max(0, position - Math.floor(width / 3));
  return `${start > 0 ? "…" : ""}${String(text).slice(start, start + width).replace(/\s+/g, " ")}…`;
}
