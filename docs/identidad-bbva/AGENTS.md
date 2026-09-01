# BBVA × NFQ — Guía para presentaciones HTML y PPTX

Guía de identidad visual para presentaciones que NFQ produce para BBVA, en HTML o en PowerPoint. Pensada para que un agente (Copilot CLI, Claude Code, Cursor) tenga **bases claras** pero **libertad creativa** para componer cada diapositiva.

> ⚠️ Esto NO es el manual oficial completo de BBVA. Es un subset adaptado a presentaciones internas/de cliente. No vamos a diseñar carteles, packaging ni anuncios oficiales — solo presentaciones.

---

## 🎯 Principios (no recetas)

1. **Reconocible como BBVA**: si alguien hace zoom out al 30%, debe verse BBVA por color y tipografía. La paleta y las fuentes están fijas; el resto se puede componer.
2. **Sobrio y editorial**: las presentaciones son herramientas de comunicación, no piezas publicitarias. Aire, jerarquía clara, mejor pocas cosas grandes que muchas pequeñas.
3. **Sistema modular**: cajas redondeadas, retícula múltiplo de 8, layouts limpios. Bentō es una guía mental, no una jaula.
4. **BBVA primario, NFQ autoría**: ambos logos presentes con jerarquía cliente > consultora.

---

## 📁 Estructura sugerida

```
docs/
├── visual-brand/                ← estos archivos
│   ├── AGENTS.md                ← empezar aquí
│   ├── 01-color.md
│   ├── 02-tipografia.md
│   ├── 03-layout.md
│   ├── 04-componentes.md
│   ├── 05-iconografia.md
│   ├── 06-co-branding-nfq.md
│   ├── 07-patrones.md           ← patrones de inspiración (no obligatorios)
│   ├── 08-pptx.md               ← generar la presentación como PowerPoint (conversión o directa)
│   ├── 08-ejemplo-gen-pptx.js   ← generador pptxgenjs de referencia, ejecutable
│   ├── tokens.css               ← variables CSS listas
│   ├── tokens.json              ← mismos tokens en JSON
│   └── template.html            ← punto de partida
└── visual/
    ├── icons/SVG/               ← 171 iconos SVG oficiales BBVA (en Electric Blue)
    └── logos/
        ├── BBVA_RGB.png         ← BBVA azul (fondos claros: Sand, Serene)
        ├── BBVA_WHITE.png       ← BBVA blanco (fondos oscuros: Electric, Midnight)
        ├── Nfq - Black.png      ← NFQ negro+isotipo color (fondos claros)
        ├── Nfq - White.png      ← NFQ blanco+isotipo color (fondos oscuros)
        └── Isotipo - Nfq - Color.png
```

---

## 🚦 Reglas duras (esto sí o sí)

Lista corta. Todo lo demás es interpretable.

1. **Negro puro `#000000` prohibido**. Para texto oscuro usa `#070E46` (Midnight).
2. **Fondos**: usa Sand (`#F7F8F8`), Serene (`#85C8FF`), Electric (`#001391`) o Midnight (`#070E46`) como fondo dominante. Sobre acentos como fondo, el texto va en Electric Blue.
3. **Tipografía**: Source Serif 4 (titulares) + Lato (todo lo demás). Importadas desde Google Fonts.
4. **Logo BBVA presente** en todas las slides interiores (en color o blanco según el fondo).
5. **Logo NFQ** en **todas** las slides: prominente en portada y contraportada ("Hecho por"), pequeño en pie de página en el resto. Más pequeño que el de BBVA.
6. **Iconos**: solo de `./docs/visual/icons/SVG/` (lista en `05-iconografia.md`). No inventes ni mezcles librerías. Los iconos van siempre en **Electric Blue (`#001391`)** sobre fondos claros. Sobre fondos azules (Electric, Midnight) se invierten a blanco con `filter: brightness(0) invert(1)` (ya incluido en `tokens.css` para `.bbva-combo--electric` y `.bbva-combo--midnight`).
7. **Sobre fotografía**, nunca uses opacity/velado para legibilidad: pon una caja sólida encima.
8. **Presentaciones stand-alone**: los archivos HTML generados deben ser **autocontenidos** — no depender de rutas relativas al repositorio. Al crear o finalizar una presentación:
   - Inlinea `tokens.css` como `<style>` en el `<head>` (en lugar de `<link rel="stylesheet">`)
   - Convierte todos los logos PNG a **data URIs base64** (`src="data:image/png;base64,..."`)
   - Inlinea los iconos SVG como `<svg>` directo en el HTML (con `fill="#001391"` para Electric Blue)
   - Mantén Google Fonts cargado vía CDN (excepción aceptable: requiere internet, usar fallbacks tipográficos)
   - Usa `scripts/make-standalone.mjs` como referencia o punto de partida para el proceso de embedding
9. **Texto sobre fondos de acento** (Canary, Lime, Aqua/Ice, Purple, Mandarin, Serene): **siempre Electric Blue `#001391`**. Nunca blanco, nunca Sand, nunca Midnight. Esto aplica a cualquier caja, tarjeta o elemento cuyo fondo sea un color acento.
10. **Texto sobre fondos claros** (Sand, Serene): los colores de texto deben ser oscuros — Electric Blue o Midnight. No usar `var(--bbva-sand)` para texto en slides de fondo Sand: se vuelve invisible. En slides `bbva-combo--sand` / `bbva-combo--serene`, los títulos internos deben usar `color: var(--bbva-electric-blue)`.
11. **Nth-child CSS**: cuando asignes colores de fondo a N tarjetas/items mediante `:nth-child`, define **explícitamente** los N selectores. Dejar un item sin background en un slide oscuro lo hace invisible. Comprueba que el número de reglas `nth-child` coincide exactamente con el número de elementos en el HTML.

---

## ❌ Errores críticos a evitar (checklist final antes de entregar)

Antes de guardar el HTML, verifica:

- [ ] Cada slide oscuro (Midnight, Electric): textos principales en Sand o Serene-blue. Sin text blanco hardcodeado.
- [ ] Cada slide claro (Sand, Serene): textos en Electric Blue o Midnight. `var(--bbva-sand)` en texto = invisible sobre Sand.
- [ ] Cajas con fondo de acento → texto Electric Blue. Nunca blanco.
- [ ] Si hay N tarjetas con `:nth-child` → ¿hay N reglas definidas? ¿Ninguna queda sin fondo?
- [ ] Logo NFQ en **footer de todas las slides** (pequeño, `height: 18–24px`). ¿Presente en todas?
- [ ] Logo BBVA en header de todas las slides interiores. ¿Versión correcta (RGB en claros, WHITE en oscuros)?
- [ ] Iconos: todos inline SVG con `fill="#001391"` (o invertidos si el combo es Electric/Midnight).

---

## 🎨 Lo que sí puedes decidir libremente

- El **layout específico** de cada slide: composiciones a 1, 2, 3 o 4 columnas, asimétricas, con o sin cajas, con o sin imagen lateral, en grid o en flex.
- Las **proporciones exactas** dentro de la retícula múltiplo de 8.
- El **ritmo** de la presentación: cuándo cambias de combinación de color para refrescar la atención.
- **Cuándo usar acentos** (Canary, Lime, Ice, Purple, Mandarin) para subrayar datos, KPIs, listas, separadores.
- La **estructura semántica HTML** (más o menos `<section>`, `<article>`, `<aside>` según convenga).
- Si añades **animaciones, transiciones o navegación con teclado** (no obligatorio).
- Cómo **organizar el contenido** en cada slide: bullet points, párrafos cortos, callouts, tablas.

---

## 📚 Mapa de archivos

| Archivo | Para qué |
|---|---|
| `01-color.md` | Paleta completa y las 4 combinaciones de fondo permitidas. |
| `02-tipografia.md` | Fuentes, jerarquía y reglas básicas. |
| `03-layout.md` | Retícula 8px, márgenes y formato 16:9. Orientativo. |
| `04-componentes.md` | Botones, cajas, listas, UI stickers. Patrones reutilizables. |
| `05-iconografia.md` | Catálogo completo de 171 iconos disponibles. |
| `06-co-branding-nfq.md` | Cómo combinar logo BBVA + logo NFQ. |
| `07-patrones.md` | Ideas de diapositivas (portada, índice, doble Bentō…). Inspiración. |
| `08-pptx.md` | Cómo entregar la presentación como PowerPoint: conversión HTML → PPTX o creación directa con pptxgenjs. Tokens, geometría, kit de helpers y QA. |
| `08-ejemplo-gen-pptx.js` | Generador pptxgenjs de referencia (15 slides, todos los tipos de layout). |
| `tokens.css` | Variables CSS listas: `--bbva-*`, `--combo-*`, etc. |
| `tokens.json` | Mismos tokens en JSON (para herramientas). |
| `template.html` | Esqueleto HTML con fuentes cargadas y 3-4 slides de ejemplo. |

---

## 💡 Cómo trabajar con esto

Cuando se te pida una presentación:

1. Lee `01-color.md` y `02-tipografia.md` (paleta y fuentes son lo único innegociable visualmente).
2. Importa `tokens.css` y usa esas variables. No inventes HEX nuevos.
3. Toma `template.html` como punto de partida si lo necesitas; si no, parte de cero usando los tokens.
4. Si tienes dudas sobre un layout concreto, `07-patrones.md` tiene ejemplos para inspirarte (no son los únicos válidos).
5. Antes de cerrar, ejecuta el **checklist final** (sección "Errores críticos a evitar" arriba). En especial: nth-child completos, texto sobre acento en Electric Blue, NFQ en todas las slides, BBVA logo correcto para cada fondo.
6. **Al finalizar**, convierte el HTML a **stand-alone** (regla #8): inlinea tokens.css, convierte logos a base64, inlinea SVGs con `fill="#001391"`. El archivo entregado debe poder abrirse en cualquier equipo sin el repositorio.
7. Si se pide la presentación **en PPTX** —desde el inicio o como conversión de un HTML ya hecho—, sigue `08-pptx.md` en vez de los pasos 1-6: misma paleta, misma tipografía, mismo co-branding y el mismo checklist de errores críticos, pero con pptxgenjs, la validación OOXML y el QA visual descritos ahí. `08-ejemplo-gen-pptx.js` es el punto de partida.

Eso es todo. El resto es diseño.

---

## 🛠️ Herramientas de soporte

| Script | Uso |
|---|---|
| `scripts/make-standalone.mjs` | Convierte una presentación HTML a stand-alone: inlinea tokens.css, logos (base64) e iconos SVG con Electric Blue. Edita las rutas al inicio y ejecuta con `node scripts/make-standalone.mjs`. |
