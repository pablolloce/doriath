# 02 · Tipografía

Las fuentes son **Source Serif 4** (titulares) y **Lato** (todo lo demás). Son las que usa la plantilla oficial PPT de BBVA — open source, en Google Fonts. Para HTML web no hay que negociar esto.

## Cargar las fuentes

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,700;1,8..60,700&family=Lato:ital,wght@0,300;0,400;0,700;1,300;1,400;1,700&display=swap" rel="stylesheet">
```

Pesos cargados:
- Source Serif 4: 700 (Bold) + 700 italic
- Lato: 300 (Light), 400 (Regular), 700 (Bold), todos con italic

## Variables CSS

Ya están en `tokens.css`:
```css
--bbva-font-display: "Source Serif 4", Georgia, "Times New Roman", serif;
--bbva-font-body:    "Lato", "Helvetica Neue", Arial, sans-serif;
```

---

## Cuándo usar cada una

- **Source Serif 4 Bold** → titulares de slide (1, 2 o 3 líneas), cifras grandes destacadas, palabras clave en cajas de conclusión.
- **Lato** → todo el resto: antetítulos, cuerpo de texto, bullets, captions, botones, breadcrumbs, etiquetas, pies de página, datos en tablas.

**No mezcles** Source Serif y Lato en la misma línea o titular. Si quieres énfasis dentro de un titular Source Serif, usa la cursiva (700 italic), no cambies de fuente.

---

## Jerarquía orientativa

Estos tamaños son un punto de partida razonable para slides 16:9 (1920×1080). Puedes ajustarlos según el contenido de cada slide — un dato gigante puede ser más grande, un párrafo denso puede ser más pequeño. La idea es la **jerarquía relativa**, no los píxeles exactos.

| Nivel | Fuente | Peso | Rango fluido |
|---|---|---|---|
| Hero (portada) | Source Serif 4 | 700 | `clamp(72px, 7vw, 128px)` |
| H1 slide | Source Serif 4 | 700 | `clamp(40px, 4vw, 72px)` |
| H2 sección | Source Serif 4 | 700 | `clamp(28px, 2.5vw, 48px)` |
| H3 / subtítulo destacado | Source Serif 4 | 700 | `clamp(20px, 1.8vw, 32px)` |
| Lead / entradilla | Lato | 700 | `clamp(18px, 1.3vw, 24px)` |
| Cuerpo | Lato | 400 | `clamp(14px, 1vw, 18px)` |
| Caption / pie | Lato | 400 | `clamp(11px, 0.75vw, 14px)` |
| Breadcrumb / etiqueta UPPERCASE | Lato | 700 | `clamp(10px, 0.7vw, 12px)` con `letter-spacing: 0.05em` |

Estos están como `--bbva-fs-*` en `tokens.css`.

---

## Line-heights razonables

- Titulares grandes: 0.95 – 1.05
- Titulares medianos: 1.0 – 1.15
- Cuerpo: 1.4 – 1.6
- Botones / UI: 1.0 – 1.2

---

## Buenas prácticas

- Un titular Source Serif por slide. Si necesitas varios "titulares", probablemente sean H3 o leads.
- Titulares cortos: 1-3 líneas. Si no cabe en 3 líneas, fragmenta en antetítulo + título, o usa más slides.
- No subrayes texto (salvo enlaces).
- MAYÚSCULAS solo en etiquetas, breadcrumbs y badges cortos. No en titulares largos.
- Para destacar una palabra dentro de un titular: cursiva Source Serif Bold Italic.

---

## Tono editorial

Las presentaciones no son anuncios. Frases declarativas, datos concretos, claridad. Evita signos de exclamación, mayúsculas enfáticas y emoji decorativos. El tono lo da Source Serif: serio sin ser frío, cercano sin ser informal.
