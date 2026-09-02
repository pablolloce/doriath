# 06 · Co-branding BBVA + NFQ

Las presentaciones que NFQ produce para BBVA llevan **ambos logos**, con una jerarquía clara:

**BBVA = cliente (primario)** · **NFQ = consultora autora (secundario)**

Es la convención habitual de presentaciones cliente / consultora.

---

## Logos disponibles

En `./docs/visual/logos/`:

| Archivo | Qué es | Usar sobre fondo… |
|---|---|---|
| `BBVA_RGB.png` | BBVA en azul Electric | claro (Sand, Serene) |
| `BBVA_WHITE.png` | BBVA en blanco | azul/oscuro (Electric, Midnight) |
| `Nfq__Black.png` | NFQ con isotipo color + "nfq" en negro | claro |
| `Nfq__White.png` | NFQ con isotipo color + "nfq" en blanco | azul/oscuro |
| `Isotipo__Nfq__Color.png` | Solo el isotipo "N" en gradiente | uso reducido (favicons, watermarks) |

El isotipo NFQ (el gradiente naranja-rosa-azul) **siempre conserva sus colores** — eso forma parte de la marca NFQ. Solo cambia el color del texto "nfq" según el fondo.

---

## Dónde aparece cada logo

| Tipo de slide | BBVA | NFQ |
|---|---|---|
| Portada | sí, prominente | sí, en pie con "Hecho por" |
| Interior estándar | sí, esquina superior | opcional, en pie pequeño |
| Doble Bentō / foto a sangre | sí, en la caja sólida superpuesta | normalmente no |
| Contraportada | sí, centrado | sí, en pie con "Hecho por" |

Lo importante:
- **Logo BBVA presente en todas las slides interiores** (salvo separadores muy minimalistas si encajan en la narrativa).
- **Logo NFQ en portada y contraportada como mínimo.**
- **El logo NFQ nunca es más grande que el BBVA** en una misma slide.

---

## Versión correcta según combinación

```html
<!-- Combinación A (Sand) y B (Serene) -->
<img src="./docs/visual/logos/BBVA_RGB.png" alt="BBVA" class="bbva-logo">
<img src="./docs/visual/logos/Nfq__Black.png" alt="NFQ" class="nfq-logo">

<!-- Combinación C (Electric) y D (Midnight) -->
<img src="./docs/visual/logos/BBVA_WHITE.png" alt="BBVA" class="bbva-logo">
<img src="./docs/visual/logos/Nfq__White.png" alt="NFQ" class="nfq-logo">
```

Las clases `.bbva-logo` y `.nfq-logo` están en `tokens.css` con tamaños razonables. Si necesitas cambiar tamaño puntualmente, usa `.bbva-logo--lg`, `.bbva-logo--sm` o un `height` inline.

---

## Patrón de crédito NFQ

Texto pequeño "Hecho por" + logo NFQ:

```html
<div class="nfq-credit">
  <span class="nfq-credit__label">Hecho por</span>
  <img src="./docs/visual/logos/Nfq__White.png" alt="NFQ" class="nfq-logo">
</div>
```

Otras variantes válidas: "Una presentación de", "Producido por", "Diseñado por", o simplemente el logo solo si el contexto lo deja claro. La etiqueta no es obligatoria — el logo solo también es aceptable.

---

## Lo que no hacer

- Mezclar logos al mismo tamaño en horizontal como si fuera un partnership entre iguales.
- Modificar el isotipo NFQ (sus colores forman parte de la identidad).
- Apoyar el logo NFQ directamente sobre fotografía sin caja contenedora.
- Usar logo BBVA en color sobre fondo azul (no se ve).
