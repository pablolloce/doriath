# 08 · Presentaciones PPTX (HTML → PPTX o creación directa)

Cuándo aplica este documento:

- **Ruta A — conversión**: ya existe una presentación HTML de este sistema y se pide "conviértela en pptx".
- **Ruta B — creación directa**: se pide la presentación **como PowerPoint desde el principio**. En ese caso NO hace falta pasar por HTML: se diseña con los mismos combos, componentes y tokens de esta guía y se genera el `.pptx` directamente.

En ambos casos la herramienta es **pptxgenjs** (script Node) + el flujo de QA descrito al final. Todo lo que dicen `01-color.md`, `02-tipografia.md`, `06-co-branding-nfq.md` y las reglas duras de `AGENTS.md` sigue vigente: cambia el formato de salida, no la identidad.

> Antes de escribir código lee la skill `/mnt/skills/public/pptx/SKILL.md` (si estás en un entorno con skills). Este documento la complementa con lo específico de BBVA × NFQ y con las trampas que ya hemos verificado.

---

## 🧰 0. Herramientas y preparación del entorno

| Herramienta | Uso |
|---|---|
| `pptxgenjs` (Node, preinstalado) | Generar el `.pptx` desde un script `gen_pptx.js`. No hace falta `npm install`. |
| `scripts/office/validate.py deck.pptx` (skill pptx) | Validación OOXML obligatoria tras cada build. Debe decir `All validations PASSED!`. |
| `scripts/office/soffice.py --headless --convert-to pdf` + `pdftoppm -jpeg -r 110` | Render a imágenes para QA visual slide a slide. |
| `markitdown deck.pptx` | Volcado de texto para comprobar contenido (chequeo de hechos). |
| Python + Pillow | Convertir iconos a PNG / generar variantes blancas. |

**Instala las fuentes de marca en el sandbox** antes del QA. Si no, LibreOffice sustituye Source Serif 4 y Lato por otras métricas y el render miente sobre desbordes:

```bash
mkdir -p ~/.fonts && cd ~/.fonts
base="https://raw.githubusercontent.com/google/fonts/main/ofl"
for f in Lato-Regular.ttf Lato-Bold.ttf Lato-Italic.ttf Lato-BoldItalic.ttf Lato-Black.ttf; do
  curl -sfL "$base/lato/$f" -o "$f"
done
curl -sfL "$base/sourceserif4/SourceSerif4%5Bopsz%2Cwght%5D.ttf" -o SourceSerif4.ttf
curl -sfL "$base/sourceserif4/SourceSerif4-Italic%5Bopsz%2Cwght%5D.ttf" -o SourceSerif4-Italic.ttf
fc-cache -f ~/.fonts
```

En el `.pptx` se escriben los nombres reales (`"Source Serif 4"` y `"Lato"`). PowerPoint no admite pilas de fuentes: si el equipo que abre el archivo no las tiene, sustituye por Georgia/Arial. Es aceptable (son gratuitas y el equipo BBVA/NFQ las tiene); menciónalo al entregar.

**Assets** (logos e iconos) tienen que estar como PNG con transparencia en el directorio de trabajo:

```
assets/
  bbva_blue.png    ← BBVA_RGB.png   (524×160, ratio 160/524)
  bbva_white.png   ← BBVA_WHITE.png
  nfq_black.png    ← Nfq__Black.png (254×120, ratio 120/254)
  nfq_white.png    ← Nfq__White.png
icons/<nombre>.png ← iconos oficiales rasterizados a 96–256 px en Electric #001391
```

Iconos: solo los del catálogo `05-iconografia.md`. Si el origen es SVG, rasteriza con `cairosvg`/`sharp` poniendo `fill="#001391"`; si el origen es PDF, `pdftoppm -png -r 300` y recorta. Los iconos van **en Electric** sobre Sand, Serene, blanco y sobre cualquier acento (tarjetas Canary/Lime/Ice/Mandarin/Purple/Serene). Solo necesitas una **variante blanca** si el icono se apoya directamente sobre Electric o Midnight sin caja de acento debajo:

```python
from PIL import Image
im = Image.open("icons/database.png").convert("RGBA")
r, g, b, a = im.split()
Image.merge("RGBA", (a.point(lambda _: 255), a.point(lambda _: 255), a.point(lambda _: 255), a)).save("icons_white/database.png")
```

---

## 🎨 1. Tokens → pptxgenjs

pptxgenjs quiere HEX **sin `#`** y **sin canal alfa** (un `#` o un hex de 8 dígitos corrompen el archivo).

```js
const C = {
  electric: "001391", midnight: "070E46", sand: "F7F8F8", serene: "85C8FF",
  canary: "FFE761", lime: "88E783", ice: "8BE1E9", purple: "9694FF", mandarin: "FFB56B",
  white: "FFFFFF", gray2: "E2E6EA", gray3: "CAD1D8", gray5: "46536D",
  mutDark: "ADB3D9",   // = Sand al 70 % sobre Electric/Midnight (breadcrumbs, pies, "HECHO POR")
  leadDark: "D9DDEC",  // = Sand al 88 % sobre Electric (párrafo lead de portada)
};
const FD = "Source Serif 4"; // titulares, h3 de tarjeta, cifras grandes
const FB = "Lato";           // todo lo demás
```

El texto en PowerPoint no tiene opacidad: los "Sand al 70 %" del CSS se sustituyen por **colores planos precalculados** (`mutDark`, `leadDark`). No inventes otros HEX.

### Las 4 combinaciones (igual que `01-color.md`)

| Combo | `slide.background` | Texto principal | Texto secundario | Logo BBVA | Logo NFQ |
|---|---|---|---|---|---|
| A · Sand | `sand` | `electric` | `gray5` | `bbva_blue` | `nfq_black` |
| B · Serene | `serene` | `electric` | `electric` | `bbva_blue` | `nfq_black` |
| C · Electric | `electric` | `sand` | `mutDark` / `leadDark` | `bbva_white` | `nfq_white` |
| D · Midnight | `midnight` | `sand` | `mutDark` | `bbva_white` | `nfq_white` |

Reglas duras que siguen aplicando: sin `000000`; **texto sobre acentos siempre `electric`**; sobre Sand nunca texto Sand; acento de datos sobre fondos oscuros = `serene`.

---

## 📐 2. Formato y geometría (pulgadas)

`pres.layout = "LAYOUT_WIDE"` → **13.333 × 7.5 in**, equivalente a 1920 × 1080 px (1 in = 144 px). Fíjalo **antes** de añadir slides.

| Concepto CSS | Equivalencia pptx |
|---|---|
| retícula 8 px | 0.056 in (usa pasos de ~0.06) |
| margen 64–80 px | `M = 0.55` in (≈80 px). Ancho útil `CW = 12.233` |
| radio 8 px / 16 px / 24 px | `rectRadius` 0.06 / 0.10–0.12 / 0.14–0.15 |
| píldora (`9999px`) | `rectRadius = h / 2` |
| sombra `0 4px 16px rgba(0,19,145,.06)` | `{ type:"outer", color:"001391", opacity:0.12, blur:8, offset:2, angle:90 }` (objeto **nuevo** en cada llamada) |

### Posiciones fijas comunes

| Elemento | x | y | w / h | Notas |
|---|---|---|---|---|
| Breadcrumb (slides interiores) | `M` | 0.30 | 9.4 × 0.32 | Lato 9 pt bold, MAYÚSCULAS, `charSpacing: 1.2`; parte 1 en `gray5`/`mutDark`, parte 2 en `electric`/`sand` |
| Logo BBVA interior | `PW − M − 1.05` | 0.33 | w 1.05 | h = w × 160/524 |
| Logo BBVA en índice/separadores | `M` (separador) o derecha (índice) | 0.34 | w 1.35 | separadores: logo a la **izquierda** |
| Logo BBVA portada | `PW − M − 1.7` | 0.42 | w 1.7 | |
| Logo BBVA cierre | centrado | 2.5 | w 2.6 | |
| Caption de pie | `M` | 7.06 | 7.6 × 0.26 | Lato 8 pt, `gray5`/`mutDark` |
| Logo NFQ pie | 11.40 | 7.105 | h 0.17 | w = h × 254/120 |
| Paginador `p. NN / total` | 11.86 | 7.06 | 0.92 × 0.26 | alineado a la derecha |
| Crédito "HECHO POR" + NFQ (portada) | 10.9 / 12.02 | 6.96 | h 0.33 | portada: a la derecha del pie; cierre: centrado en y 6.35 |
| Zona de contenido | | 1.0 → 6.85 | | el pie empieza en 7.06 |

### Escala tipográfica

| Elemento | Fuente | Tamaño |
|---|---|---|
| Hero (portada / separadores) | Source Serif 4 bold | 44–46 pt, `lineSpacingMultiple: 0.98–1.0` |
| H1 de slide interior | Source Serif 4 bold | 25–30 pt |
| Cifra grande (storage / KPI) | Source Serif 4 bold | 40 pt / 23 pt |
| H3 de tarjeta | Source Serif 4 bold | 13.5–15.5 pt |
| Cuerpo en tarjetas / tabla | Lato | 9.5–10.5 pt, `lineSpacingMultiple: 1.16–1.25` |
| Lead de portada / separadores | Lato | 11.5–12.5 pt |
| Ante-título, kicker, etiqueta de tier | Lato bold MAYÚSCULAS | 8.5–10.5 pt, `charSpacing: 1.2–1.8` |
| Chip / píldora | Lato bold MAYÚSCULAS | 7–8.5 pt, `charSpacing: 1` |
| Breadcrumb, pie, paginador | Lato | 8–9 pt |

Deja ~10 % de holgura vertical en cada caja de texto: el render de QA es fiel con las fuentes instaladas, pero PowerPoint y LibreOffice no parten líneas exactamente igual.

---

## 🔁 3. Equivalencias HTML → PPTX

| HTML / CSS del sistema | Construcción pptxgenjs |
|---|---|
| `<section class="slide bbva-combo--X">` | `s.background = { color: C.x }` + cabecera y pie de la tabla anterior |
| `.breadcrumb` con dos `<span>` | un `addText` con dos runs (ver `headerContent`) |
| `.ante-title` | `addText` MAYÚSCULAS, Lato bold, `charSpacing` |
| `h1` / `.bbva-hero` con `<br>` | `addText` con `\n` dentro del string |
| `<em>` en titular | run `{ italic: true }` dentro del array de runs |
| `.chip`, `.layer-chip`, `.tier__label` de píldora | `roundRect` con `rectRadius: h/2` + `addText` `wrap:false` (helper `chip`) |
| `.tier`, `.section-index__item`, `.acc-card` (fondo acento) | `roundRect` relleno acento, **sin sombra**, texto `electric` |
| `.phase`, `.storage-card`, `.dev-card`, `.feature`, `.objective` (blancas) | `roundRect` relleno `white` + sombra `sh()` |
| `.dev-card__dot` | `ellipse` 0.52 relleno acento + icono 0.3 centrado |
| `.rail__arrow` (icono `advance`) | `addImage` 0.28 centrado en el hueco entre tarjetas (`gap 0.42`) |
| `.bbva-list` (`<ul>`) | helper `bulletRuns` (viñeta literal, ver §5) |
| `<b>` / `<i>` / `.code` | runs `{bold}` / `{italic}` / `{bold}` (el `.code` pierde el fondo; se mantiene la negrita) |
| `.muted` | run `{ color: C.gray5 }` |
| `.bbva-table` | **tabla manual**: rect blanco con sombra + rect `gray2` de cabecera + `line` `gray3` 0.75 pt entre filas + `addText` por celda (permite chips dentro) |
| `.critical-note` | `roundRect` Canary 0.74 alto + icono 0.36 + texto `valign:"middle"` |
| `.kpi` | `roundRect` relleno = color de fondo, borde `serene` 0.75 pt, cifra `serene`, etiqueta `sand` |
| `.nfq-credit` "Hecho por" | `addText` "HECHO POR" (`mutDark`, `align:"right"`) + `nfqLogo` |
| Iconos `filter: invert` sobre fondo oscuro | PNG blanco pregenerado (§0); dentro de cajas de acento se quedan en Electric |
| `.pager` | texto `p. NN / total` en el pie (portada y cierre no llevan) |

### Recetas de geometría por tipo de slide (valores probados)

- **Portada (Electric)**: ante-título y 1.95; hero 46 pt y 2.3 (h 2.35, hasta 3 líneas); lead y 4.82 w 7.7; fila de chips con icono y 6.0 (h 0.34, separación 0.22); pie con caption + "HECHO POR" + NFQ h 0.33.
- **Índice (Midnight)**: H1 30 pt y 1.3; 4 cajas de acento `serene/lime/canary/mandarin` y 2.3, h 3.85, `w = (CW − 3·0.28)/4`; dentro: etiqueta 8.5 pt (+0.26), título 15.5 pt (+0.6), descripción 10.5 pt (+1.62). Padding 0.24.
- **Separador (Serene o Electric)**: logo BBVA w 1.35 **a la izquierda** (y 0.34); ante-título y 2.55; hero 44 pt y 2.92 (2 líneas); descripción 12.5 pt y 4.85 w 8.4.
- **Modelo / 3 tiers (Sand)**: ante-título y 1.06, H1 29 pt y 1.34; tiers `mandarin/canary/ice` y 2.12 h 2.78 `w = (CW − 2·0.28)/3`; dentro: etiqueta (+0.22), icono 0.5 (+0.54), h3 15 pt (+1.14), cuerpo 9.8 pt (+1.52); dos "objetivos" blancos y 5.18 h 0.56; nota 9.5 pt y 6.02.
- **Raíl de fases (Sand)**: H1 26 pt y 1.08; tarjetas blancas y 2.3 h 3.6, `w = (CW − (n−1)·0.42)/n` (n = 3 o 4); dentro: chip 7 pt (+0.2), icono 0.42 (+0.6), h3 13.5 pt (+1.12), viñetas 9.5 pt desde +1.52; flecha `advance` 0.28 en cada hueco a media altura.
- **Tabla de 3 capas (Sand)**: H1 y 1.06, subtítulo 10.5 pt y 1.62; tabla y 2.14, columnas x `M / M+1.5 / M+3.95 / M+8.45`, cabecera h 0.4, filas 0.78 / 0.96 / 1.06, padding de celda 0.24/0.12, texto 9.5 pt; nota crítica 0.3 por debajo, h 0.74.
- **Dos columnas Oracle (Sand)**: izquierda w 5.9 con dos tarjetas blancas h 2.14 (y 1.9 y 4.34: chip, cifra 40 pt en +0.6, cuerpo 10 pt en +1.42); derecha desde x 6.75: h3 15.5 pt y 2.0 + 3 filas blancas h 1.02 cada 1.24 con icono 0.4 y texto centrado verticalmente.
- **5 tarjetas de acento Epsilon (Midnight)**: fila superior 3 tarjetas `w3 = (CW − 2·0.26)/3`, inferior 2 tarjetas `w2 = (CW − 0.26)/2`; h 2.32, y 1.72 y 4.3; colores `serene/lime/canary/mandarin/purple`; dentro: icono 0.42 (+0.24), kicker 8 pt (+0.76), h3 15 pt (+1.02), cuerpo 9.5 pt (+1.4).
- **Grid 2×2 desarrollo (Sand)**: H1 y 1.0; tarjetas blancas `w = (CW − 0.3)/2`, h 2.34, y 1.74 y 4.38; dot 0.52 con icono 0.3 + h3 14.5 pt a su derecha; viñetas 9.5 pt desde +0.94.
- **KPIs 5×2 (Electric)**: tiles `w = (CW − 4·0.24)/5`, h 2.0, y 1.98 y 4.28; cifra 23 pt `serene` (+0.22), etiqueta 8.5 pt `sand` (+0.84).
- **Cierre (Electric)**: BBVA w 2.6 centrado y 2.5; título 12 pt MAYÚSCULAS `sand` y 3.75 centrado; subtítulo 9.5 pt `mutDark` y 4.12; "HECHO POR" + NFQ h 0.34 centrados en y 6.35.

Nada de esto es obligatorio salvo la coherencia: adapta alturas al contenido real y recentra el bloque en la zona 1.0 → 6.85. Evita tarjetas con más del 35–40 % vacío por abajo.

---

## 🧩 4. Kit de helpers (copiar tal cual en `gen_pptx.js`)

```js
const pptxgen = require("pptxgenjs");
const p = new pptxgen();
p.layout = "LAYOUT_WIDE";
p.title = "<título>"; p.company = "BBVA · NFQ"; p.author = "NFQ";

const PW = 13.333, M = 0.55, CW = PW - 2 * M;
const AR_BBVA = 160 / 524, AR_NFQ = 120 / 254;
const TOTAL = 15; // nº de slides, para el paginador

const sh = () => ({ type: "outer", color: C.electric, opacity: 0.12, blur: 8, offset: 2, angle: 90 });
const icon = (n) => `icons/${n}.png`;

// Runs de texto enriquecido
const t  = (s, o) => ({ text: s, options: o || {} });
const b  = (s) => t(s, { bold: true });
const it = (s) => t(s, { italic: true });
const cd = (s) => t(s, { bold: true });          // .code
const mut = (s) => t(s, { color: C.gray5 });     // .muted
const runsPara = (runs, base) => runs.map((r) => ({ text: r.text, options: Object.assign({}, base, r.options) }));

// Viñetas con formato interno (ver §5): viñeta literal, breakLine solo al cerrar cada ítem,
// y el espaciado (paraSpaceAfter / lineSpacingMultiple) va en las opciones de addText, no en los runs.
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

// Logos
function bbvaLogo(s, { white = false, x, y, w }) {
  s.addImage({ path: `assets/bbva_${white ? "white" : "blue"}.png`, x, y, w, h: w * AR_BBVA });
}
function nfqLogo(s, { white = false, x, y, h }) {
  s.addImage({ path: `assets/nfq_${white ? "white" : "black"}.png`, x, y, h, w: h / AR_NFQ });
}

// Cabecera de slide interior (breadcrumb + BBVA a la derecha)
function headerContent(s, { dark = false, crumb1, crumb2 }) {
  s.addText([
    t(crumb1.toUpperCase(), { color: dark ? C.mutDark : C.gray5 }),
    t("   " + crumb2.toUpperCase(), { color: dark ? C.sand : C.electric }),
  ], { x: M, y: 0.3, w: 9.4, h: 0.32, fontFace: FB, fontSize: 9, bold: true, charSpacing: 1.2, valign: "middle", margin: 0 });
  bbvaLogo(s, { white: dark, x: PW - M - 1.05, y: 0.33, w: 1.05 });
}
// Cabecera de separador (solo logo, a la izquierda)
function headerSep(s, { dark = false }) { bbvaLogo(s, { white: dark, x: M, y: 0.34, w: 1.35 }); }

// Pie estándar: caption + NFQ pequeño + paginador
function footerStd(s, { dark = false, left, page }) {
  const col = dark ? C.mutDark : C.gray5;
  s.addText(left, { x: M, y: 7.06, w: 7.6, h: 0.26, fontFace: FB, fontSize: 8, color: col, valign: "middle", margin: 0 });
  nfqLogo(s, { white: dark, x: 11.4, y: 7.105, h: 0.17 });
  s.addText(`p. ${String(page).padStart(2, "0")} / ${TOTAL}`, { x: 11.86, y: 7.06, w: 0.92, h: 0.26, fontFace: FB, fontSize: 8, color: col, align: "right", valign: "middle", margin: 0 });
}

// Chip / píldora. Devuelve el ancho usado para encadenar varios.
function chipW(text, fs, hasIcon) { return 0.24 + text.length * (fs * 0.585 / 72 + 0.0138) + (hasIcon ? 0.32 : 0); }
function chip(s, { x, y, text, fill, ic, fs = 8, h = 0.3 }) {
  const w = chipW(text, fs, !!ic);
  s.addShape(p.ShapeType.roundRect, { x, y, w, h, fill: { color: fill }, rectRadius: h / 2, line: { type: "none" } });
  if (ic) s.addImage({ path: icon(ic), x: x + 0.13, y: y + (h - 0.19) / 2, w: 0.19, h: 0.19 });
  s.addText(text.toUpperCase(), { x: x + (ic ? 0.38 : 0.13), y, w: w - (ic ? 0.44 : 0.2), h,
    fontFace: FB, fontSize: fs, bold: true, color: C.electric, charSpacing: 1, valign: "middle", margin: 0, wrap: false });
  return w;
}

// Separador de bloque (Serene → dark:false · Electric → dark:true)
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

// Uso de viñetas dentro de una tarjeta blanca:
// s.addText(bulletRuns([[t("Tablas "), b("particionadas por día"), t(" en Oracle.")], [t("…")]]),
//   { x, y, w, h, fontFace: FB, fontSize: 9.5, color: C.electric, paraSpaceAfter: 5, lineSpacingMultiple: 1.16, margin: 0, valign: "top" });

// Al final:
p.writeFile({ fileName: "presentacion.pptx" }).then(() => console.log("OK"));
```

Cada slide: `const s = p.addSlide(); s.background = {...}; header…; contenido; footer…; s.addNotes("…")`. Un `new pptxgen()` por archivo.

---

## ⚠️ 5. Trampas de pptxgenjs verificadas en este proyecto

1. **Viñetas con formato mixto**: la opción `bullet: true` **no sirve** cuando un ítem tiene varios runs (negrita + normal). Si se pone solo en el primer run, el marcador no se pinta; si se pone en todos (o en el último), cada run se convierte en un párrafo con su propia viñeta. Patrón fiable = `bulletRuns` del kit: run literal `"•  "` al inicio de cada ítem, **sin** opción `bullet`, `breakLine: true` solo en el último run de cada ítem, y `paraSpaceAfter` / `lineSpacingMultiple` en las opciones de `addText` (nivel caja). Las líneas de continuación alinean al borde de la caja (sin sangría francesa): aceptado. `bullet: true` solo es válido con ítems de un único run.
2. **Opciones de párrafo en runs intermedios** (`paraSpaceAfter`, `lineSpacingMultiple`, `bullet`, `align`) parten el párrafo. Ponlas a nivel de caja.
3. **HEX sin `#` y sin alfa**. Transparencias: `transparency: 0-100` en fills/imagenes, `opacity: 0-1` en sombras.
4. **Sombra: objeto nuevo en cada llamada** (`sh()`): pptxgenjs muta el objeto y reutilizarlo corrompe posiciones.
5. **`rectRadius` solo en `roundRect`**; `margin: 0` en cualquier texto que deba alinear con una forma o icono.
6. **Chips**: el texto en mayúsculas es más ancho de lo que parece; usa `chipW` (calibrado para Lato bold + `charSpacing 1`) y `wrap: false` para que nunca salte de línea. Si un chip queda justo, súbele 0.1 al ancho.
7. **Sin degradados** (usar fondo plano de la paleta). **Sin bullet nativo + "•" literal a la vez** (viñeta doble).
8. **Tablas**: `addTable` no admite formas dentro de celdas ni control fino de chips; construye la tabla a mano (rectángulos + líneas + `addText` por celda) cuando el HTML lleva chips o cabecera coloreada.
9. **`LAYOUT_WIDE` antes de la primera slide**; coordenadas fuera del lienzo no dan error, simplemente no se ven.
10. **Notas del orador**: `s.addNotes("…")` una vez por slide; nunca texto oculto en la slide.
11. Tras `writeFile` ejecuta **siempre** `validate.py`. No edites el XML empaquetado a mano: corrige en el generador.

---

## 🔬 6. Flujo de trabajo y QA

1. **Contenido**: parte del documento fuente (ruta B) o del HTML (ruta A). Para la ruta A, vuelca cada `<section>` del HTML y extrae textos, runs (`<b>`, `<i>`, `.code`, `.muted`), chips, iconos y clases `nth-child` de color — el PPTX debe conservar **todos** los datos, cifras y nombres técnicos.
2. **Plan de slides**: lista numerada con combo de fondo por slide siguiendo el ritmo del sistema (portada Electric → índice Midnight → contenido Sand → separadores Serene/Electric alternos → cierre Electric). Mismo orden y mismo número de slides que el HTML si es una conversión.
3. **Generador**: `gen_pptx.js` con el kit de §4, un bloque por slide, notas del orador en todas.
4. **Build + validación**:
   ```bash
   node gen_pptx.js && python /mnt/skills/public/pptx/scripts/office/validate.py presentacion.pptx
   ```
5. **Chequeo de contenido**: `markitdown presentacion.pptx` → cuenta de slides, sin placeholders, y un chequeo de hechos con una lista de cadenas clave del documento (cifras, cuotas, nombres de tabla, comandos). Debe salir `missing: NONE`:
   ```python
   txt = open("deck.txt").read()
   facts = ["5 TB", "quota.ostSize", "DROP PARTITION", "trace_id", ...]
   print("missing:", [f for f in facts if f not in txt] or "NONE")
   ```
6. **QA visual** (con las fuentes instaladas):
   ```bash
   python /mnt/skills/public/pptx/scripts/office/soffice.py --headless --convert-to pdf presentacion.pptx
   rm -f slide-*.jpg && pdftoppm -jpeg -r 110 presentacion.pdf slide
   ```
   Mira **todas** las imágenes y comprueba: texto cortado o desbordado; viñetas presentes en todos los ítems; chips sin salto de línea; tarjetas con demasiado vacío inferior; solapes; logos correctos para cada fondo (RGB en claros, WHITE en oscuros); NFQ en todos los pies; texto Electric sobre acentos; contraste de iconos; paginador correcto.
7. **Corrige en el generador, regenera y vuelve a renderizar** solo lo que cambió. Repite el checklist de `AGENTS.md` ("Errores críticos a evitar") adaptado a pptx.
8. **Entrega**: copia el `.pptx` a la carpeta de salida y preséntalo. En el mensaje de cierre indica: nº de slides, fidelidad al origen (`missing: NONE`), fuentes de marca referenciadas (con sustitución automática si no están instaladas) y que incluye notas del orador. Si además existe el HTML, entrega ambos.

---

## 📎 7. Referencia

`08-ejemplo-gen-pptx.js` es el generador completo de la presentación "Sistema de telemetría y almacenamiento a largo plazo" (15 slides: portada, índice, modelo, 4 separadores, 2 raíles, tabla, Oracle, Epsilon, grid 2×2, KPIs, cierre). Todos los tipos de slide de §3 están implementados ahí con las medidas de las recetas; úsalo como punto de partida y sustituye textos, iconos y número de slides (`TOTAL`).
