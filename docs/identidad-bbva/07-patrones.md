# 07 · Patrones de inspiración

Estos son **ejemplos** de slides que funcionan bien. No son los únicos válidos, ni hay obligación de usarlos tal cual. Sirven como punto de partida cuando no sabes por dónde empezar.

---

## Portada

Combinación C (Electric Blue) suele funcionar mejor para portadas. Hero en Source Serif, antetítulo en Lato, logo BBVA prominente arriba, NFQ "hecho por" en el pie.

```html
<section class="slide bbva-combo--electric">
  <header class="slide__header">
    <span></span>
    <img src="./docs/visual/logos/BBVA_WHITE.png" alt="BBVA" class="bbva-logo bbva-logo--lg">
  </header>

  <div style="align-self: end;">
    <p class="ante-title">MAYO 2026 · Subtítulo o detalle</p>
    <h1 class="bbva-hero">Título de portada<br>en dos líneas</h1>
  </div>

  <footer class="slide__footer">
    <span></span>
    <div class="nfq-credit">
      <span class="nfq-credit__label">Hecho por</span>
      <img src="./docs/visual/logos/Nfq__White.png" alt="NFQ" class="nfq-logo">
    </div>
  </footer>
</section>
```

Variaciones: portada con microilustración a la derecha; portada con foto editorial a un lado (con caja sólida para el texto); portada con un dato gigante.

---

## Índice de secciones (fondo oscuro)

Una slide tras la portada con N cajas de colores acento, cada una con un módulo / sección.

```html
<section class="slide bbva-combo--midnight">
  <header class="slide__header">
    <span></span>
    <img src="./docs/visual/logos/BBVA_WHITE.png" alt="BBVA" class="bbva-logo">
  </header>

  <h2 class="bento__title">Índice</h2>

  <div class="section-index">
    <div class="section-index__item">
      <span class="section-index__label">MÓDULO 01</span>
      <h3 class="section-index__title">Contexto<br>de marca</h3>
    </div>
    <!-- repetir según necesidad — los colores se aplican por :nth-child -->
  </div>
</section>
```

---

## Portadilla / separador de sección

Una slide simple con el número y nombre de sección. Combinación B (Serene) es elegante para esto, también vale C.

```html
<section class="slide bbva-combo--serene">
  <header class="slide__header">
    <img src="./docs/visual/logos/BBVA_RGB.png" alt="BBVA" class="bbva-logo">
  </header>

  <div style="align-self: end;">
    <p class="ante-title">2. Sistema visual</p>
    <h1 class="bbva-hero">Sistema<br>visual</h1>
  </div>
</section>
```

---

## Slide de contenido con breadcrumb

Para presentaciones largas, el breadcrumb arriba ayuda a navegar.

```html
<section class="slide bbva-combo--sand">
  <header class="slide__header">
    <nav class="breadcrumb">
      <span>PRESENTACIÓN / SECCIÓN</span>
      <span class="breadcrumb__sub">SUBSECCIÓN</span>
    </nav>
    <img src="./docs/visual/logos/BBVA_RGB.png" alt="BBVA" class="bbva-logo">
  </header>

  <main>
    <p class="ante-title">Antetítulo opcional</p>
    <h1>Título de la slide</h1>
    <p>Cuerpo de texto con la idea principal…</p>
  </main>

  <footer class="slide__footer">
    <span>Sección · Subsección</span>
    <span class="pager">p. 05</span>
  </footer>
</section>
```

A partir de aquí, libre: una columna, dos columnas, imagen a un lado, tabla, datos grandes…

---

## Texto sobre fotografía (Doble Bentō)

Para cita destacada o frase de impacto sobre una imagen. **Sin opacity ni filter**: caja sólida superpuesta.

```html
<section class="slide double-bento bbva-combo--electric">
  <figure class="double-bento__bg">
    <img src="./docs/visual/photos/foto.jpg" alt="">
  </figure>
  <article class="double-bento__overlay">
    <p class="ante-title">Antetítulo opcional</p>
    <h2>La frase destacada va aquí, en Source Serif Bold.</h2>
  </article>
</section>
```

---

## Cajas de colores (4 ideas)

Patrón clásico de la plantilla oficial para resumir 4 atributos / ideas:

```html
<section class="slide bbva-combo--sand">
  <header class="slide__header">
    <img src="./docs/visual/logos/BBVA_RGB.png" alt="BBVA" class="bbva-logo">
  </header>

  <h1>Cuatro pilares</h1>

  <div class="color-cards">
    <div class="color-card">
      <p><strong>Cercanía</strong> Acompañamos a cada cliente.</p>
      <img src="./docs/visual/icons/bbvacontigo.svg" alt="" class="color-card__icon">
    </div>
    <div class="color-card">
      <p><strong>Innovación</strong> Tecnología al servicio.</p>
      <img src="./docs/visual/icons/ai.svg" alt="" class="color-card__icon">
    </div>
    <div class="color-card">
      <p><strong>Sostenibilidad</strong> Futuro responsable.</p>
      <img src="./docs/visual/icons/climateaction.svg" alt="" class="color-card__icon">
    </div>
    <div class="color-card">
      <p><strong>Salud financiera</strong> Decisiones conscientes.</p>
      <img src="./docs/visual/icons/financialhealth.svg" alt="" class="color-card__icon">
    </div>
  </div>
</section>
```

---

## Bocadillos (3 consequat)

Tres "bocadillos" azules con texto debajo, para presentar 3 ideas paralelas:

```html
<div class="bubbles">
  <div class="bubble-item">
    <div class="bubble-item__balloon">Consequat 1</div>
    <p>Descripción del primer punto…</p>
  </div>
  <div class="bubble-item">
    <div class="bubble-item__balloon">Consequat 2</div>
    <p>Descripción del segundo punto…</p>
  </div>
  <div class="bubble-item">
    <div class="bubble-item__balloon">Consequat 3</div>
    <p>Descripción del tercer punto…</p>
  </div>
</div>
```

---

## Slide con conclusión

Texto + caja Serene Blue con la conclusión.

```html
<section class="slide bbva-combo--sand">
  <h1>Resumen ejecutivo</h1>

  <div>
    <p>El proyecto ha alcanzado los objetivos clave…</p>
    <p>Hemos consolidado un sistema de identidad reutilizable…</p>
  </div>

  <aside class="conclusion__box">
    <p>Texto conclusión destacado.<br>
    <em>Cursiva opcional para énfasis.</em></p>
  </aside>
</section>
```

---

## Cierre / contraportada

Logo BBVA centrado, crédito NFQ en pie.

```html
<section class="slide bbva-combo--electric">
  <div style="display: grid; place-items: center; flex: 1; min-height: 60vh;">
    <img src="./docs/visual/logos/BBVA_WHITE.png" alt="BBVA" class="bbva-logo bbva-logo--lg">
  </div>

  <footer class="slide__footer slide__footer--centered">
    <div class="nfq-credit">
      <span class="nfq-credit__label">Hecho por</span>
      <img src="./docs/visual/logos/Nfq__White.png" alt="NFQ" class="nfq-logo">
    </div>
  </footer>
</section>
```

---

## Otras ideas que funcionan

- **Slide solo con un dato gigante**: un número en Source Serif a `clamp(120px, 14vw, 240px)`, una etiqueta en Lato debajo. Útil para impacto.
- **Slide con tabla**: usa `.bbva-table` o compón una grid CSS con bordes Gray 2/3.
- **Slide con timeline horizontal**: badges + línea horizontal + hitos.
- **Slide con gráfico**: usa Chart.js o Recharts con los colores BBVA (`tokens.css`).
- **Slide vacía / "respiro"**: solo un titular grande centrado entre dos secciones densas.

Componer es libre. La consistencia viene de la paleta, la tipografía y los radios — no de copiar un layout fijo.
