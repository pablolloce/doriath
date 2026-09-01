# KDD Studio — Funcionamiento del programa

> Documento de referencia funcional: qué hace la herramienta, cómo se estructura el conocimiento, cómo funciona el módulo **Work**, cómo opera el **asistente** y cómo se explota la **Knowledge Base**.
>
> **Alcance de este documento**: describe el funcionamiento general de la herramienta y su modelo de datos. No contiene inventario de aplicativos, estructura organizativa, ni identificadores reales — todos los ejemplos usan IDs genéricos de la documentación del framework.

---

## 1. Qué es KDD Studio

KDD Studio es una **extensión de VS Code** que implementa **KDD (Knowledge-Driven Development)**: un framework donde el conocimiento de negocio y técnico deja de vivir en wikis y PDFs y pasa a existir como **specs** — documentos estructurados, versionados y legibles tanto por personas como por agentes de IA.

El problema que resuelve: la documentación tradicional se desactualiza, no está estructurada y no puede ser procesada por un LLM. El conocimiento acaba viviendo en las personas, no en los sistemas.

La propuesta: las especificaciones pasan de documentos pasivos a **contratos activos** que se validan, se relacionan entre sí y se inyectan como contexto en el trabajo diario.

### Los cinco principios de diseño

| Principio | Qué significa |
|---|---|
| **Everything as Code** | Specs en Markdown + YAML: validables en CI/CD, versionadas en Git, con historial y autoría |
| **Layered Artifact Hierarchy** | Tres ejes ortogonales (Knowledge / Work / Governance), cada uno con sus capas y ciclo de vida |
| **Universal Applicability** | Sirve igual en brownfield (documentar legacy mientras se sustituye), greenfield (spec-first) o híbrido |
| **Incremental Adoption** | 5 niveles: L1 Documentar → L2 Validar → L3 Automatizar → L4 Generar → L5 Orquestar. Cada nivel aporta valor por sí solo |
| **Compliance-as-Knowledge** | Los requisitos regulatorios se convierten en specs `RULE` con confianza alta, versionadas y validadas en pipeline — no en PDFs que se pudren |

El insight de la adopción incremental: **el esfuerzo por nivel es incremental, pero el valor es compuesto**. El conocimiento acumulado en los niveles bajos se vuelve exponencialmente más valioso conforme sube la automatización.

---

## 2. Arquitectura de ejecución

```
┌─────────────────────────────────────────────────────────────┐
│  VS Code                                                     │
│  ┌───────────────┐         ┌──────────────────────────────┐ │
│  │  Webview UI   │◄──IPC──►│  Extension Host (Node)       │ │
│  │  Home · Know- │         │  handlers → services →       │ │
│  │  ledge · Work │         │  orchestration → clients     │ │
│  │  Governance · │         └───────┬──────────────┬───────┘ │
│  │  Grafo · Sync │                 │              │         │
│  └───────────────┘                 │              │         │
└────────────────────────────────────┼──────────────┼─────────┘
                                     │              │
                    ┌────────────────▼───┐   ┌──────▼────────────┐
                    │ Proveedores LLM    │   │ Backend           │
                    │ Copilot / Claude   │   │ Google Apps Script│
                    │ CLI / Gemini CLI   │   │ + Drive (specs)   │
                    └────────────────────┘   └───────────────────┘
```

**Capas del código** (dependencias en un solo sentido):

```
core < clients < kdd/knowledge < services < orchestration < handlers < webview
                                     ↑
              scanners, generators, chat se usan desde services/orchestration
```

- `core/` — infraestructura VS Code (logger, estado, workspace). Sin lógica de negocio.
- `clients/` — llamadas de bajo nivel: LLM multimodal, proveedores, cliente del backend, conversores.
- `kdd/` — el modelo: tipos, parseo, frontmatter, grafo, stores. Sin I/O de negocio.
- `knowledge/` — fuentes de conocimiento (local y Drive), push/pull.
- `services/` — lógica de negocio: gobernanza, artefactos Work, sesiones de chat, sincronización.
- `orchestration/` — pipelines multi-paso: orquestador, gestión y recuperación de contexto.
- `handlers/` — traduce mensajes del webview a servicios. Solo dispatch.
- `webview/` — UI y protocolo de mensajes.

**Persistencia**: las specs viven como ficheros Markdown en Google Drive (sincronizados a una copia local por caja), no en una base de datos relacional. El "esquema" de esa BBDD es el frontmatter YAML (sección 4), y el "índice" es el grafo derivado de las relaciones declaradas.

---

## 3. La taxonomía: tres ejes ortogonales

```
                    ┌─────────────────────────────┐
                    │   GOVERNANCE (puente)        │
                    │   RFC · ADR · RULE           │
                    └──────────┬──────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                                 │
   ┌──────────▼─────────┐          ┌───────────▼────────┐
   │ KNOWLEDGE          │          │ WORK               │
   │ (persistente)      │◄─activates─│ (efímero)        │
   │ ARCH · DOM · PROD  │          │ WRK-SPEC           │
   │ FEAT · DOC         │          │ WRK-PLAN           │
   │ Lo que se sabe     │          │ WRK-TASK           │
   └────────────────────┘          │ Lo que se hace     │
                                   └────────────────────┘
```

Los ejes son **ortogonales**: un artefacto Work referencia conocimiento (vía `activates`) **sin duplicarlo**. El conocimiento existe con independencia de cualquier cambio concreto.

### 3.1 Eje Knowledge — persistente

Sobrevive a los proyectos. Es el activo que se acumula.

| Capa | Patrón de ID | Qué captura | Pregunta que responde | Estructura de su `Definition` |
|---|---|---|---|---|
| **Architecture** | `ARCH-NNN` | Decisiones tecnológicas, patrones, infraestructura | ¿Cómo se construye? | Context → Decision → Rationale → Consequences |
| **Domain** | `DOM-AREA-NNN` | Reglas de negocio, regulación, conceptos de dominio | ¿Qué debe saber el sistema? | Concept → Rules → Constraints → Examples |
| **Product** | `PROD-JOURNEY-NNN` | Requisitos de producto, journeys end-to-end | ¿Qué vive el usuario? | Purpose → Actors → Flow → Acceptance Criteria |
| **Feature** | `FEAT-MODULE-NNN` | Funcionalidad concreta, comportamiento | ¿Qué hace el código? | Purpose → Inputs → Behavior → Outputs |
| **Documentation** | `DOC-TYPE-NNN` | Guías, runbooks, material de referencia | ¿Cómo se opera? | Purpose → Audience → Content outline |

**Heurística de selección de capa** (la usa tanto el analizador como los chats):

- Restringe a muchas features → **ARCH**
- Lo posee un experto de dominio → **DOM**
- Lo posee un product owner → **PROD**
- Describe comportamiento visible al usuario → **FEAT**
- Explica cómo hacer algo → **DOC**

Ante ambigüedad, gana la capa que coincide con el **propietario probable** del conocimiento.

### 3.2 Eje Work — efímero

Ligado a una iniciativa concreta. Nace, se ejecuta y se archiva.

| Tipo | Patrón de ID | Propósito | Padre | Secciones canónicas del body |
|---|---|---|---|---|
| **WRK-SPEC** | `WRK-SPEC-NNN` | Qué cambia y por qué | — | Problem Statement → Proposed Change → Knowledge Context → Constraints → Acceptance Criteria → Open Questions |
| **WRK-PLAN** | `WRK-PLAN-NNN` | Cómo se implementa | WRK-SPEC | Approach → Task Breakdown → Architecture Impact → Risk Assessment → Dependencies |
| **WRK-TASK** | `WRK-TASK-NNN` | Unidad atómica de trabajo | WRK-PLAN | Objective → Implementation Notes → Acceptance Criteria → Test Plan |

### 3.3 Eje Governance — puente

Es el mecanismo por el que el conocimiento evoluciona con garantías.

| Tipo | Rol | Persistencia | Ciclo de vida |
|---|---|---|---|
| **RFC** | Propone un cambio a estándares o patrones | Efímero (cierra tras la decisión) | `draft → discussion → accepted / rejected / withdrawn` |
| **ADR** | Registra una decisión con contexto y razones | Persistente | `proposed → accepted → deprecated / superseded` |
| **RULE** | Codifica una restricción validable automáticamente | Persistente | `active → deprecated` |

El ciclo canónico: **RFC (proponer) → SPEC (formalizar) → ADR (decidir y aprender)**, con bucle de realimentación.

---

## 4. El modelo de datos — la "BBDD"

No hay base de datos relacional: cada spec es un fichero Markdown cuyo **frontmatter YAML es el esquema**, y el grafo se **deriva** escaneando todos los frontmatters. No existe un `graph.json` central versionado — sería una segunda fuente de verdad con deriva garantizada.

### 4.1 Esquema del frontmatter

**Campos obligatorios en todo artefacto:**

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | string | Identificador único (ver 4.2) |
| `type` | enum | `spec`, `rfc`, `adr`, `guide`, `template`, `rule` |
| `layer` | enum | `architecture`, `domain`, `product`, `feature`, `documentation`, `work-spec`, `work-plan`, `work-task` |
| `status` | enum | Depende del tipo (ver 4.5) |
| `confidence` | enum | `high`, `medium`, `low` |
| `version` | semver | Versión semántica |
| `owner` | string | Equipo o persona responsable |

**Campos opcionales relevantes:**

| Campo | Descripción |
|---|---|
| `domain` / `subdomain` | Dominio funcional de la taxonomía vertical |
| `created` / `updated` | Fechas ISO |
| `reviewers` | Revisores requeridos para cambios |
| `dependencies` | Lista de `{id, relation}` — el grafo estructural |
| `supersedes` | ID de la spec que reemplaza |
| `tags` | Etiquetas libres para descubrimiento |
| `scope` | `persistent` (Knowledge) o `ephemeral` (Work) |
| `activates` | **Solo Work**: IDs de Knowledge que se inyectan como contexto |
| `parent` | **Solo Work**: jerarquía (PLAN→SPEC, TASK→PLAN) |
| `task_kind` | **Solo WRK-TASK**: automatización que dispara el botón "Lanzar" |
| `bbva_one` | Bloque opcional de trazabilidad con el SDLC corporativo |

### 4.2 Patrón de identificadores

El framework define el patrón genérico `TIPO-[ÁREA-]NNN`. En un despliegue **multi-caja** como este, el ID incorpora además el **código de la fuente** inmediatamente antes del número:

```
TIPO-[DOMINIO-]<FUENTE>-NNN
```

- `<FUENTE>` es el **Source ID** de la caja (`S###`) en fuentes del árbol, o el código registrado en fuentes legacy.
- La identidad de una fuente es **siempre su Source ID**, nunca su código de aplicación.
- El parser **rechaza** cualquier ID sin código de fuente en esa posición, y el orden importa: el dominio va **antes** del código de fuente.

```
✓ ARCH-S001-001          ✓ FEAT-BATCH-S001-002        ✓ WRK-SPEC-S001-001
✗ DOM-REG-001 (sin fuente)   ✗ DOM-S001-REG-001 (orden invertido)
```

La numeración es el siguiente número libre dentro del par (dominio, fuente).

### 4.3 Las relaciones — cómo se conecta el grafo

Las relaciones se declaran **solo en formato canónico** `dependencies: [{id, relation}]`. El parser lanza error duro ante campos planos (`depends-on:`, `implements:`, `extends:`…) escritos como claves sueltas.

| Relación | Dirección | ¿Cruza ejes? | Significado |
|---|---|---|---|
| `implements` | Knowledge → Knowledge | No | Aplica un patrón o decisión definido en otra spec |
| `constrained-by` | Knowledge → Knowledge | No | Debe cumplir reglas definidas en otra spec |
| `extends` | Knowledge → Knowledge | No | Añade detalle a una spec más amplia |
| `uses-data-from` | Knowledge → Knowledge | No | Consume datos que otra spec define y posee |
| `activates` | Work → Knowledge | **Sí** | Inyecta conocimiento como contexto de un trabajo |
| `depends-on` | Work → Work | No | Secuenciación entre artefactos de trabajo |
| `parent` | Work → Work | No | Jerarquía TASK → PLAN → SPEC |
| `supersedes` | Cualquiera → cualquiera | No | Cadena de reemplazo |

**Relaciones inversas derivadas automáticamente** por el CLI del grafo — no se declaran, se calculan: `implemented-by`, `constrains`, `extended-by`, `data-used-by`, `activated-by`, `depended-on-by`, `superseded-by`.

Esto es lo que hace posible el **análisis de impacto**: *"si cambio esta spec regulatoria, ¿a qué afecta?"* se responde recorriendo el grafo inverso en anchura.

### 4.4 Dependencies vs Traceability — dos conceptos distintos

| Concepto | Dónde vive | Para qué | Contenido |
|---|---|---|---|
| **Dependencies** | Frontmatter | Grafo máquina-legible spec↔spec | Solo IDs + tipo de relación |
| **Traceability** | Sección del body | Contexto humano hacia artefactos no-spec | Rutas de código, suites de test, ADRs, referencias externas |

### 4.5 Ciclos de vida y confianza

```
      Knowledge                Work                        Governance
  draft → active          draft → active            RFC: draft → discussion → accepted/rejected
        → deprecated            → completed         ADR: proposed → accepted → superseded
                                → archived          RULE: active → deprecated
```

**Niveles de confianza** — determinan cuánto se puede automatizar sobre una spec:

| Nivel | Criterio | Uso permitido |
|---|---|---|
| **HIGH** | Validada por pruebas **Y** revisión experta | Generación de código y validación automática |
| **MEDIUM** | Validada por pruebas **O** revisión experta | Guía el desarrollo, requiere verificación adicional |
| **LOW** | Inferida de observación o documentación, sin validar | Priorizar para validación antes de confiar |

Toda spec generada por LLM nace en `low`. Sube con evidencia registrada en la sección `Evidence`.

**Salvaguarda de sobrescritura**: si una spec tiene `confidence: medium/high` o `manual-edits: true`, el plugin **no sobrescribe su body** al aplicar una propuesta del asistente — solo añade una entrada de Evidence y sube la versión. El contenido validado por un humano queda protegido.

### 4.6 Anatomía del body

Cinco secciones canónicas, **headers en inglés y literales** (el validador los busca por nombre exacto; un sinónimo como `## Goal` o `## Solution` no se detecta y bloquea), **narrativa en español**:

1. **Intent** — qué define esta spec y por qué existe. Comprensible por alguien no técnico.
2. **Definition** — el contenido real. Su estructura **varía por capa** (ver tabla en 3.1).
3. **Acceptance Criteria** — condiciones verificables de conformidad.
4. **Evidence** — qué respalda el contenido: revisiones, pruebas, referencias regulatorias, con su impacto en la confianza.
5. **Traceability** — enlaces a código, tests, decisiones y referencias externas.

---

## 5. La Knowledge Base: cómo se construye y se explota

### 5.1 Construcción — el pipeline de análisis de documentos

Convierte un documento (PDF, Word, código) en specs. Está dividido en **dos fases deliberadamente separadas**, porque cuando un solo paso intentaba extraer y curar a la vez, el modelo omitía material que "olía a que se descartaría", produciendo lagunas silenciosas.

**Fase 1 — Extracción exhaustiva**: produce una lista de "átomos" de conocimiento en bruto, sin filtrar nada.

**Fase 2 — Curación**, en seis etapas sobre esa lista:

1. **Classification** — cada átomo se clasifica con un árbol de decisión canónico:

```
¿Es una DECISIÓN ya tomada con contexto y consecuencias?      → ADR
¿Es un CAMBIO PROPUESTO aún no decidido?                      → RFC
¿Es un CONSTRAINT validable automáticamente?                  → RULE
¿Es CONOCIMIENTO PERSISTENTE organizacional?                  → Knowledge (elegir capa)
¿Es TRABAJO CONCRETO en curso?                                → WRK-*
```

2. **Atomization** — aplica la *Testable Independent Rule*: si puedes escribir un criterio de aceptación para X sin mencionar Y, son specs separadas; si siempre viajan juntas, son una. Se fusiona cuando comparten propietario y criterios; se separa cuando los propietarios difieren o una puede cambiar sin la otra.

3. **Filter** — descarta solo lo trivial (convenciones universales, cosas derivables de la firma de un método, duplicados exactos del inventario). **Ante la duda, retiene**: el coste de una spec de más es bajo; el de perder conocimiento, alto.

4. **Dependency identification** — conecta los supervivientes al grafo existente.

5. **Coverage check** — cada átomo debe acabar en uno de tres sitios: parte de una spec creada, parte de una spec enriquecida, o descartado con motivo explícito. **Ningún átomo puede quedar sin asignar.**

6. **Generation** — emite las specs con su razonamiento y sus descartes.

El resultado va a un **preview**: nada se persiste hasta que el usuario lo confirma.

### 5.2 Consulta — búsqueda híbrida

La recuperación combina dos señales:

- **BM25** — coincidencia léxica sobre los bodies y el catálogo.
- **Embeddings semánticos** — modelo multilingüe en ONNX cuantizado que corre **localmente** en el propio proceso de la extensión (sin enviar contenido a un servicio externo para indexar).

Sobre esa base, el asistente dispone de herramientas de lectura (sección 7.2) para navegar el grafo en tiempo de conversación.

Para documentos escaneados hay **OCR local** (inglés y español) que hace el texto accesible al pipeline.

### 5.3 Activación contextual — el mecanismo central

`activates` no es un simple enlace: es **inyección de conocimiento organizacional con alcance acotado** dentro del flujo de trabajo. El pipeline tiene cuatro pasos:

```
1. EXPLICIT    El autor declara  activates: [DOM-…, ARCH-…]
       ↓        Es el juicio humano: "estas sé que aplican".
2. TRANSITIVE  Recorrido del grafo en anchura: DOM-X --constrained-by--> DOM-REG-Y
       ↓        Arrastra conocimiento que el autor podía desconocer.
3. FILTERED    Puntuación de relevancia: distancia en el grafo (alta), confianza
       ↓        (media), coincidencia de capa (media), tipo de relación (baja).
               Las specs deprecadas se excluyen salvo activación explícita.
4. BUDGETED    Presupuesto por nivel de trabajo:
               WRK-TASK 2–5 specs · WRK-PLAN 3–7 · WRK-SPEC 5–10
               Tier 1 body completo · Tier 2 solo Intent + AC · Tier 3 solo ID
```

### 5.4 Federación y cross-source

Cada caja es una fuente independiente con su propio Source ID y sus responsables. El conocimiento de otras cajas se consulta en **solo lectura** mediante herramientas cross-source específicas, que devuelven siempre de qué caja procede cada resultado — nunca se mezcla como si fuera propio.

---

## 6. El módulo Work

Es donde el conocimiento se pone a trabajar. La jerarquía:

```
WRK-SPEC (iniciativa)          ← declara activates: [conocimiento]
  └── WRK-PLAN (plan)          ← parent: WRK-SPEC ; hereda la activación
       ├── WRK-TASK            ← parent: WRK-PLAN ; hereda la activación
       ├── WRK-TASK
       └── WRK-TASK
```

**Regla de herencia**: `activates` se declara **solo en la WRK-SPEC**. PLAN y TASK lo heredan vía `parent`. Duplicarlo en los hijos es un error que el validador señala.

### 6.1 El flujo completo de una iniciativa

```
1. SPECIFY      WRK-SPEC: qué cambia y por qué + activa el conocimiento relevante
       ↓
2. PLAN         WRK-PLAN: cómo, con las restricciones heredadas del conocimiento activado
       ↓
3. IMPLEMENT    WRK-TASK → código, siguiendo patrones ARCH y reglas DOM activadas
       ↓
4. CONSOLIDATE  Lo aprendido vuelve al conocimiento: ADRs, correcciones, specs nuevas
```

**Qué conocimiento se activa en cada fase:**

| Fase | Artefacto | Conocimiento activado | Gobernanza que produce |
|---|---|---|---|
| Specify | WRK-SPEC | DOM, PROD, reglas regulatorias | RFC (si aparece un hueco en estándares) |
| Plan | WRK-PLAN | ARCH, NFRs, estándares de API | ADR (decisiones de diseño) |
| Implement | WRK-TASK | FEAT, reglas de negocio, estándares de test | — |
| Consolidate | — | — | ADRs, specs DOM/ARCH actualizadas, RULEs nuevas |

### 6.2 Creación de un paquete Work

El chat de creación Work sigue un protocolo de **4 fases**, marcadas explícitamente en cada turno (`understand → classify → validate → generate`):

**Fase 1 — Understand.** El asistente actúa como **entrevistador de negocio insistente**: pregunta todo lo necesario para que las specs salgan correctas (qué hace el cambio, qué reglas aplican, qué define el éxito, integraciones, casos límite). El reparto es explícito:

> **El QUÉ de negocio se PREGUNTA; el CÓMO de KDD lo rellena el asistente.** El usuario nunca ve preguntas sobre frontmatter, `activates`, `task_kind` ni cómo redactar un criterio de aceptación.

**Fase 2 — Classify.** Decide la forma del paquete: cuántos PLANes (uno por frente de trabajo paralelo), cuántas TASKs por PLAN (atómicas, 1-3 días, sin granularidad excesiva), y qué conocimiento activar. Si el inventario no tiene el conocimiento necesario:

- Si el cambio **define conocimiento nuevo y durable** → se crea en el mismo paquete y se activa.
- Si **no lo define** (clon técnico, extensión de un patrón existente) → `activates` vacío es legítimo. No se fabrica conocimiento de relleno.

Aquí también se decide si hay **decisiones de diseño con consecuencias reales** que un humano querría tomar (el nombre de un valor de enum que verá el resto del código, persistir datos o no, la forma de un contrato). Si las hay, se **preguntan en la conversación en bloque y no se emite nada todavía**.

**Fase 3 — Validate.** Comprueba el rubric antes de generar. El punto más estricto son los **criterios de aceptación**: el validador rechaza los "aspiracionales".

| ✗ Aspiracional (rechazado) | ✓ Verificable (aceptado) |
|---|---|
| Mejora el rendimiento | El batch procesa 100K posiciones en menos de 60 min en el entorno productivo |
| Funciona en producción | Cuando el despliegue termina → el endpoint `/health` responde 200 OK con versión y commit |
| Se integra con el sistema X | Dado un mensaje válido en la cola cuando llega al consumer entonces se persiste en menos de 500 ms |

Verbos prohibidos por no ser verificables: `debe`, `debería`, `mejora`, `optimiza`, `moderniza`, `soporta correctamente`, `gestiona adecuadamente`.

**Fase 4 — Generate.** Emite el paquete completo en un solo bloque.

### 6.3 Reglas duras del paquete Work

- **El paquete es ATÓMICO**: si una sola spec omite un campo bloqueante, se rechaza el paquete entero.
- **Un PLAN va SIEMPRE con sus TASKs en el mismo bloque.** Emitir un PLAN solo deja su Task Breakdown sin tareas reales y el gate lo bloquea.
- **Prohibido emitir la WRK-SPEC sola "para confirmar"** y dejar el plan para después: la creación queda a medias.
- **Los artefactos Work solo se crean, no se enriquecen** — son efímeros por definición. El conocimiento del paquete sí admite enriquecimiento.
- **Estado inicial**: `draft` y confianza `low`. El usuario los sube manualmente al validar.

**`## Open Questions`** es sección canónica **solo de la WRK-SPEC** (el PLAN y la TASK no la tienen), y solo admite residuales que no alteran qué tareas hay ni de qué plan cuelgan, y que el desarrollador cerraría al programar sin que nadie quiera opinar. Aparcar ahí una decisión que el usuario habría querido tomar es el error a evitar — el plugin **retiene el paquete** hasta que esas decisiones se cierren.

### 6.4 Automatizaciones — el campo `task_kind`

Cada WRK-TASK puede declarar `task_kind`: la automatización que dispara el botón **Lanzar**. Es opcional y **sin default** — se asigna la que más cuadre con la naturaleza de la tarea, y si ninguna encaja se omite (estado válido; el usuario la asigna después).

> **Regla de oro**: si dudas entre dos automatizaciones, elige la que represente el 80% del esfuerzo. Una tarea que mezcla dos acciones automatizables distintas se descompone en dos tareas.

Las automatizaciones declaran **capacidades** que acotan qué pueden hacer: acceso al LLM, lectura de los artefactos Work, lectura del repositorio apuntado, o red. Van **firmadas criptográficamente** y pasan por **aprobación de un administrador** antes de poder ejecutarse (ver 8.3).

Automatizaciones de referencia:

| Automatización | Qué produce |
|---|---|
| **C204** | Documento Excel de casos de prueba a partir de la iniciativa Work |
| **Documento (Markdown)** | Documento generado por LLM sobre el contexto de la tarea |
| **Bundle DEV** | Paquete de contexto hacia un repositorio externo |

### 6.5 Artefactos operativos: P037 y C204

Son documentos del ciclo de vida corporativo que la herramienta genera, **distintos de las specs KDD**:

**P037 — documento técnico de un servicio.** Se genera recorriendo el código fuente de un repositorio (packages, clases, métodos, endpoints, integraciones, almacenes de datos). **No es una spec KDD**: es un documento operativo rico en hechos concretos que después se pasa al analizador para que extraiga de él las specs que correspondan. Se genera por trozos, con marcadores de fin, y admite continuación parcial. En la equivalencia con el marco corporativo, su contenido acaba viviendo como sección de trazabilidad dentro de una WRK-SPEC.

**C204 — documento de pruebas.** Toma la iniciativa Work completa (WRK-SPEC + planes + tareas + conocimiento activado, y el P037 del servicio si aplica) y produce un `.xlsx` con dos hojas: casos de prueba (con sub-casos, precondiciones, eventos y resultados esperados) y detalles. El LLM emite un YAML acotado entre marcadores y el generador monta el Excel. Las columnas de validación las rellena después el equipo de pruebas.

### 6.6 Consolidación — cerrar el bucle

Cuando una WRK-SPEC se completa, la consolidación analiza qué aprendió el equipo y propone deltas al conocimiento persistente. Produce un informe con seis secciones:

1. **ADRs a crear** — decisiones tomadas durante el trabajo que no están registradas. Señales textuales: *"se eligió"*, *"se decidió"*, *"trade-off"*, *"se descartó"*.
2. **Specs a actualizar** — conocimiento activado que la implementación reveló inexacto, con subida de versión.
3. **Specs nuevas** — conocimiento descubierto que no existía, propuesto con confianza `low`.
4. **Extracción de reglas** — reglas de negocio que quedaron incrustadas en el código y deberían formalizarse.
5. **Captura de patrones** — patrones reutilizables introducidos en el plan que merecen una spec ARCH.
6. **Subidas de confianza** — specs que la implementación y los tests validaron, con su evidencia.

Regla crítica: **exhaustivo pero sin inventar**. Si una decisión no aparece explícitamente en el texto de los artefactos Work, no se propone.

> El insight de fondo: *la consolidación no es mantenimiento opcional, es el mecanismo por el que la organización aprende*. Un proyecto que entrega código pero no consolida conocimiento ha entregado la mitad de su valor.

### 6.7 Activación hacia agentes externos

Una WRK-TASK o WRK-SPEC puede empaquetarse como **bundle de activación**: un prompt autocontenido listo para pegar en un agente de código externo. Ejecuta el pipeline de activación (explicit → transitive → filtered → budgeted) y renderiza en uno de tres patrones:

- **bundle** (por defecto) — conocimiento activado con body completo, seguido de la tarea.
- **layered** — separa reglas de dominio (obligatorias), restricciones de arquitectura (obligatorias) y contexto de producto (deseable).
- **retrieval** — resúmenes de una línea, con el body completo disponible bajo demanda por herramienta.

El bundle incluye una **cabecera de diagnóstico** con qué entró en cada paso del pipeline y los tokens estimados, para que el resultado sea auditable sin abrir cada spec.

---

## 7. El asistente

### 7.1 Proveedores de modelo

Cuatro rutas con cadena de fallback automática:

| Proveedor | Mecanismo | Herramientas |
|---|---|---|
| **Copilot** | API de modelos de lenguaje de VS Code; detecta ventana de contexto por modelo y soporta multimodal con caída a solo-texto | Sí |
| **Claude CLI** | Lanza el CLI local como proceso hijo | Sí |
| **Gemini CLI** | Binario configurable | No |
| **Local** | Modo sin backend corporativo | — |

La detección del binario de los CLI se hace con comandos fijos de resolución de rutas, sin interpolar entrada del usuario.

### 7.2 Herramientas expuestas al modelo

El asistente no "recuerda" el conocimiento: lo **consulta** con herramientas de solo lectura sobre la caja activa y, en modo federado, sobre otras cajas.

| Familia | Herramientas |
|---|---|
| Búsqueda y lectura de specs | `search_specs` (híbrida BM25 + embeddings), `read_spec`, `list_specs`, `validate_spec` |
| Federación | `search_cross_source`, `read_cross_source_spec` |
| Work | `list_work_items`, `list_pending_tasks`, `get_open_questions` |
| Histórico | `search_decision_history` |
| Documentos | `search_document`, `read_section`, `grep_document`, `list_documents`, `analyze_image` |
| Código | `grep`, `grep_repo`, `read_repo_file` |

### 7.3 Los distintos chats

| Chat | Función |
|---|---|
| **Creación de specs** | Entrevista guiada para crear conocimiento a mano (cualquier capa) |
| **Creación Work** | El protocolo de 4 fases de la sección 6.2 |
| **Resolución** | Cierra las preguntas abiertas y conflictos detectados por el análisis, **antes** de persistir |
| **Chat de tarea** | Conversación acotada al contexto de una WRK-TASK |
| **Chat flotante** | Consulta general sobre la caja activa, con adjuntos e historial |

### 7.4 Cómo se comporta: reglas transversales

**El asistente propone, el plugin persiste.** El modelo nunca escribe a disco: emite acciones en un bloque estructurado al final de su respuesta, y el plugin las aplica solo tras confirmación del usuario. Las acciones disponibles en el chat de resolución son seis: proponer modificación sobre el preview, proponer spec nueva, proponer modificación sobre una spec ya persistida, marcar una pregunta como resuelta, eliminar una dependencia y deprecar/reactivar una spec.

**Guardián de la coherencia, no asistente complaciente.** Ante una propuesta del usuario, evalúa las implicaciones contra el inventario, las dependencias declaradas y las transitivas, y los principios de atomicidad y ortogonalidad. Si detecta contradicción, redundancia o riesgo de ciclo en el grafo, lo señala antes de aceptar. *El usuario siempre tiene la última palabra, pero nunca la toma desinformado.*

**Atomicidad de resolución.** Si cerrar una pregunta implica cambios concretos en specs, esos cambios se emiten en el **mismo turno**. No se difiere ni se pide permiso para acciones derivadas: cuando el usuario ya ha aportado la información, la decisión de actuar es del asistente.

**Habla humano.** La narrativa que lee el usuario tiene prohibidos los nombres internos del contrato, la jerga del plugin y los valores YAML recitados. Se dice *"la confianza está baja"*, no `confidence: low`. Tampoco se verbaliza el mecanismo interno de carga de contexto.

**Borrar no es deprecar.** Deprecar cambia el estado y **conserva** la spec y sus relaciones (el conocimiento es persistente y su historia importa). Un borrado real es irreversible y afecta a todos los que la tengan sincronizada: el asistente nunca borra en silencio, lo deriva a una acción explícita del usuario.

### 7.5 Contexto y preámbulo

Los prompts de generación de specs se envuelven con un **preámbulo canónico** que carga la metodología completa (principios, taxonomía, tipos de spec, anatomía y el workflow canónico de 5 pasos) antes del prompt concreto. El orden importa: **contexto → disciplina → tarea**.

El workflow canónico que sigue el modelo al generar cualquier spec:

1. **Comprobar la anatomía** — estructura, orden de secciones, headers literales en inglés.
2. **Elegir el tipo correcto** — con el árbol de decisión y la heurística de propietario.
3. **Aplicar la taxonomía vertical** — usar el vocabulario del dominio literalmente, sin inventar nodos.
4. **Completitud del frontmatter** — campos obligatorios por eje.
5. **Auto-validar la integridad** — que toda dependencia apunte a una spec real, sin ciclos, con la confianza y el estado iniciales correctos.

Por turno, el plugin inyecta además el body completo de las specs relevantes al mensaje: las mencionadas explícitamente por ID, las afectadas por preguntas que se solapan con el mensaje, y las dependencias directas de ambas.

---

## 8. Seguridad y control de acceso

### 8.1 Modelo de permisos

El acceso se resuelve contra el backend, con roles por caja: **administrador**, **propietario**, **escritura**. La distinción operativa clave es **champion** (puede escribir en la caja) frente a **consumer** (solo lectura). La UI refleja esos permisos ocultando superficies completas: el módulo Work requiere un nivel mínimo de madurez de la caja, y las pestañas de escritura desaparecen para un consumer.

Principio de diseño: **los gates se aplican en todos los puntos de entrada, no solo en el que usa la UI** — un mensaje IPC forjado no debe puentearlos. Ante la duda, se deniega.

### 8.2 Contenido no confiable

Todo documento importado, respuesta de LLM, contenido traído de Drive y paquete de automatización se trata como **contenido no confiable**: puede contener instrucciones dirigidas al agente. La salida del LLM hacia la interfaz se escapa siempre; nunca se inyecta texto generado como HTML crudo.

Prohibiciones duras del código: nada de evaluación dinámica de código ni ejecución de comandos con contenido procedente del LLM, de un documento importado o de un paquete de automatización.

### 8.3 Automatizaciones firmadas

Las automatizaciones se **firman criptográficamente** y se verifican contra una clave pública embebida en la extensión; la clave privada la importa cada usuario en el almacenamiento seguro local, nunca viaja en el paquete. Además, un **escáner estático** analiza el código de la automatización antes de aprobarla, marcando como severidad alta patrones peligrosos: ejecución de comandos del sistema, evaluación dinámica de código y construcción de código desde cadenas. El circuito se cierra con **aprobación explícita de un administrador**.

---

## 9. Herramientas de grafo

El conocimiento se explota también como grafo, con un CLI dedicado:

| Comando | Qué hace |
|---|---|
| `build` | Escanea los frontmatters y genera la lista de adyacencia |
| `validate` | Detecta IDs rotos, ciclos y problemas de confianza |
| `impact <id>` | Recorrido transitivo: qué se ve afectado por un cambio |
| `orphans` | Specs sin conexión con el resto del grafo |
| `context <id>` | Bundle de activación contextual |
| `path <from> <to>` | Camino entre dos specs |
| `stats` / `filter` | Métricas y consulta por capa, dominio o etiqueta |

La misma lógica alimenta la vista de grafo interactiva de la herramienta.

---

## 10. Glosario

| Término | Significado |
|---|---|
| **Spec** | Unidad atómica de conocimiento: Markdown + frontmatter YAML, con ID, propietario, confianza y relaciones |
| **Caja / fuente** | Ámbito de conocimiento con responsable propio, identificado por su Source ID (`S###`) |
| **Knowledge Base** | El grafo completo de specs de una organización, no una wiki ni un repositorio de documentos |
| **Activación** | Inyección acotada de conocimiento persistente como contexto de un trabajo concreto |
| **Consolidación** | Fase donde lo aprendido en el trabajo vuelve al conocimiento persistente |
| **P037** | Documento técnico de un servicio, generado desde el código. Alimenta el analizador; no es una spec |
| **C204** | Documento Excel de casos de prueba generado desde una iniciativa Work |
| **Champion / consumer** | Quien puede escribir en una caja / quien solo puede leerla |
