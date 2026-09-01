#!/usr/bin/env node
/**
 * Genera los logos con transparencia a partir de los ficheros de identidad (que son JPEG con fondo
 * blanco): BBVA en Electric Blue y en blanco, NFQ en negro y en blanco (el isotipo conserva sus
 * colores) y el isotipo NFQ. Salida: public/brand/*.png. Se ejecuta una vez y el resultado se versiona.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const jpeg = require("jpeg-js");
const { PNG } = require("pngjs");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const brandDir = path.join(root, "docs", "identidad-bbva");
const outDir = path.join(root, "public", "brand");

function decode(file) {
  return jpeg.decode(file, { useTArray: true, formatAsRGBA: true });
}

function toPng(width, height, rgba) {
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba);
  return PNG.sync.write(png);
}

/** Alpha = oscuridad respecto al blanco; el color se toma del píxel original (o se fuerza a `tint`). */
function keyOutWhite(image, { tint, preserveColor = false } = {}) {
  const { width, height, data } = image;
  const out = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const r = data[index * 4];
    const g = data[index * 4 + 1];
    const b = data[index * 4 + 2];
    const darkness = 255 - Math.min(r, g, b);
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);
    const alpha = Math.min(255, Math.round(darkness * 1.15 + (preserveColor ? saturation * 0.4 : 0)));
    let [cr, cg, cb] = tint || [r, g, b];
    if (!tint && alpha > 0 && alpha < 255) {
      // Des-premultiplica sobre blanco para que los bordes no queden grises.
      cr = Math.max(0, Math.min(255, Math.round(255 - (255 - r) * 255 / alpha)));
      cg = Math.max(0, Math.min(255, Math.round(255 - (255 - g) * 255 / alpha)));
      cb = Math.max(0, Math.min(255, Math.round(255 - (255 - b) * 255 / alpha)));
    }
    out[index * 4] = cr;
    out[index * 4 + 1] = cg;
    out[index * 4 + 2] = cb;
    out[index * 4 + 3] = alpha;
  }
  return { width, height, data: out };
}

/** Versión blanca del logo NFQ: el texto negro pasa a blanco; el isotipo (píxeles saturados) se conserva. */
function whitenText(image) {
  const { width, height, data } = image;
  const out = new Uint8Array(data);
  for (let index = 0; index < width * height; index += 1) {
    const r = data[index * 4];
    const g = data[index * 4 + 1];
    const b = data[index * 4 + 2];
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);
    if (saturation < 40) {
      out[index * 4] = 255;
      out[index * 4 + 1] = 255;
      out[index * 4 + 2] = 255;
    }
  }
  return { width, height, data: out };
}

function trim(image, margin = 4) {
  const { width, height, data } = image;
  let minX = width; let minY = height; let maxX = 0; let maxY = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 16) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  }
  minX = Math.max(0, minX - margin); minY = Math.max(0, minY - margin); maxX = Math.min(width - 1, maxX + margin); maxY = Math.min(height - 1, maxY + margin);
  const w = maxX - minX + 1; const h = maxY - minY + 1;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) out.set(data.subarray(((y + minY) * width + minX) * 4, ((y + minY) * width + maxX + 1) * 4), y * w * 4);
  return { width: w, height: h, data: out };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const bbva = decode(await readFile(path.join(brandDir, "BBVA_RGB.png")));
  const blue = trim(keyOutWhite(bbva, { tint: [0, 19, 145] }));
  const white = { ...blue, data: blue.data.map((value, index) => (index % 4 === 3 ? value : 255)) };
  await writeFile(path.join(outDir, "bbva-electric.png"), toPng(blue.width, blue.height, blue.data));
  await writeFile(path.join(outDir, "bbva-white.png"), toPng(white.width, white.height, white.data));

  const nfq = decode(await readFile(path.join(brandDir, "Nfq__Black.png")));
  const black = trim(keyOutWhite(nfq, { preserveColor: true }));
  await writeFile(path.join(outDir, "nfq-black.png"), toPng(black.width, black.height, black.data));
  const nfqWhite = whitenText(black);
  await writeFile(path.join(outDir, "nfq-white.png"), toPng(nfqWhite.width, nfqWhite.height, nfqWhite.data));

  const iso = decode(await readFile(path.join(brandDir, "Isotipo__Nfq__Color.png")));
  const isotype = trim(keyOutWhite(iso, { preserveColor: true }));
  await writeFile(path.join(outDir, "nfq-isotype.png"), toPng(isotype.width, isotype.height, isotype.data));
  console.log(`Logos generados en ${outDir}: bbva-electric (${blue.width}x${blue.height}), bbva-white, nfq-black (${black.width}x${black.height}), nfq-white, nfq-isotype (${isotype.width}x${isotype.height}).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
