# 01 · Color

## Paleta primaria

| Nombre | HEX | Uso típico |
|---|---|---|
| **Electric Blue** | `#001391` | Color de marca principal. Texto sobre fondos claros, fondo de portadas y cierres, elementos destacados. |
| **Serene Blue** | `#85C8FF` | Acento principal de la paleta. Fondos secundarios, gráficos, separadores, cajas de conclusión. |

Electric Blue está en *todas* las presentaciones — al menos como color de texto principal sobre fondos claros, o como fondo de la portada/contraportada.

## Escala de grises

| Nombre | HEX | Uso |
|---|---|---|
| White | `#FFFFFF` | Solo digital, alto contraste, cajas blancas sobre fondos azules. |
| **Sand** | `#F7F8F8` | Fondo claro recomendado para slides de contenido. |
| Gray 2 | `#E2E6EA` | Bordes, separadores suaves, fondos de tabla. |
| Gray 3 | `#CAD1D8` | Bordes, fondos UI. |
| Gray 4 | `#ADB8C2` | Textos secundarios, deshabilitados. |
| Gray 5 | `#46536D` | Texto medio sobre fondo Sand. |
| **Midnight** | `#070E46` | Texto principal cuando se busca menos contraste que Electric Blue. |
| Deep | `#000519` | Reservado. Texto crítico o fondos muy oscuros. |

> **El negro puro `#000000` no se usa nunca.** Para cualquier texto oscuro tienes Midnight, Deep o Electric Blue.

## Acentos

Para subrayar datos, separar bloques, dar variedad. Sin abusar — la presentación no es un caleidoscopio.

| Nombre | HEX |
|---|---|
| Canary | `#FFE761` |
| Lime | `#88E783` |
| Ice (también llamado Aqua) | `#8BE1E9` |
| Purple | `#9694FF` |
| Mandarin | `#FFB56B` |

**Regla útil**: cuando uses un acento como **fondo** (de una caja, de un sticker, de una etiqueta), el texto encima va en **Electric Blue** `#001391`. Sobre fondos acento no funciona ni blanco ni Midnight.

---

## 🎨 Las 4 combinaciones de fondo

Para mantener coherencia, las slides usan uno de estos cuatro fondos dominantes. Dentro de cada combinación tienes el color de texto y el acento principal "naturales".

### A · Sand (recomendada para contenido)
- Fondo: `#F7F8F8`
- Texto principal: `#001391` (Electric Blue)
- Acento natural: `#85C8FF` (Serene)
- Logo BBVA: versión color (`BBVA_RGB.png`)

### B · Serene
- Fondo: `#85C8FF`
- Texto principal: `#001391` (Electric Blue)
- Acento natural: blanco / Sand
- Logo BBVA: versión color (`BBVA_RGB.png`)

### C · Electric (recomendada para portadas)
- Fondo: `#001391`
- Texto principal: `#F7F8F8` (Sand) o blanco
- Acento natural: `#85C8FF` (Serene)
- Logo BBVA: versión blanca (`BBVA_WHITE.png`)

### D · Midnight
- Fondo: `#070E46`
- Texto principal: Sand / blanco
- Acento natural: `#85C8FF` (Serene)
- Logo BBVA: versión blanca (`BBVA_WHITE.png`)

> Puedes alternar combinaciones entre slides para dar ritmo a la presentación. No es obligatorio quedarse en una sola.

---

## ❌ Combinaciones a evitar

Por contraste insuficiente:
- Texto Serene sobre fondo Sand
- Texto Sand sobre fondo Serene
- Texto Serene sobre fondo Midnight

## ✅ Patrón a usar para texto sobre fotografía

No apliques `opacity`, `filter: brightness()` ni gradientes oscuros sobre la imagen. Pon una **caja sólida** (con el fondo de la combinación que estés usando) encima de la foto, con el texto dentro. Patrón "Doble Bentō" — ver `07-patrones.md`.
