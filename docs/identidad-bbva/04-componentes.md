# 04 · Componentes

Patrones reutilizables que vienen ya en `tokens.css`. No tienes que usarlos todos, ni hacerlos exactamente igual: son una base.

## Botón / CTA

Píldora con fondo de acento, texto Electric Blue.

```html
<a class="cta" href="#">Calcula tu cuota</a>
```

CTA "block" (botón ancho centrado, útil como conclusión):
```html
<a class="cta cta--block" href="#">Espacio para conclusión</a>
```

## Cajas Bentō genéricas

Cajas redondeadas con padding y radio coherentes:

```html
<div class="bento__box">
  <h2>Título</h2>
  <p>Contenido…</p>
</div>
```

Con imagen a sangre:
```html
<figure class="bento__box bento__box--visual">
  <img src="./docs/visual/photos/persona.jpg" alt="...">
</figure>
```

## Doble Bentō (texto sobre imagen)

Para citas o frases destacadas sobre fotografía, sin opacity:

```html
<section class="slide double-bento bbva-combo--electric">
  <figure class="double-bento__bg">
    <img src="./docs/visual/photos/foto.jpg" alt="">
  </figure>
  <article class="double-bento__overlay">
    <h2>La frase destacada va aquí</h2>
  </article>
</section>
```

## Breadcrumb

Texto pequeño en mayúsculas para indicar sección / subsección en la parte superior de la slide.

```html
<nav class="breadcrumb">
  <span>NOMBRE PRESENTACIÓN / SECCIÓN</span>
  <span class="breadcrumb__sub">SUBSECCIÓN</span>
</nav>
```

## Antetítulo

Línea pequeña encima del título principal:
```html
<p class="ante-title">Texto para el ante-título</p>
<h1 class="bento__title">Título principal</h1>
```

## Listas

Las listas con bullets usan círculos en el color de acento:
```html
<ul class="bbva-list">
  <li>Primer punto</li>
  <li>Segundo punto</li>
</ul>
```

(El estilo está en `tokens.css`. Si prefieres listas numeradas, en checkbox, o sin marcas, libre.)

## Caja de conclusión

Una caja Serene Blue con texto Source Serif para cerrar una idea:

```html
<aside class="conclusion__box">
  <p>Conclusión destacada. <em>Cursiva opcional para énfasis.</em></p>
</aside>
```

## UI stickers (opcionales)

Pequeños elementos para destacar datos sobre imágenes o microilustraciones. Tres tipos:

**Dot** (círculo simple, puede contener icono o palabra corta):
```html
<span class="bbva-sticker bbva-sticker--dot bbva-bg-canary">Online</span>
```

**Bubble** (dot + caja blanca con texto):
```html
<div class="bbva-sticker bbva-sticker--bubble">
  <div class="bbva-sticker__dot bbva-bg-lime">
    <img src="./docs/visual/icons/climateaction.svg" alt="">
  </div>
  <div class="bbva-sticker__text">
    <strong>Sostenible</strong>
    <span>Baja huella de carbono</span>
  </div>
</div>
```

**UI bubble** (caja con datos tipo app):
```html
<div class="bbva-sticker bbva-sticker--ui-bubble">
  <span>Primer año TIN</span>
  <span class="bbva-sticker__value">2,32 %</span>
</div>
```

Buenas prácticas con stickers:
- Colócalos sobre imágenes, ilustraciones o micros — quedan raros flotando en el vacío.
- Pocos por slide. 1-3 funciona, 5 ya es demasiado.
- El texto sobre fondos de acento siempre en Electric Blue.

## Color cards (4 ítems en colores acento)

Para resumir 4 ideas con color (uno de los patrones de la plantilla oficial):

```html
<div class="color-cards">
  <div class="color-card"><p><strong>Idea 1</strong>...</p></div>
  <div class="color-card"><p><strong>Idea 2</strong>...</p></div>
  <div class="color-card"><p><strong>Idea 3</strong>...</p></div>
  <div class="color-card"><p><strong>Idea 4</strong>...</p></div>
</div>
```

Cada `:nth-child` recibe automáticamente un color (Serene, Lime, Canary, Mandarin). Si necesitas 3 o 5 ítems, ajusta CSS o redefine.

## Section index (cajas de colores para índice oscuro)

Útil para una slide de índice tras la portada:

```html
<div class="section-index">
  <div class="section-index__item">
    <span class="section-index__label">MÓDULO 01</span>
    <h3 class="section-index__title">Título sección</h3>
  </div>
  <!-- … más items … -->
</div>
```

## Tabla

```html
<table class="bbva-table">
  <thead>
    <tr><th>Columna</th><th>Dato</th></tr>
  </thead>
  <tbody>
    <tr><td>...</td><td>...</td></tr>
    <tr class="is-highlighted"><td>...</td><td>...</td></tr>
    <tr class="is-total"><td>Total</td><td>...</td></tr>
  </tbody>
</table>
```

---

Todos estos componentes están **opcionales**. Puedes componer una slide solo con `<h1>` + `<p>` y un buen layout CSS y será perfectamente válida.
