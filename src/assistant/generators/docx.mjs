import { createRequire } from "node:module";
import { COLORS, FONT_BODY, FONT_DISPLAY, readLogo, LOGO_RATIO, plainText } from "./brand.mjs";

const require = createRequire(import.meta.url);

/**
 * Documento Word con identidad BBVA × NFQ a partir del modelo de documento del asistente:
 * { title, subtitle, date, author, sections: [{ heading, level, paragraphs[], bullets[], numbered[], table: { headers, rows }, callout, code }] }
 */
export async function buildDocx(model) {
  const docx = require("docx");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, ImageRun, Header, Footer, BorderStyle, ShadingType, PageNumber } = docx;
  const bbva = await readLogo("bbva-electric.png");
  const nfq = await readLogo("nfq-black.png");

  const run = (text, options = {}) => new TextRun({ text: plainText(text), font: FONT_BODY, size: 22, color: COLORS.midnight, ...options });
  const runsOf = (value, base = {}) => {
    if (Array.isArray(value)) return value.map((part) => (typeof part === "object" && part ? run(part.text, { ...base, bold: Boolean(part.bold), italics: Boolean(part.italic) }) : run(part, base)));
    return [run(value, base)];
  };
  const children = [];

  children.push(new Paragraph({ spacing: { after: 120 }, children: [run((model.kicker || "BBVA CIB").toUpperCase(), { color: COLORS.gray5, size: 18, bold: true, characterSpacing: 60 })] }));
  children.push(new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: plainText(model.title || "Documento"), font: FONT_DISPLAY, size: 56, bold: true, color: COLORS.electric })] }));
  if (model.subtitle) children.push(new Paragraph({ spacing: { after: 240 }, children: [run(model.subtitle, { size: 26, color: COLORS.gray5 })] }));
  const meta = [model.date || new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" }), model.author, model.version ? `Versión ${model.version}` : ""].filter(Boolean).join(" · ");
  if (meta) children.push(new Paragraph({ spacing: { after: 360 }, border: { bottom: { color: COLORS.gray3, style: BorderStyle.SINGLE, size: 6 } }, children: [run(meta, { size: 18, color: COLORS.gray5 })] }));

  const headingParagraph = (text, level) => {
    const sizes = { 1: 36, 2: 28, 3: 24 };
    return new Paragraph({
      heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
      spacing: { before: level === 1 ? 360 : 240, after: 120 },
      children: [new TextRun({ text: plainText(text), font: FONT_DISPLAY, size: sizes[level] || 24, bold: true, color: COLORS.electric })],
    });
  };

  for (const section of model.sections || []) {
    if (section.heading) children.push(headingParagraph(section.heading, Number(section.level) || 1));
    for (const paragraph of section.paragraphs || []) children.push(new Paragraph({ spacing: { after: 140, line: 320 }, children: runsOf(paragraph) }));
    for (const bullet of section.bullets || []) children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 80 }, children: runsOf(bullet) }));
    (section.numbered || []).forEach((item, index) => children.push(new Paragraph({ spacing: { after: 80 }, indent: { left: 360, hanging: 360 }, children: [run(`${index + 1}. `, { bold: true, color: COLORS.electric }), ...runsOf(item)] })));
    if (section.callout) {
      children.push(new Paragraph({
        spacing: { before: 160, after: 200 },
        shading: { type: ShadingType.CLEAR, fill: COLORS.serene, color: "auto" },
        indent: { left: 240, right: 240 },
        children: [new TextRun({ text: plainText(section.callout), font: FONT_DISPLAY, size: 26, bold: true, color: COLORS.electric })],
      }));
    }
    if (section.code) {
      for (const line of String(section.code).split("\n")) {
        children.push(new Paragraph({ shading: { type: ShadingType.CLEAR, fill: COLORS.gray2, color: "auto" }, spacing: { after: 0 }, children: [new TextRun({ text: line || " ", font: "Consolas", size: 18, color: COLORS.midnight })] }));
      }
      children.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
    }
    if (section.table?.headers?.length) {
      const headerRow = new TableRow({
        tableHeader: true,
        children: section.table.headers.map((header) => new TableCell({ shading: { type: ShadingType.CLEAR, fill: COLORS.electric, color: "auto" }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [run(header, { bold: true, color: COLORS.white, size: 18 })] })] })),
      });
      const rows = (section.table.rows || []).map((cells, rowIndex) => new TableRow({
        children: section.table.headers.map((_, cellIndex) => new TableCell({ shading: { type: ShadingType.CLEAR, fill: rowIndex % 2 ? COLORS.sand : COLORS.white, color: "auto" }, margins: { top: 60, bottom: 60, left: 120, right: 120 }, children: [new Paragraph({ children: runsOf(cells?.[cellIndex] ?? "", { size: 18 }) })] })),
      }));
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...rows] }));
      children.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
    }
  }

  const logoWidth = 110;
  const document = new Document({
    creator: model.author || "NFQ · KDD Studio",
    title: plainText(model.title || "Documento"),
    styles: { default: { document: { run: { font: FONT_BODY, size: 22, color: COLORS.midnight } } } },
    sections: [{
      properties: { page: { margin: { top: 1300, right: 1100, bottom: 1100, left: 1100 } } },
      headers: {
        default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new ImageRun({ type: "png", data: bbva, transformation: { width: logoWidth, height: Math.round(logoWidth * LOGO_RATIO.bbva) } })] })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.LEFT, children: [run("Hecho por ", { size: 14, color: COLORS.gray5 }), new ImageRun({ type: "png", data: nfq, transformation: { width: 44, height: Math.round(44 * LOGO_RATIO.nfq) } }), run("    ", {}), run("Página ", { size: 14, color: COLORS.gray5 }), new TextRun({ children: [PageNumber.CURRENT], font: FONT_BODY, size: 14, color: COLORS.gray5 })] })] }),
      },
      children,
    }],
  });
  return Packer.toBuffer(document);
}
