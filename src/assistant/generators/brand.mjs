import path from "node:path";
import { readFile } from "node:fs/promises";
import { paths } from "../../paths.mjs";

/**
 * Tokens de la identidad BBVA × NFQ (docs/identidad-bbva/tokens.json) para los generadores de
 * documentos. HEX sin `#` para pptxgenjs/docx.
 */
export const COLORS = Object.freeze({
  electric: "001391",
  serene: "85C8FF",
  white: "FFFFFF",
  sand: "F7F8F8",
  gray2: "E2E6EA",
  gray3: "CAD1D8",
  gray4: "ADB8C2",
  gray5: "46536D",
  midnight: "070E46",
  deep: "000519",
  canary: "FFE761",
  lime: "88E783",
  ice: "8BE1E9",
  purple: "9694FF",
  mandarin: "FFB56B",
  mutDark: "ADB3D9",
  leadDark: "D9DDEC",
});

export const FONT_DISPLAY = "Source Serif 4";
export const FONT_BODY = "Lato";

export const COMBOS = Object.freeze({
  sand: { bg: COLORS.sand, fg: COLORS.electric, secondary: COLORS.gray5, accent: COLORS.serene, bbvaLogo: "bbva-electric.png", nfqLogo: "nfq-black.png" },
  serene: { bg: COLORS.serene, fg: COLORS.electric, secondary: COLORS.electric, accent: COLORS.sand, bbvaLogo: "bbva-electric.png", nfqLogo: "nfq-black.png" },
  electric: { bg: COLORS.electric, fg: COLORS.sand, secondary: COLORS.mutDark, accent: COLORS.serene, bbvaLogo: "bbva-white.png", nfqLogo: "nfq-white.png" },
  midnight: { bg: COLORS.midnight, fg: COLORS.sand, secondary: COLORS.mutDark, accent: COLORS.serene, bbvaLogo: "bbva-white.png", nfqLogo: "nfq-white.png" },
});

export const ACCENT_CYCLE = [COLORS.serene, COLORS.lime, COLORS.canary, COLORS.mandarin, COLORS.purple, COLORS.ice];

export const LOGO_RATIO = { bbva: 308 / 1008, nfq: 740 / 1568 };

const logoCache = new Map();

export async function readLogo(name) {
  if (!logoCache.has(name)) logoCache.set(name, await readFile(path.join(paths.publicDir, "brand", name)));
  return logoCache.get(name);
}

export async function logoDataUri(name) {
  const buffer = await readLogo(name);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

/** Texto plano de un valor que puede venir como string, array de strings o runs {text, bold}. */
export function plainText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(plainText).join("");
  if (typeof value === "object" && value.text !== undefined) return String(value.text);
  return String(value);
}
