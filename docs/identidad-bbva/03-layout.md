# 03 · Layout

Formato base: **16:9** (1920×1080 px o equivalente fluido con `aspect-ratio: 16/9`).

## Retícula

Todo en múltiplos de 8 px. Es un sistema mental, no una jaula: te ayuda a que distintas slides se vean coherentes sin esfuerzo. Pero **no es necesario** medir cada elemento al píxel — basta con que paddings, gaps y radios sigan esta unidad.

```css
--bbva-grid-unit: 8px;
/* espaciado disponible en tokens.css */
--bbva-space-1: 8px;   --bbva-space-5: 40px;
--bbva-space-2: 16px;  --bbva-space-6: 48px;
--bbva-space-3: 24px;  --bbva-space-7: 56px;
--bbva-space-4: 32px;  --bbva-space-8: 64px;
```

## Radios de las cajas

Múltiplos de 4. Los más útiles:
- 8 px → cajas pequeñas, badges, etiquetas
- 16 px → cajas de contenido pequeñas (UI bubbles, callouts)
- 24 px → cajas Bentō grandes, imágenes contenedoras (uso habitual)
- 32 px → cajas hero muy grandes
- `9999px` → píldoras y botones tipo CTA

## Márgenes de slide

Un margen exterior generoso ayuda a que la slide respire. Una buena base es **64 px** para 1920×1080, pero puedes subirlo a 80 px o bajarlo a 48 px según el contenido.

## Composición libre

No hay un layout "oficial". Lo que sí ayuda mantener:

- **Un titular por slide**.
- **Logo BBVA visible** (esquina superior, normalmente).
- **Pie con número de página** (esquina inferior derecha, opcional pero recomendado).
- **Aire**: si dudas, deja más espacio del que te pide el cuerpo.

A partir de ahí, libertad total: una columna, dos, tres, asimétrico, una micro a un lado, un dato gigante centrado, una tabla a sangre… lo que necesite la historia de la slide.

## Estructura semántica sugerida

```html
<section class="slide bbva-combo--sand">
  <header class="slide__header">
    <!-- breadcrumb opcional + logo BBVA -->
  </header>

  <main class="slide__main">
    <!-- contenido de la slide -->
  </main>

  <footer class="slide__footer">
    <!-- caption + pager -->
  </footer>
</section>
```

Pero `<section>` directa con grid CSS también vale. Lo importante es que sea legible para humanos que mantengan el código y para lectores de pantalla.

## Algunas decisiones que da el sistema

- `tokens.css` define `.slide { padding: 64px; min-height: 100vh; … }` como base, y `.bbva-combo--*` para pintar fondo + texto.
- A partir de ahí, tu CSS específico de la presentación define el grid interno de cada slide según necesite.

## Print / export

Para que la presentación se exporte bien a PDF:

```css
@media print {
  @page { size: 1920px 1080px; margin: 0; }
  .slide { page-break-after: always; height: 1080px; }
}
```
