// 08-ejemplo-gen-pptx.js — Generador de referencia (ver 08-pptx.md)
// Presentación "Sistema de telemetría y almacenamiento a largo plazo" · BBVA × NFQ · 15 slides.
// Requisitos: pptxgenjs, assets/ (logos PNG) e icons/ (iconos PNG en Electric) en el directorio de trabajo.
// Ejecutar: node 08-ejemplo-gen-pptx.js  → presentacion-telemetria-bbva-nfq.pptx
const pptxgen = require("pptxgenjs");

const p = new pptxgen();
p.layout = "LAYOUT_WIDE";
p.title = "Sistema de telemetría y almacenamiento a largo plazo";
p.subject = "Resumen arquitectónico";
p.company = "BBVA · NFQ";
p.author = "NFQ";

// ---------- Paleta BBVA ----------
const C = {
  electric: "001391",
  midnight: "070E46",
  sand: "F7F8F8",
  serene: "85C8FF",
  canary: "FFE761",
  lime: "88E783",
  ice: "8BE1E9",
  purple: "9694FF",
  mandarin: "FFB56B",
  white: "FFFFFF",
  gray2: "E2E6EA",
  gray3: "CAD1D8",
  gray5: "46536D",
  mutDark: "ADB3D9", // sand 70% sobre azules
  leadDark: "D9DDEC", // sand 88% sobre electric
};
const FD = "Source Serif 4";
const FB = "Lato";
const AR_BBVA = 160 / 524;
const AR_NFQ = 120 / 254;
const PW = 13.333, M = 0.55, CW = PW - 2 * M; // 12.233
const TOTAL = 15; // nº de slides (paginador)

const sh = () => ({ type: "outer", color: C.electric, opacity: 0.12, blur: 8, offset: 2, angle: 90 });
const icon = (n) => `icons/${n}.png`;

// ---------- Texto enriquecido ----------
const t = (s, o) => ({ text: s, options: o || {} });
const b = (s) => t(s, { bold: true });
const it = (s) => t(s, { italic: true });
const cd = (s) => t(s, { bold: true }); // .code → negrita (sin fondo en pptx)
const mut = (s) => t(s, { color: C.gray5 });

// Párrafos con viñetas a partir de items = [[run,run,...],...]
// Viñeta literal (la opción bullet de pptxgenjs no funciona con runs de formato mixto);
// breakLine solo al cerrar cada ítem; paraSpaceAfter / lineSpacingMultiple van en addText.
function bulletRuns(items) {
  const out = [];
  items.forEach((runs, i) => {
    out.push({ text: "\u2022  ", options: {} });
    runs.forEach((r, j) => {
      const o = Object.assign({}, r.options);
      if (j === runs.length - 1 && i < items.length - 1) o.breakLine = true;
      out.push({ text: r.text, options: o });
    });
  });
  return out;
}
// Runs simples en un solo párrafo
function runsPara(runs, base) {
  return runs.map((r) => ({ text: r.text, options: Object.assign({}, base, r.options) }));
}

// ---------- Logos ----------
function bbvaLogo(s, { white = false, x, y, w }) {
  s.addImage({ path: `assets/bbva_${white ? "white" : "blue"}.png`, x, y, w, h: w * AR_BBVA });
}
function nfqLogo(s, { white = false, x, y, h }) {
  s.addImage({ path: `assets/nfq_${white ? "white" : "black"}.png`, x, y, h, w: h / AR_NFQ });
}

// ---------- Cabecera / pie ----------
function headerContent(s, { dark = false, crumb1, crumb2 }) {
  s.addText(
    [
      t(crumb1.toUpperCase(), { color: dark ? C.mutDark : C.gray5 }),
      t("   " + crumb2.toUpperCase(), { color: dark ? C.sand : C.electric }),
    ],
    { x: M, y: 0.3, w: 9.4, h: 0.32, fontFace: FB, fontSize: 9, bold: true, charSpacing: 1.2, valign: "middle", margin: 0 }
  );
  bbvaLogo(s, { white: dark, x: PW - M - 1.05, y: 0.33, w: 1.05 });
}
function headerSep(s, { dark = false }) {
  bbvaLogo(s, { white: dark, x: M, y: 0.34, w: 1.35 });
}
function footerStd(s, { dark = false, left, page }) {
  const col = dark ? C.mutDark : C.gray5;
  s.addText(left, { x: M, y: 7.06, w: 7.6, h: 0.26, fontFace: FB, fontSize: 8, color: col, valign: "middle", margin: 0 });
  nfqLogo(s, { white: dark, x: 11.4, y: 7.105, h: 0.17 });
  s.addText(`p. ${String(page).padStart(2, "0")} / ${TOTAL}`, {
    x: 11.86, y: 7.06, w: 0.92, h: 0.26, fontFace: FB, fontSize: 8, color: col, align: "right", valign: "middle", margin: 0,
  });
}

// ---------- Chip (píldora) ----------
function chipW(text, fs, hasIcon) {
  return 0.24 + text.length * (fs * 0.585 / 72 + 0.0138) + (hasIcon ? 0.32 : 0);
}
function chip(s, { x, y, text, fill, ic, fs = 8, h = 0.3 }) {
  const w = chipW(text, fs, !!ic);
  s.addShape(p.ShapeType.roundRect, { x, y, w, h, fill: { color: fill }, rectRadius: h / 2, line: { type: "none" } });
  if (ic) s.addImage({ path: icon(ic), x: x + 0.13, y: y + (h - 0.19) / 2, w: 0.19, h: 0.19 });
  s.addText(text.toUpperCase(), {
    x: x + (ic ? 0.38 : 0.13), y, w: w - (ic ? 0.44 : 0.2), h,
    fontFace: FB, fontSize: fs, bold: true, color: C.electric, charSpacing: 1, valign: "middle", margin: 0, wrap: false,
  });
  return w;
}

// =====================================================================
// S1 · PORTADA (electric)
// =====================================================================
{
  const s = p.addSlide();
  s.background = { color: C.electric };
  bbvaLogo(s, { white: true, x: PW - M - 1.7, y: 0.42, w: 1.7 });

  s.addText("RESUMEN ARQUITECTÓNICO · AGOSTO 2026", {
    x: M, y: 1.95, w: 9.5, h: 0.3, fontFace: FB, fontSize: 10.5, bold: true, color: C.mutDark, charSpacing: 1.8, margin: 0,
  });
  s.addText("Sistema de telemetría\ny almacenamiento\na largo plazo", {
    x: M, y: 2.3, w: 11.0, h: 2.35, fontFace: FD, fontSize: 46, bold: true, color: C.sand, lineSpacingMultiple: 1.0, margin: 0, valign: "top",
  });
  s.addText(
    "Ciclo de vida Hot–Warm–Cold para logs de procesos y ficheros de negocio: rendimiento máximo en Oracle 19c hoy, auditoría y retención histórica en Epsilon durante años.",
    { x: M, y: 4.82, w: 7.7, h: 0.95, fontFace: FB, fontSize: 11.5, color: C.leadDark, lineSpacingMultiple: 1.25, margin: 0, valign: "top" }
  );
  let cx = M;
  cx += chip(s, { x: cx, y: 6.0, text: "Oracle 19c · fase caliente", fill: C.mandarin, ic: "database", fs: 8.5, h: 0.34 }) + 0.22;
  cx += chip(s, { x: cx, y: 6.0, text: "Epsilon · archivo en frío", fill: C.ice, ic: "frozen", fs: 8.5, h: 0.34 }) + 0.22;
  chip(s, { x: cx, y: 6.0, text: "Retención 1–5 años", fill: C.serene, ic: "clock", fs: 8.5, h: 0.34 });

  s.addText("Arquitectura de aplicación · Documento de trabajo", {
    x: M, y: 6.96, w: 6.5, h: 0.32, fontFace: FB, fontSize: 8.5, color: C.leadDark, valign: "middle", margin: 0,
  });
  s.addText("HECHO POR", { x: 10.9, y: 6.96, w: 1.0, h: 0.32, fontFace: FB, fontSize: 8, bold: true, color: C.mutDark, charSpacing: 1.5, align: "right", valign: "middle", margin: 0 });
  nfqLogo(s, { white: true, x: 12.02, y: 6.955, h: 0.33 });
  s.addNotes("Portada. Sistema de telemetría y almacenamiento a largo plazo: Hot–Warm–Cold entre Oracle 19c (caliente) y Epsilon (frío), con retención de 1 a 5 años.");
}

// =====================================================================
// S2 · ÍNDICE (midnight)
// =====================================================================
{
  const s = p.addSlide();
  s.background = { color: C.midnight };
  headerContent(s, { dark: true, crumb1: "Telemetría & almacenamiento", crumb2: "Índice" });

  s.addText("Cuatro bloques, un mismo ciclo de vida", {
    x: M, y: 1.3, w: 12.2, h: 0.62, fontFace: FD, fontSize: 30, bold: true, color: C.sand, margin: 0,
  });

  const boxes = [
    { fill: C.serene, k: "Bloque 01", h3: "Estructura y funcionamiento", d: "El modelo Hot–Warm–Cold aplicado a logs de procesos y a ficheros de negocio." },
    { fill: C.lime, k: "Bloque 02", h3: "Modelo de datos relacional", d: "Tres capas en Oracle 19c: catálogo, orquestación y eventos, unidas por el trace_id." },
    { fill: C.canary, k: "Bloque 03", h3: "Peticiones a infraestructura", d: "Lo que necesitamos de los equipos de Base de Datos y de Epsilon / DataBus." },
    { fill: C.mandarin, k: "Bloque 04", h3: "Desarrollo propio", d: "Las cuatro piezas que construye el equipo de ingeniería de la aplicación." },
  ];
  const bw = (CW - 3 * 0.28) / 4, by = 2.3, bh = 3.85;
  boxes.forEach((bx, i) => {
    const x = M + i * (bw + 0.28);
    s.addShape(p.ShapeType.roundRect, { x, y: by, w: bw, h: bh, fill: { color: bx.fill }, rectRadius: 0.14, line: { type: "none" } });
    s.addText(bx.k.toUpperCase(), { x: x + 0.24, y: by + 0.26, w: bw - 0.48, h: 0.26, fontFace: FB, fontSize: 8.5, bold: true, color: C.electric, charSpacing: 1.2, margin: 0 });
    s.addText(bx.h3, { x: x + 0.24, y: by + 0.6, w: bw - 0.48, h: 0.95, fontFace: FD, fontSize: 15.5, bold: true, color: C.electric, lineSpacingMultiple: 1.02, margin: 0, valign: "top" });
    s.addText(bx.d, { x: x + 0.24, y: by + 1.62, w: bw - 0.48, h: bh - 1.9, fontFace: FB, fontSize: 10.5, color: C.electric, lineSpacingMultiple: 1.25, margin: 0, valign: "top" });
  });
  footerStd(s, { dark: true, left: "Sistema de telemetría y almacenamiento a largo plazo", page: 2 });
  s.addNotes("Índice: 1) estructura y funcionamiento del ciclo de vida; 2) modelo de datos relacional; 3) peticiones a infraestructura; 4) desarrollo propio.");
}

// =====================================================================
// S3 · MODELO HOT-WARM-COLD (sand)
// =====================================================================
{
  const s = p.addSlide();
  s.background = { color: C.sand };
  headerContent(s, { crumb1: "Telemetría & almacenamiento", crumb2: "El modelo" });

  s.addText("TIERING DE ALMACENAMIENTO", { x: M, y: 1.06, w: 8, h: 0.26, fontFace: FB, fontSize: 9.5, bold: true, color: C.gray5, charSpacing: 1.5, margin: 0 });
  s.addText([t("Un ciclo de vida "), it("Hot–Warm–Cold")], {
    x: M, y: 1.34, w: 12.2, h: 0.55, fontFace: FD, fontSize: 29, bold: true, color: C.electric, margin: 0,
  });

  const tiers = [
    { fill: C.mandarin, lbl: "Caliente · operación", ic: "database", h3: "Datos vivos", d: [t("Los datos recientes viven en almacenamiento de alto rendimiento: tablas particionadas en "), cd("Oracle 19c"), t(" para los logs y "), cd("NFS"), t(" rápido para los ficheros de negocio. Aquí se lee y escribe al ritmo de la aplicación.")] },
    { fill: C.canary, lbl: "Archivado · transición", ic: "automate", h3: "Jobs automáticos", d: [t("Procesos programados exportan ("), cd("Data Pump"), t("), comprimen y suben lo antiguo a Epsilon. La purga inmediata en origen libera espacio sin intervención manual.")] },
    { fill: C.ice, lbl: "Frío · retención", ic: "frozen", h3: "Archivo histórico", d: [t("Los ficheros descansan en "), cd("Epsilon"), t(" durante años a bajo coste. Ante una auditoría, se restaura solo lo necesario, bajo demanda.")] },
  ];
  const tw = (CW - 2 * 0.28) / 3, ty = 2.12, th = 2.78;
  tiers.forEach((tr, i) => {
    const x = M + i * (tw + 0.28);
    s.addShape(p.ShapeType.roundRect, { x, y: ty, w: tw, h: th, fill: { color: tr.fill }, rectRadius: 0.15, line: { type: "none" } });
    s.addText(tr.lbl.toUpperCase(), { x: x + 0.26, y: ty + 0.22, w: tw - 0.52, h: 0.24, fontFace: FB, fontSize: 8.5, bold: true, color: C.electric, charSpacing: 1.3, margin: 0 });
    s.addImage({ path: icon(tr.ic), x: x + 0.26, y: ty + 0.54, w: 0.5, h: 0.5 });
    s.addText(tr.h3, { x: x + 0.26, y: ty + 1.14, w: tw - 0.52, h: 0.34, fontFace: FD, fontSize: 15, bold: true, color: C.electric, margin: 0 });
    s.addText(runsPara(tr.d, {}), { x: x + 0.26, y: ty + 1.52, w: tw - 0.52, h: th - 1.72, fontFace: FB, fontSize: 9.8, color: C.electric, lineSpacingMultiple: 1.2, margin: 0, valign: "top" });
  });

  const oy = 5.18, ow = (CW - 0.28) / 2;
  ["Máximo rendimiento de la aplicación y de la base de datos", "Cumplimiento de auditoría y retención histórica"].forEach((txt, i) => {
    const x = M + i * (ow + 0.28);
    s.addShape(p.ShapeType.roundRect, { x, y: oy, w: ow, h: 0.56, fill: { color: C.white }, rectRadius: 0.12, line: { type: "none" }, shadow: sh() });
    s.addImage({ path: icon("checkmark"), x: x + 0.24, y: oy + 0.13, w: 0.3, h: 0.3 });
    s.addText(txt, { x: x + 0.68, y: oy, w: ow - 0.9, h: 0.56, fontFace: FD, fontSize: 12.5, bold: true, color: C.electric, valign: "middle", margin: 0 });
  });

  s.addText(
    [t("Dos flujos gobernados por la misma mecánica  →  "), b("A"), t(" · Logs de procesos    ·    "), b("B"), t(" · Histórico de ficheros de negocio.")],
    { x: M, y: 6.02, w: 12.2, h: 0.3, fontFace: FB, fontSize: 9.5, color: C.gray5, margin: 0 }
  );
  footerStd(s, { left: "El modelo · Hot–Warm–Cold", page: 3 });
  s.addNotes("El modelo: caliente (operación), archivado (transición mediante jobs) y frío (retención). Objetivos: rendimiento y cumplimiento de auditoría. Dos flujos: A logs, B ficheros.");
}

// =====================================================================
// Separadores (S4, S7, S9, S12)
// =====================================================================
function separator({ bg, dark, ante, hero, desc, foot, page, notes }) {
  const s = p.addSlide();
  s.background = { color: bg };
  headerSep(s, { dark });
  const fg = dark ? C.sand : C.electric;
  s.addText(ante.toUpperCase(), { x: M, y: 2.55, w: 10, h: 0.3, fontFace: FB, fontSize: 10.5, bold: true, color: fg, charSpacing: 1.8, margin: 0 });
  s.addText(hero, { x: M, y: 2.92, w: 11.5, h: 1.75, fontFace: FD, fontSize: 44, bold: true, color: fg, lineSpacingMultiple: 0.98, margin: 0, valign: "top" });
  s.addText(desc, { x: M, y: 4.85, w: 8.4, h: 0.85, fontFace: FB, fontSize: 12.5, color: fg, lineSpacingMultiple: 1.25, margin: 0, valign: "top" });
  footerStd(s, { dark, left: foot, page });
  s.addNotes(notes);
  return s;
}

separator({
  bg: C.serene, dark: false, page: 4,
  ante: "Bloque 01 · Ciclo de vida", hero: "Estructura y\nfuncionamiento",
  desc: "Del primer log a la fase fría: cómo se ingesta, se vive, se archiva y se purga cada dato del sistema.",
  foot: "01 · Estructura y funcionamiento",
  notes: "Separador del bloque 01: estructura y funcionamiento del ciclo de vida.",
});

// =====================================================================
// S5 · LOGS DE PROCESOS (sand) — raíl de 4 fases
// =====================================================================
function phaseCard(s, { x, y, w, h, chipTxt, chipFill, ic, h3, items }) {
  s.addShape(p.ShapeType.roundRect, { x, y, w, h, fill: { color: C.white }, rectRadius: 0.14, line: { type: "none" }, shadow: sh() });
  chip(s, { x: x + 0.22, y: y + 0.2, text: chipTxt, fill: chipFill, fs: 7, h: 0.26 });
  s.addImage({ path: icon(ic), x: x + 0.22, y: y + 0.6, w: 0.42, h: 0.42 });
  s.addText(h3, { x: x + 0.22, y: y + 1.12, w: w - 0.44, h: 0.32, fontFace: FD, fontSize: 13.5, bold: true, color: C.electric, margin: 0 });
  s.addText(bulletRuns(items), { x: x + 0.2, y: y + 1.52, w: w - 0.4, h: h - 1.72, fontFace: FB, fontSize: 9.5, color: C.electric, paraSpaceAfter: 5, lineSpacingMultiple: 1.16, margin: 0, valign: "top" });
}
{
  const s = p.addSlide();
  s.background = { color: C.sand };
  headerContent(s, { crumb1: "01 · Estructura y funcionamiento", crumb2: "A · Logs de procesos" });
  s.addText("A · Gestión de logs de procesos", { x: M, y: 1.08, w: 12.2, h: 0.55, fontFace: FD, fontSize: 26, bold: true, color: C.electric, margin: 0 });

  const cw = (CW - 3 * 0.42) / 4, cy = 2.3, ch = 3.6;
  const cards = [
    { chipTxt: "Ingesta · asíncrona", chipFill: C.serene, ic: "deposit", h3: "Entrada por lotes", items: [
      [t("La aplicación genera "), b("logs estructurados"), t(".")],
      [t("Se insertan en Oracle 19c por lotes ("), it("batching"), t(").")],
      [t("Sin penalizar el rendimiento del negocio.")],
    ]},
    { chipTxt: "Fase caliente · 0–90 días", chipFill: C.mandarin, ic: "database", h3: "Vivos en Oracle", items: [
      [t("Tablas "), b("particionadas por día"), t(" en Oracle.")],
      [t("Soporte realiza búsquedas ultrarrápidas por el "), cd("ID de Ejecución"), t(".")],
    ]},
    { chipTxt: "Archivado y purga · día 91", chipFill: C.canary, ic: "automate", h3: "Job automático", items: [
      [t("Vuelca la partición más antigua (diaria/mensual) a un "), cd(".dmp"), t(" (Data Pump).")],
      [t("Sube el fichero a "), b("Epsilon"), t(".")],
      [cd("DROP PARTITION"), t(" en Oracle: espacio liberado al instante.")],
    ]},
    { chipTxt: "Fase fría · años 1–5", chipFill: C.ice, ic: "frozen", h3: "Descanso en Epsilon", items: [
      [t("Los ficheros descansan en Epsilon.")],
      [t("En auditoría: se restaura un fichero concreto en una "), b("BD temporal"), t(".")],
    ]},
  ];
  cards.forEach((c, i) => {
    const x = M + i * (cw + 0.42);
    phaseCard(s, { x, y: cy, w: cw, h: ch, ...c });
    if (i < 3) s.addImage({ path: icon("advance"), x: x + cw + 0.07, y: cy + ch / 2 - 0.14, w: 0.28, h: 0.28 });
  });
  footerStd(s, { left: "01 · Estructura y funcionamiento — A · Logs de procesos", page: 5 });
  s.addNotes("Flujo A: ingesta asíncrona por lotes; fase caliente 0–90 días particionada por día con búsqueda por ID de Ejecución; día 91 job que exporta a .dmp, sube a Epsilon y hace DROP PARTITION; fase fría 1–5 años con restauración en BD temporal.");
}

// =====================================================================
// S6 · FICHEROS DE NEGOCIO (sand) — raíl de 3 fases
// =====================================================================
{
  const s = p.addSlide();
  s.background = { color: C.sand };
  headerContent(s, { crumb1: "01 · Estructura y funcionamiento", crumb2: "B · Ficheros de negocio" });
  s.addText("B · Histórico de ficheros de negocio", { x: M, y: 1.08, w: 12.2, h: 0.55, fontFace: FD, fontSize: 26, bold: true, color: C.electric, margin: 0 });

  const cw = (CW - 2 * 0.42) / 3, cy = 2.3, ch = 3.6;
  const cards = [
    { chipTxt: "Fase caliente · ej. 0–30 días", chipFill: C.mandarin, ic: "folder", h3: "Vivos en NFS", items: [
      [t("Ficheros pesados: "), b("semanales"), t(" y "), b("deltas diarios"), t(".")],
      [t("Residen en el almacenamiento rápido ("), cd("NFS"), t(").")],
      [t("La aplicación lee, escribe y procesa desde aquí.")],
    ]},
    { chipTxt: "Archivado y purga · mensual / semanal", chipFill: C.canary, ic: "zip", h3: "Comprimir, subir, purgar", items: [
      [t("Un job automático "), b("comprime"), t(" los ficheros antiguos.")],
      [t("Los sube a Epsilon manteniendo una estructura de "), b("prefijos lógica"), t(": carpetas por "), cd("año/mes/día"), t(".")],
      [t("Los "), b("elimina del NFS"), t(" para liberar espacio.")],
    ]},
    { chipTxt: "Fase fría · años posteriores", chipFill: C.ice, ic: "cloud", h3: "Archivo unificado", items: [
      [t("Los ficheros de negocio descansan en Epsilon.")],
      [t("Conviven con los "), b("dumps de base de datos"), t(" en el mismo archivo histórico.")],
    ]},
  ];
  cards.forEach((c, i) => {
    const x = M + i * (cw + 0.42);
    phaseCard(s, { x, y: cy, w: cw, h: ch, ...c });
    if (i < 2) s.addImage({ path: icon("advance"), x: x + cw + 0.07, y: cy + ch / 2 - 0.14, w: 0.28, h: 0.28 });
  });
  footerStd(s, { left: "01 · Estructura y funcionamiento — B · Ficheros de negocio", page: 6 });
  s.addNotes("Flujo B: ficheros semanales y deltas diarios viven en NFS (ej. 0–30 días); job mensual/semanal que comprime, sube a Epsilon con prefijos año/mes/día y elimina del NFS; fase fría junto a los dumps de BD.");
}

separator({
  bg: C.electric, dark: true, page: 7,
  ante: "Bloque 02 · Logs y trazabilidad", hero: "Modelo de datos\nrelacional",
  desc: "Tres capas lógicas en Oracle 19c, pensadas para escribir muy rápido y leerlo todo desde un único hilo: el trace_id.",
  foot: "02 · Modelo de datos relacional",
  notes: "Separador del bloque 02: modelo de datos relacional en Oracle 19c.",
});

// =====================================================================
// S8 · MODELO DE DATOS (sand) — tabla de 3 capas (construida a mano)
// =====================================================================
{
  const s = p.addSlide();
  s.background = { color: C.sand };
  headerContent(s, { crumb1: "02 · Modelo de datos relacional", crumb2: "Tres capas lógicas" });

  s.addText("Tres capas, un hilo conductor", { x: M, y: 1.06, w: 12.2, h: 0.52, fontFace: FD, fontSize: 26, bold: true, color: C.electric, margin: 0 });
  s.addText(
    runsPara([t("El modelo en "), cd("Oracle 19c"), t(" evita la sobre-normalización para priorizar la "), b("velocidad de escritura"), t(" y la "), b("lectura unificada"), t(".")], { color: C.gray5 }),
    { x: M, y: 1.62, w: 12.2, h: 0.32, fontFace: FB, fontSize: 10.5, margin: 0 }
  );

  const TX = M, TW = CW;
  const colX = [TX, TX + 1.5, TX + 3.95, TX + 8.45];
  const colW = [1.5, 2.45, 4.5, TX + TW - (TX + 8.45)];
  const hy = 2.14, hh = 0.4;
  const rowH = [0.78, 0.96, 1.06];
  const tableH = hh + rowH.reduce((a, b2) => a + b2, 0);

  s.addShape(p.ShapeType.rect, { x: TX, y: hy, w: TW, h: tableH, fill: { color: C.white }, line: { type: "none" }, shadow: sh() });
  s.addShape(p.ShapeType.rect, { x: TX, y: hy, w: TW, h: hh, fill: { color: C.gray2 }, line: { type: "none" } });
  const heads = ["Capa", "Tabla principal", "Descripción y uso", "Columnas clave"];
  heads.forEach((hd, i) => {
    s.addText(hd.toUpperCase(), { x: colX[i] + 0.24, y: hy, w: colW[i] - 0.3, h: hh, fontFace: FB, fontSize: 8.5, bold: true, color: C.electric, charSpacing: 0.8, valign: "middle", margin: 0 });
  });

  const rows = [
    {
      chipTxt: "Catálogo", chipFill: C.serene,
      tabla: [cd("Catalogo_Procesos"), t("\n"), cd("Catalogo_Estados")],
      desc: [t("Tablas dimensionales "), b("estáticas"), t(": definen qué servicios existen y qué estados son posibles.")],
      cols: [cd("id_proceso"), t(", "), cd("id_estado"), t(", descripciones.")],
    },
    {
      chipTxt: "Orquestación", chipFill: C.lime,
      tabla: [cd("Instancia_Ejecucion")],
      desc: [b("La cabecera."), t(" Una fila por ejecución, de inicio a fin. Es el punto de entrada para soporte.")],
      cols: [cd("trace_id"), mut(" (PK)"), t(", "), cd("fecha_inicio"), t(", "), cd("estado_final"), t(", "), cd("identificador_negocio"), mut(" (ej. ID Portfolio)"), t(".")],
    },
    {
      chipTxt: "Eventos", chipFill: C.purple,
      tabla: [cd("Eventos_Ejecucion")],
      desc: [b("El detalle."), t(" Tabla cronológica "), b("particionada por día"), t(". Recibe logs, cambios de estado y volcados de variables vinculados a una cabecera.")],
      cols: [cd("trace_id"), mut(" (FK)"), t(", "), cd("timestamp"), t(", "), cd("tipo_evento"), t(", "), cd("nivel"), t(", "), cd("payload_contexto"), mut(" (CLOB con JSON/XML)"), t(".")],
    },
  ];
  let ry = hy + hh;
  rows.forEach((r, i) => {
    const rh = rowH[i];
    chip(s, { x: colX[0] + 0.24, y: ry + 0.16, text: r.chipTxt, fill: r.chipFill, fs: 7.5, h: 0.27 });
    s.addText(runsPara(r.tabla, {}), { x: colX[1] + 0.24, y: ry + 0.12, w: colW[1] - 0.3, h: rh - 0.2, fontFace: FB, fontSize: 9.5, color: C.electric, lineSpacingMultiple: 1.2, margin: 0, valign: "top" });
    s.addText(runsPara(r.desc, {}), { x: colX[2] + 0.24, y: ry + 0.12, w: colW[2] - 0.34, h: rh - 0.2, fontFace: FB, fontSize: 9.5, color: C.electric, lineSpacingMultiple: 1.18, margin: 0, valign: "top" });
    s.addText(runsPara(r.cols, {}), { x: colX[3] + 0.24, y: ry + 0.12, w: colW[3] - 0.44, h: rh - 0.2, fontFace: FB, fontSize: 9.5, color: C.electric, lineSpacingMultiple: 1.18, margin: 0, valign: "top" });
    ry += rh;
    if (i < rows.length - 1) s.addShape(p.ShapeType.line, { x: TX, y: ry, w: TW, h: 0, line: { color: C.gray3, width: 0.75 } });
  });

  const ny = hy + tableH + 0.3;
  s.addShape(p.ShapeType.roundRect, { x: TX, y: ny, w: TW, h: 0.74, fill: { color: C.canary }, rectRadius: 0.12, line: { type: "none" } });
  s.addImage({ path: icon("attached"), x: TX + 0.26, y: ny + 0.19, w: 0.36, h: 0.36 });
  s.addText(
    runsPara([b("Nota crítica · "), t("Los campos pesados (XML / variables) se almacenan «ciegos» en "), cd("payload_contexto"), t(" (CLOB) para evitar que la base de datos se ralentice indexando texto libre.")], {}),
    { x: TX + 0.82, y: ny, w: TW - 1.1, h: 0.74, fontFace: FB, fontSize: 10, color: C.electric, valign: "middle", lineSpacingMultiple: 1.15, margin: 0 }
  );
  footerStd(s, { left: "02 · Modelo de datos relacional — Catálogo · Orquestación · Eventos", page: 8 });
  s.addNotes("Tres capas: catálogo (Catalogo_Procesos, Catalogo_Estados), orquestación (Instancia_Ejecucion con trace_id como PK) y eventos (Eventos_Ejecucion particionada por día). Nota crítica: payloads ciegos en CLOB para no indexar texto libre.");
}

separator({
  bg: C.serene, dark: false, page: 9,
  ante: "Bloque 03 · Dependencias", hero: "Peticiones a\ninfraestructura",
  desc: "Dimensionamiento y capacidades concretas que solicitamos al equipo Oracle y al equipo Epsilon / DataBus.",
  foot: "03 · Peticiones a infraestructura",
  notes: "Separador del bloque 03: peticiones a los equipos de infraestructura.",
});

// =====================================================================
// S10 · ORACLE (sand) — dos columnas
// =====================================================================
{
  const s = p.addSlide();
  s.background = { color: C.sand };
  headerContent(s, { crumb1: "03 · Peticiones a infraestructura", crumb2: "A · Base de datos (equipo Oracle)" });
  s.addText("A · Base de datos — equipo Oracle", { x: M, y: 1.08, w: 12.2, h: 0.55, fontFace: FD, fontSize: 26, bold: true, color: C.electric, margin: 0 });

  const LX = M, LW = 5.9;
  const storage = [
    { chipTxt: "Almacenamiento hot · SSD / NVMe", chipFill: C.mandarin, val: "5 TB", d: [t("Discos de "), b("alto rendimiento"), t(". Capacidad dimensionada para mantener "), b("~90 días de histórico vivo"), t(" más un margen de seguridad.")] },
    { chipTxt: "Staging · disco estándar", chipFill: C.serene, val: "2 TB", d: [t("Mapeado como un "), cd("DIRECTORY"), t(" de Oracle. Necesario para "), b("generar los ficheros .dmp"), t(" de Data Pump antes de subirlos a Epsilon.")] },
  ];
  storage.forEach((st, i) => {
    const y = 1.9 + i * 2.44;
    s.addShape(p.ShapeType.roundRect, { x: LX, y, w: LW, h: 2.14, fill: { color: C.white }, rectRadius: 0.15, line: { type: "none" }, shadow: sh() });
    chip(s, { x: LX + 0.3, y: y + 0.24, text: st.chipTxt, fill: st.chipFill, fs: 7.5, h: 0.28 });
    s.addText(st.val, { x: LX + 0.3, y: y + 0.6, w: LW - 0.6, h: 0.75, fontFace: FD, fontSize: 40, bold: true, color: C.electric, margin: 0 });
    s.addText(runsPara(st.d, {}), { x: LX + 0.3, y: y + 1.42, w: LW - 0.6, h: 0.62, fontFace: FB, fontSize: 10, color: C.electric, lineSpacingMultiple: 1.2, margin: 0, valign: "top" });
  });

  const RX = 6.75, RW = PW - M - RX;
  s.addText("Características técnicas a habilitar", { x: RX, y: 2.0, w: RW, h: 0.36, fontFace: FD, fontSize: 15.5, bold: true, color: C.electric, margin: 0 });
  const feats = [
    { ic: "configuration", d: [b("Table Partitioning"), t(" — particionado con "), cd("INTERVAL"), t(" diario.")] },
    { ic: "zip", d: [b("Compresión de objetos grandes"), t(" — "), cd("LOB STORE AS SECUREFILES (COMPRESS HIGH)"), t(".")] },
    { ic: "frequency", d: [b("Tuning"), t(" — ajuste de "), it("Redo Logs"), t(" y "), it("Undo Tablespace"), t(" para soportar alta concurrencia de inserciones masivas ("), it("Batch Inserts"), t(").")] },
  ];
  feats.forEach((f, i) => {
    const y = 2.56 + i * 1.24;
    s.addShape(p.ShapeType.roundRect, { x: RX, y, w: RW, h: 1.02, fill: { color: C.white }, rectRadius: 0.12, line: { type: "none" }, shadow: sh() });
    s.addImage({ path: icon(f.ic), x: RX + 0.26, y: y + 0.31, w: 0.4, h: 0.4 });
    s.addText(runsPara(f.d, {}), { x: RX + 0.84, y, w: RW - 1.1, h: 1.02, fontFace: FB, fontSize: 10, color: C.electric, valign: "middle", lineSpacingMultiple: 1.18, margin: 0 });
  });
  footerStd(s, { left: "03 · Peticiones a infraestructura — A · Base de datos", page: 10 });
  s.addNotes("Al equipo Oracle: 5 TB SSD/NVMe para ~90 días de histórico vivo, 2 TB de staging mapeado como DIRECTORY para los .dmp, particionado INTERVAL diario, SECUREFILES COMPRESS HIGH y tuning de Redo/Undo para batch inserts.");
}

// =====================================================================
// S11 · EPSILON / DATABUS (midnight) — 5 tarjetas de acento
// =====================================================================
{
  const s = p.addSlide();
  s.background = { color: C.midnight };
  headerContent(s, { dark: true, crumb1: "03 · Peticiones a infraestructura", crumb2: "B · Almacenamiento en frío (equipo Epsilon / DataBus)" });
  s.addText("B · Almacenamiento en frío — Epsilon / DataBus", { x: M, y: 1.06, w: 12.2, h: 0.52, fontFace: FD, fontSize: 25, bold: true, color: C.sand, margin: 0 });

  const cards = [
    { fill: C.serene, ic: "folder", kick: [t("ESPACIO Y BUCKETS")], h3: [t("Namespace gobernado")], d: [t("Creación de un espacio de nombres gobernado y "), b("1 bucket dedicado"), t(": "), cd("bucket-historico-aplicacion"), t(".")] },
    { fill: C.lime, ic: "cloud", kick: [t("CUOTA ON PREMISE · "), cd("quota.ostSize")], h3: [t("18–20 TB · año 1")], d: [t("Cubre los dumps de BD y los ficheros de negocio comprimidos. "), b("Proyección declarada al Comité:"), t(" crecimiento estimado hasta "), b("90 TB a los 5 años"), t(".")] },
    { fill: C.canary, ic: "frequency", kick: [t("LÍMITES DE TASA · "), cd("quota.rateLimit")], h3: [t("30 TPS por defecto")], d: [t("Se mantienen: las operaciones serán "), b("envíos de ficheros masivos"), t(", no micro-transacciones.")] },
    { fill: C.mandarin, ic: "attached", kick: [t("REQUISITO DE API")], h3: [t("API Multiparte")], d: [t("Autorización para utilizarla: "), b("necesaria para ficheros mayores de 150 GB"), t(", como los dumps mensuales de Data Pump.")] },
    { fill: C.purple, ic: "alarm", kick: [t("MONITORIZACIÓN")], h3: [t("Alarma "), cd("ecs.sigma")], d: [t("Vinculada al "), b("bot del namespace"), t(" y configurada con umbrales "), cd("warning: 70"), t(" y "), cd("critical: 90"), t(".")] },
  ];
  const g = 0.26;
  const w3 = (CW - 2 * g) / 3, w2 = (CW - g) / 2, h1 = 2.32, y1 = 1.72, y2 = y1 + h1 + g;
  cards.forEach((cd_, i) => {
    const top = i < 3;
    const w = top ? w3 : w2;
    const x = top ? M + i * (w3 + g) : M + (i - 3) * (w2 + g);
    const y = top ? y1 : y2;
    s.addShape(p.ShapeType.roundRect, { x, y, w, h: h1, fill: { color: cd_.fill }, rectRadius: 0.14, line: { type: "none" } });
    s.addImage({ path: icon(cd_.ic), x: x + 0.26, y: y + 0.24, w: 0.42, h: 0.42 });
    s.addText(runsPara(cd_.kick, {}), { x: x + 0.26, y: y + 0.76, w: w - 0.52, h: 0.24, fontFace: FB, fontSize: 8, bold: true, color: C.electric, charSpacing: 1, margin: 0 });
    s.addText(runsPara(cd_.h3, {}), { x: x + 0.26, y: y + 1.02, w: w - 0.52, h: 0.34, fontFace: FD, fontSize: 15, bold: true, color: C.electric, margin: 0 });
    s.addText(runsPara(cd_.d, {}), { x: x + 0.26, y: y + 1.4, w: w - 0.52, h: h1 - 1.6, fontFace: FB, fontSize: 9.5, color: C.electric, lineSpacingMultiple: 1.18, margin: 0, valign: "top" });
  });
  footerStd(s, { dark: true, left: "03 · Peticiones a infraestructura — B · Epsilon / DataBus", page: 11 });
  s.addNotes("Al equipo Epsilon/DataBus: namespace gobernado con bucket-historico-aplicacion; quota.ostSize 18–20 TB el año 1 con proyección de 90 TB a 5 años declarada al Comité; quota.rateLimit 30 TPS; autorización de API Multiparte (>150 GB); alarma ecs.sigma con umbrales 70/90 vinculada al bot del namespace.");
}

separator({
  bg: C.electric, dark: true, page: 12,
  ante: "Bloque 04 · Ingeniería de la aplicación", hero: "Tareas de\ndesarrollo propio",
  desc: "Cuatro piezas de software que el equipo construye para que el ciclo de vida funcione de extremo a extremo.",
  foot: "04 · Tareas de desarrollo propio",
  notes: "Separador del bloque 04: tareas de desarrollo propio.",
});

// =====================================================================
// S13 · DESARROLLO PROPIO (sand) — grid 2×2
// =====================================================================
{
  const s = p.addSlide();
  s.background = { color: C.sand };
  headerContent(s, { crumb1: "04 · Desarrollo propio", crumb2: "Cuatro piezas de ingeniería" });
  s.addText("Lo que construye el equipo de la aplicación", { x: M, y: 1.0, w: 12.2, h: 0.5, fontFace: FD, fontSize: 26, bold: true, color: C.electric, margin: 0 });

  const cards = [
    { dot: C.serene, ic: "copy", h3: "Motor asíncrono de escritura", items: [
      [t("Modificar la librería de logging (ej. "), cd("Logback"), t(" / "), cd("Log4j2"), t(") o implementar un componente propio.")],
      [t("Almacenar los logs en memoria y realizar inserciones en bloque ("), cd("Batch JDBC"), t(") en Oracle.")],
      [t("Evitar la escritura síncrona línea a línea.")],
    ]},
    { dot: C.lime, ic: "fingerprint", h3: "Inyección de trazabilidad", items: [
      [t("Cada ejecución genera un "), cd("trace_id"), t(" único.")],
      [t("Se propaga a lo largo de todo el ciclo de vida del proceso.")],
      [t("Presente en todos los logs asociados a la ejecución.")],
    ]},
    { dot: C.canary, ic: "database", h3: "Job de archivado de base de datos", items: [
      [t("Script orquestador de ejecución "), b("mensual"), t(": lanza la exportación ("), cd("expdp"), t(") de las particiones antiguas.")],
      [t("Sube el fichero resultante a Epsilon usando la "), b("API Multiparte"), t(".")],
      [cd("ALTER TABLE DROP PARTITION"), t(" en Oracle al confirmar la subida ("), cd("HTTP 200"), t(").")],
    ]},
    { dot: C.mandarin, ic: "zip", h3: "Job de archivado de ficheros (NFS)", items: [
      [t("Comprime los ficheros de negocio obsoletos del NFS, agrupándolos en "), cd(".zip"), t(" o "), cd(".tar.gz"), t(".")],
      [t("Los sube al bucket de Epsilon.")],
      [t("Libera el espacio local.")],
    ]},
  ];
  const gw = (CW - 0.3) / 2, gh = 2.34;
  cards.forEach((c, i) => {
    const x = M + (i % 2) * (gw + 0.3);
    const y = 1.74 + Math.floor(i / 2) * (gh + 0.3);
    s.addShape(p.ShapeType.roundRect, { x, y, w: gw, h: gh, fill: { color: C.white }, rectRadius: 0.14, line: { type: "none" }, shadow: sh() });
    s.addShape(p.ShapeType.ellipse, { x: x + 0.26, y: y + 0.24, w: 0.52, h: 0.52, fill: { color: c.dot }, line: { type: "none" } });
    s.addImage({ path: icon(c.ic), x: x + 0.37, y: y + 0.35, w: 0.3, h: 0.3 });
    s.addText(c.h3, { x: x + 0.94, y: y + 0.24, w: gw - 1.2, h: 0.52, fontFace: FD, fontSize: 14.5, bold: true, color: C.electric, valign: "middle", margin: 0 });
    s.addText(bulletRuns(c.items), { x: x + 0.3, y: y + 0.94, w: gw - 0.6, h: gh - 1.14, fontFace: FB, fontSize: 9.5, color: C.electric, paraSpaceAfter: 4, lineSpacingMultiple: 1.16, margin: 0, valign: "top" });
  });
  footerStd(s, { left: "04 · Tareas de desarrollo propio", page: 13 });
  s.addNotes("Cuatro piezas: motor asíncrono de escritura (buffer en memoria + Batch JDBC), inyección de trace_id, job mensual de archivado de BD (expdp → Multiparte → DROP PARTITION tras HTTP 200) y job de archivado de ficheros NFS (.zip/.tar.gz → bucket → liberar espacio).");
}

// =====================================================================
// S14 · CIFRAS CLAVE (electric) — 10 KPI
// =====================================================================
{
  const s = p.addSlide();
  s.background = { color: C.electric };
  headerContent(s, { dark: true, crumb1: "Telemetría & almacenamiento", crumb2: "Cifras clave" });
  s.addText("El sistema en diez cifras", { x: M, y: 1.08, w: 12.2, h: 0.52, fontFace: FD, fontSize: 26, bold: true, color: C.sand, margin: 0 });

  const kpis = [
    ["90 días", "Fase caliente de los logs en Oracle 19c"],
    ["30 días", "Fase caliente de los ficheros en NFS (ej.)"],
    ["1–5 años", "Retención de la fase fría en Epsilon"],
    ["5 TB", "Almacenamiento hot Oracle en SSD / NVMe"],
    ["2 TB", "Staging (DIRECTORY) para los .dmp de Data Pump"],
    ["18–20 TB", "Cuota Epsilon solicitada para el año 1 (quota.ostSize)"],
    ["90 TB", "Proyección a 5 años declarada al Comité"],
    ["30 TPS", "Límite de tasa por defecto (quota.rateLimit)"],
    [">150 GB", "Umbral que exige la API Multiparte (dumps mensuales)"],
    ["70 / 90", "Umbrales warning · critical de la alarma ecs.sigma"],
  ];
  const g = 0.24, kw = (CW - 4 * g) / 5, kh = 2.0;
  kpis.forEach((k, i) => {
    const x = M + (i % 5) * (kw + g);
    const y = 1.98 + Math.floor(i / 5) * (kh + 0.3);
    s.addShape(p.ShapeType.roundRect, { x, y, w: kw, h: kh, fill: { color: C.electric }, rectRadius: 0.1, line: { color: C.serene, width: 0.75 } });
    s.addText(k[0], { x: x + 0.2, y: y + 0.22, w: kw - 0.4, h: 0.55, fontFace: FD, fontSize: 23, bold: true, color: C.serene, margin: 0 });
    s.addText(k[1], { x: x + 0.2, y: y + 0.84, w: kw - 0.4, h: kh - 1.05, fontFace: FB, fontSize: 8.5, color: C.sand, lineSpacingMultiple: 1.3, margin: 0, valign: "top" });
  });
  footerStd(s, { dark: true, left: "Resumen · Cifras clave", page: 14 });
  s.addNotes("Resumen en cifras: 90 días de fase caliente en Oracle; 30 días en NFS; retención 1–5 años; 5 TB hot; 2 TB de staging; 18–20 TB de cuota el año 1; 90 TB a 5 años; 30 TPS; API Multiparte por encima de 150 GB; umbrales 70/90 de ecs.sigma.");
}

// =====================================================================
// S15 · CIERRE (electric)
// =====================================================================
{
  const s = p.addSlide();
  s.background = { color: C.electric };
  const lw = 2.6;
  bbvaLogo(s, { white: true, x: (PW - lw) / 2, y: 2.5, w: lw });
  s.addText("SISTEMA DE TELEMETRÍA Y ALMACENAMIENTO A LARGO PLAZO", {
    x: 1.5, y: 3.75, w: PW - 3, h: 0.32, fontFace: FB, fontSize: 12, bold: true, color: C.sand, charSpacing: 1.8, align: "center", margin: 0,
  });
  s.addText("Resumen arquitectónico · Agosto 2026", {
    x: 1.5, y: 4.12, w: PW - 3, h: 0.28, fontFace: FB, fontSize: 9.5, color: C.mutDark, align: "center", margin: 0,
  });
  const nfqH = 0.34, nfqW = nfqH / AR_NFQ, lblW = 0.95, gap = 0.14;
  const total = lblW + gap + nfqW, sx = (PW - total) / 2;
  s.addText("HECHO POR", { x: sx, y: 6.35, w: lblW, h: nfqH, fontFace: FB, fontSize: 8, bold: true, color: C.mutDark, charSpacing: 1.5, align: "right", valign: "middle", margin: 0 });
  nfqLogo(s, { white: true, x: sx + lblW + gap, y: 6.35, h: nfqH });
  s.addNotes("Cierre. Presentación elaborada por NFQ para BBVA.");
}

p.writeFile({ fileName: "presentacion-telemetria-bbva-nfq.pptx" }).then(() => console.log("OK pptx escrito"));
