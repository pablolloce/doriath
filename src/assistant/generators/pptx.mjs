import { createRequire } from "node:module";
import { COLORS, COMBOS, ACCENT_CYCLE, FONT_BODY, FONT_DISPLAY, LOGO_RATIO, logoDataUri, plainText } from "./brand.mjs";

const require = createRequire(import.meta.url);

/**
 * Presentación PPTX con la identidad BBVA × NFQ siguiendo docs/identidad-bbva/08-pptx.md:
 * formato 16:9 (13.333 × 7.5 in), margen 0.55, combos A-D, logos en cabecera/pie, tipografías
 * Source Serif 4 (titulares) y Lato (cuerpo), texto sobre acentos siempre en Electric Blue.
 *
 * Modelo: { title, subtitle, date, slides: [{ kind: cover|section|content|bullets|cards|table|quote|closing, title, kicker, body, bullets[], cards[{title, text}], table{headers, rows}, combo }] }
 */
const PW = 13.333;
const PH = 7.5;
const M = 0.55;
const CW = PW - 2 * M;

function pickCombo(slide, index) {
  if (slide.combo && COMBOS[slide.combo]) return { name: slide.combo, ...COMBOS[slide.combo] };
  if (slide.kind === "cover" || slide.kind === "closing") return { name: "electric", ...COMBOS.electric };
  if (slide.kind === "section") return { name: "serene", ...COMBOS.serene };
  if (slide.kind === "quote") return { name: "midnight", ...COMBOS.midnight };
  return index % 5 === 4 ? { name: "serene", ...COMBOS.serene } : { name: "sand", ...COMBOS.sand };
}

export async function buildPptx(model) {
  const pptxgen = require("pptxgenjs");
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  pres.title = plainText(model.title || "Presentación");
  pres.company = "BBVA · NFQ";
  pres.author = model.author || "NFQ";

  const logos = {
    "bbva-electric.png": await logoDataUri("bbva-electric.png"),
    "bbva-white.png": await logoDataUri("bbva-white.png"),
    "nfq-black.png": await logoDataUri("nfq-black.png"),
    "nfq-white.png": await logoDataUri("nfq-white.png"),
  };
  const slides = Array.isArray(model.slides) && model.slides.length ? model.slides : [{ kind: "cover", title: model.title, subtitle: model.subtitle }];
  const total = slides.length + (slides.some((slide) => slide.kind === "closing") ? 0 : 1);
  const shadow = () => ({ type: "outer", color: COLORS.electric, opacity: 0.12, blur: 8, offset: 2, angle: 90 });

  const chrome = (slide, combo, index, { cover = false, closing = false } = {}) => {
    const bbvaWidth = cover ? 1.7 : 1.05;
    if (!closing) slide.addImage({ data: logos[combo.bbvaLogo], x: PW - M - bbvaWidth, y: cover ? 0.42 : 0.33, w: bbvaWidth, h: bbvaWidth * LOGO_RATIO.bbva });
    if (cover || closing) {
      slide.addText("HECHO POR", { x: 9.8, y: 6.96, w: 1.2, h: 0.33, fontFace: FONT_BODY, fontSize: 8, bold: true, color: combo.secondary, charSpacing: 1.2, align: "right", valign: "middle" });
      slide.addImage({ data: logos[combo.nfqLogo], x: 11.1, y: 6.92, w: 0.33 / LOGO_RATIO.nfq, h: 0.33 });
    } else {
      slide.addText(plainText(model.footer || model.title || ""), { x: M, y: 7.06, w: 7.6, h: 0.26, fontFace: FONT_BODY, fontSize: 8, color: combo.secondary, valign: "middle" });
      slide.addImage({ data: logos[combo.nfqLogo], x: 11.4, y: 7.105, w: 0.17 / LOGO_RATIO.nfq, h: 0.17 });
      slide.addText(`p. ${String(index + 1).padStart(2, "0")} / ${total}`, { x: 11.86, y: 7.06, w: 0.92, h: 0.26, fontFace: FONT_BODY, fontSize: 8, color: combo.secondary, align: "right", valign: "middle" });
    }
  };

  const breadcrumb = (slide, combo, text) => {
    if (!text) return;
    slide.addText(plainText(text).toUpperCase(), { x: M, y: 0.3, w: 9.4, h: 0.32, fontFace: FONT_BODY, fontSize: 9, bold: true, color: combo.secondary, charSpacing: 1.2, valign: "middle" });
  };

  const bodyRuns = (items, color, fontSize = 14) => items.map((item, position) => ({ text: `•  ${plainText(item)}`, options: { fontFace: FONT_BODY, fontSize, color, breakLine: position < items.length - 1, paraSpaceAfter: 8 } }));

  slides.forEach((spec, index) => {
    const combo = pickCombo(spec, index);
    const slide = pres.addSlide();
    slide.background = { color: combo.bg };
    const kind = spec.kind || (spec.bullets?.length ? "bullets" : spec.cards?.length ? "cards" : spec.table ? "table" : "content");
    if (kind === "cover") {
      chrome(slide, combo, index, { cover: true });
      slide.addText(plainText(spec.kicker || model.date || new Date().toLocaleDateString("es-ES", { month: "long", year: "numeric" })).toUpperCase(), { x: M, y: 4.2, w: CW, h: 0.4, fontFace: FONT_BODY, fontSize: 12, color: combo.secondary, charSpacing: 1.2 });
      slide.addShape(pres.ShapeType.line, { x: M, y: 4.7, w: 5.5, h: 0, line: { color: combo.fg, width: 0.75, transparency: 50 } });
      slide.addText(plainText(spec.title || model.title), { x: M, y: 4.8, w: CW, h: 1.6, fontFace: FONT_DISPLAY, fontSize: 44, bold: true, color: combo.fg, valign: "top", fit: "shrink" });
      if (spec.subtitle || model.subtitle) slide.addText(plainText(spec.subtitle || model.subtitle), { x: M, y: 6.35, w: CW - 3, h: 0.5, fontFace: FONT_BODY, fontSize: 14, color: COLORS.leadDark });
      return;
    }
    if (kind === "closing") {
      chrome(slide, combo, index, { closing: true });
      slide.addImage({ data: logos[combo.bbvaLogo], x: (PW - 2.6) / 2, y: 2.5, w: 2.6, h: 2.6 * LOGO_RATIO.bbva });
      if (spec.title) slide.addText(plainText(spec.title), { x: M, y: 3.7, w: CW, h: 0.8, fontFace: FONT_DISPLAY, fontSize: 24, bold: true, color: combo.fg, align: "center" });
      return;
    }
    chrome(slide, combo, index);
    breadcrumb(slide, combo, spec.kicker);
    if (kind === "section") {
      slide.addText(plainText(spec.subtitle || ""), { x: M, y: 4.3, w: CW, h: 0.4, fontFace: FONT_BODY, fontSize: 14, color: combo.fg });
      slide.addText(plainText(spec.title), { x: M, y: 4.7, w: CW, h: 1.8, fontFace: FONT_DISPLAY, fontSize: 48, bold: true, color: combo.fg, valign: "top", fit: "shrink" });
      return;
    }
    if (kind === "quote") {
      slide.addShape(pres.ShapeType.roundRect, { x: 2.2, y: 2.1, w: PW - 4.4, h: 3.3, fill: { color: COLORS.electric }, rectRadius: 0.15, line: { color: COLORS.electric } });
      slide.addText(plainText(spec.title || spec.body), { x: 2.6, y: 2.4, w: PW - 5.2, h: 2.7, fontFace: FONT_DISPLAY, fontSize: 26, bold: true, color: COLORS.sand, align: "center", valign: "middle", fit: "shrink" });
      return;
    }
    slide.addText(plainText(spec.title || ""), { x: M, y: 1.0, w: CW, h: 1.0, fontFace: FONT_DISPLAY, fontSize: 30, bold: true, color: combo.fg, valign: "top", fit: "shrink" });
    let y = 2.15;
    if (spec.body) {
      const bodyText = plainText(spec.body);
      const height = kind === "content" ? 4.5 : 1.0;
      slide.addText(bodyText, { x: M, y, w: kind === "content" ? CW * 0.68 : CW, h: height, fontFace: FONT_BODY, fontSize: 14, color: combo.fg, valign: "top", fit: "shrink", paraSpaceAfter: 8 });
      y += height + 0.15;
    }
    if (kind === "bullets" && spec.bullets?.length) {
      slide.addText(bodyRuns(spec.bullets, combo.fg), { x: M, y, w: CW * 0.7, h: 6.85 - y, fontFace: FONT_BODY, fontSize: 14, color: combo.fg, valign: "top", fit: "shrink" });
    }
    if (kind === "cards" && spec.cards?.length) {
      const cards = spec.cards.slice(0, 6);
      const columns = cards.length <= 3 ? cards.length : Math.ceil(cards.length / 2);
      const rows = Math.ceil(cards.length / columns);
      const gap = 0.25;
      const width = (CW - gap * (columns - 1)) / columns;
      const height = Math.min(2.6, (6.85 - y - gap * (rows - 1)) / rows);
      cards.forEach((card, position) => {
        const column = position % columns;
        const row = Math.floor(position / columns);
        const x = M + column * (width + gap);
        const top = y + row * (height + gap);
        slide.addShape(pres.ShapeType.roundRect, { x, y: top, w: width, h: height, fill: { color: ACCENT_CYCLE[position % ACCENT_CYCLE.length] }, rectRadius: 0.12, line: { color: ACCENT_CYCLE[position % ACCENT_CYCLE.length] }, shadow: shadow() });
        slide.addText(plainText(card.title || ""), { x: x + 0.2, y: top + 0.2, w: width - 0.4, h: 0.6, fontFace: FONT_DISPLAY, fontSize: 16, bold: true, color: COLORS.electric, valign: "top" });
        slide.addText(plainText(card.text || card.body || ""), { x: x + 0.2, y: top + 0.8, w: width - 0.4, h: height - 1.0, fontFace: FONT_BODY, fontSize: 12, color: COLORS.electric, valign: "top", fit: "shrink" });
      });
    }
    if (kind === "table" && spec.table?.headers?.length) {
      const headers = spec.table.headers.map((header) => ({ text: plainText(header).toUpperCase(), options: { bold: true, color: COLORS.white, fill: { color: COLORS.electric }, fontFace: FONT_BODY, fontSize: 10 } }));
      const rows = (spec.table.rows || []).map((row, rowIndex) => spec.table.headers.map((_, cellIndex) => ({ text: plainText(row?.[cellIndex] ?? ""), options: { fontFace: FONT_BODY, fontSize: 10, color: COLORS.midnight, fill: { color: rowIndex % 2 ? COLORS.gray2 : COLORS.white } } })));
      slide.addTable([headers, ...rows], { x: M, y, w: CW, colW: spec.table.widths, border: { type: "solid", color: COLORS.gray3, pt: 0.5 }, autoPage: false, fontFace: FONT_BODY });
    }
  });

  if (!slides.some((slide) => slide.kind === "closing")) {
    const combo = { name: "electric", ...COMBOS.electric };
    const slide = pres.addSlide();
    slide.background = { color: combo.bg };
    chrome(slide, combo, slides.length, { closing: true });
    slide.addImage({ data: logos[combo.bbvaLogo], x: (PW - 2.6) / 2, y: 2.5, w: 2.6, h: 2.6 * LOGO_RATIO.bbva });
  }
  return pres.write({ outputType: "nodebuffer" });
}
