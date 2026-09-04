import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import zlib from "node:zlib";

/**
 * Genera `public/brand/kdd.ico` a partir del PNG de marca.
 *
 * El detalle que importa: Windows solo entiende iconos comprimidos en PNG dentro de un `.ico`
 * en el tamaño 256x256. Para 16, 24, 32 y 48 —los que dibuja el Explorador en las vistas de
 * lista, detalles e iconos medianos— hay que escribir el formato clásico DIB (cabecera
 * BITMAPINFOHEADER, píxeles BGRA de abajo arriba y máscara AND de 1 bit). Un `.ico` con todo
 * en PNG se ve bien en editores y en la pestaña de propiedades, pero el Explorador cae al
 * icono genérico: exactamente el síntoma que teníamos.
 *
 * Sin dependencias a propósito: decodifica el PNG con zlib, reduce con filtro de caja y
 * vuelve a codificar. Así el icono se puede regenerar en cualquier equipo con solo Node.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(root, "public/brand/kdd-icon.png");
const TARGET = path.join(root, "public/brand/kdd.ico");

/** Tamaños que pide Windows. Solo el último viaja como PNG. */
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const PNG_SIZE = 256;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decodifica un PNG de 8 bits RGBA sin entrelazar a un búfer plano de píxeles. */
function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("El fichero no es un PNG.");
  const parts = [];
  let header = null;
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    } else if (type === "IDAT") {
      parts.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (!header) throw new Error("El PNG no tiene cabecera IHDR.");
  if (header.depth !== 8 || header.color !== 6 || header.interlace !== 0) {
    throw new Error(`Solo se admite PNG RGBA de 8 bits sin entrelazar (depth=${header.depth} color=${header.color} interlace=${header.interlace}).`);
  }

  const { width, height } = header;
  const raw = zlib.inflateSync(Buffer.concat(parts));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  let read = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[read];
    read += 1;
    const line = raw.subarray(read, read + stride);
    read += stride;
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? out[x - 4] : 0;
      const up = prev ? prev[x] : 0;
      const upLeft = prev && x >= 4 ? prev[x - 4] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`Filtro PNG desconocido: ${filter}`);
      out[x] = value & 0xff;
    }
  }
  return { width, height, pixels };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Reduce con filtro de caja pesando por área. Promedia el color en espacio premultiplicado
 * para que los bordes suavizados no se ensucien con el color de los píxeles transparentes.
 */
function resize(image, size) {
  const { width, height, pixels } = image;
  const out = Buffer.alloc(size * size * 4);
  const scaleX = width / size;
  const scaleY = height / size;
  for (let y = 0; y < size; y += 1) {
    const y0 = y * scaleY;
    const y1 = (y + 1) * scaleY;
    for (let x = 0; x < size; x += 1) {
      const x0 = x * scaleX;
      const x1 = (x + 1) * scaleX;
      let r = 0; let g = 0; let b = 0; let a = 0; let weight = 0;
      for (let sy = Math.floor(y0); sy < Math.min(height, Math.ceil(y1)); sy += 1) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (let sx = Math.floor(x0); sx < Math.min(width, Math.ceil(x1)); sx += 1) {
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
          const w = wy * wx;
          if (w <= 0) continue;
          const i = (sy * width + sx) * 4;
          const alpha = pixels[i + 3] / 255;
          r += pixels[i] * alpha * w;
          g += pixels[i + 1] * alpha * w;
          b += pixels[i + 2] * alpha * w;
          a += pixels[i + 3] * w;
          weight += w;
        }
      }
      const i = (y * size + x) * 4;
      const alpha = weight ? a / weight : 0;
      const norm = alpha > 0 ? weight * (alpha / 255) : 0;
      out[i] = norm ? Math.round(r / norm) : 0;
      out[i + 1] = norm ? Math.round(g / norm) : 0;
      out[i + 2] = norm ? Math.round(b / norm) : 0;
      out[i + 3] = Math.round(alpha);
    }
  }
  return { width: size, height: size, pixels: out };
}

/** Entrada clásica: BITMAPINFOHEADER + píxeles BGRA de abajo arriba + máscara AND de 1 bit. */
function encodeDib({ width, height, pixels }) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8); // color + máscara, según manda el formato
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(width * height * 4, 20);

  const color = Buffer.alloc(width * height * 4);
  const maskStride = Math.ceil(width / 8 / 4) * 4;
  const mask = Buffer.alloc(maskStride * height);
  for (let y = 0; y < height; y += 1) {
    const source = height - 1 - y; // el DIB va de abajo arriba
    for (let x = 0; x < width; x += 1) {
      const i = (source * width + x) * 4;
      const o = (y * width + x) * 4;
      color[o] = pixels[i + 2];
      color[o + 1] = pixels[i + 1];
      color[o + 2] = pixels[i];
      color[o + 3] = pixels[i + 3];
      if (pixels[i + 3] < 128) mask[y * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, color, mask]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng({ width, height, pixels }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function main() {
  const source = decodePng(await readFile(SOURCE));
  const images = SIZES.map((size) => {
    const scaled = size === source.width && size === source.height ? source : resize(source, size);
    return { size, body: size === PNG_SIZE ? encodePng(scaled) : encodeDib(scaled) };
  });

  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // tipo icono
  header.writeUInt16LE(images.length, 4);
  const directory = Buffer.alloc(images.length * 16);
  let offset = header.length + directory.length;
  images.forEach((image, index) => {
    const at = index * 16;
    directory[at] = image.size === 256 ? 0 : image.size;
    directory[at + 1] = image.size === 256 ? 0 : image.size;
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(image.body.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += image.body.length;
  });

  const ico = Buffer.concat([header, directory, ...images.map((image) => image.body)]);
  await writeFile(TARGET, ico);
  const detail = images.map((image) => `${image.size}${image.size === PNG_SIZE ? " (PNG)" : ""}`).join(", ");
  console.log(`[make-icon] ${path.relative(root, TARGET)}: ${detail} — ${(ico.length / 1024).toFixed(1)} kB.`);
}

await main();
