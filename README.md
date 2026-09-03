# Doriath

Workbench local para BBVA CIB que une la operativa de **FENIX** (sesión corporativa de GitHub con `gh`, agente **GitHub Copilot** sin BYOK, trabajo sobre repositorios Git) con la metodología de **KDD Studio** (Knowledge-Driven Development: conocimiento como specs versionadas que se activan como contexto del trabajo).

Se ejecuta en el equipo del usuario: un servidor Node en `127.0.0.1` y una pestaña en Chrome. No hay backend remoto ni base de datos: el estado vive en ficheros.

## Módulos

| Módulo | Qué hace |
|---|---|
| **Knowledge Base Studio** | Importa documentos (PDF, Word, Excel, PowerPoint, Markdown, texto, código) a una base de conocimiento local y genera specs KDD con el analizador en dos fases de KDD Studio (átomos → plan de curación → bodies). Preview con preguntas abiertas y chat de resolución antes de persistir. Catálogo, edición, grafo e impacto. |
| **BBVA CIB Assistant** | Chat con contexto de todas las bases de conocimiento (herramientas de consulta, no memoria). Genera entregables con la identidad BBVA × NFQ: Word, Excel, PowerPoint, HTML, Markdown, código. |
| **Knowledge-Driven Development** | Entrevista en 4 fases (entender, clasificar, validar, generar) que produce una **iniciativa** con sus **features** y sus **historias de usuario**, detecta los repositorios necesarios (carpetas locales con `.git`), y trabaja cada historia con Copilot sobre el repositorio: diff revisable, commit, push y pull request. |

Las bases de conocimiento son carpetas locales con la misma disposición que las fuentes locales de KDD Studio (`specs/<capa>/…`, `docs-tecnicos/`, `.kdd-studio/`), así que son intercambiables.

## Requisitos en el equipo (Windows)

- **GitHub CLI** (`gh`) con sesión en `bbva.ghe.com`. Si falta, el launcher descarga una versión portable y abre el inicio de sesión (`gh auth login --web`).
- **Git**. Si falta, el launcher descarga MinGit portable.
- Licencia de **GitHub Copilot** en la cuenta corporativa. Doriath pasa al runtime el token de la sesión de `gh` y, si no vale, usa la sesión propia del runtime (`copilot login --host bbva.ghe.com`).
- Chrome (opcional): se abre una pestaña nueva en la instancia en ejecución; sin Chrome se usa el navegador predeterminado.

No hace falta Node instalado: el instalador incluye un Node portable.

## Los dos roles

Doriath enseña dos caras de la misma base de conocimiento, con un conmutador **Usuario / Admin** en la cabecera (se recuerda en el navegador):

- **Usuario · My Knowledge Bases** — para quien aporta conocimiento pero no lo mantiene. No se nombra ninguna spec, ni capas, ni identificadores: sube documentos, pulsa *Aprender de estos documentos* y ve el progreso y el resultado en lenguaje llano. En el chat, cada respuesta lleva **Es correcto** y **No es así, corregir**; la corrección se anota como evidencia sobre la spec afectada y sube su versión menor. Si no se identifica a cuál afecta, queda como *corrección sin asignar* para que la coloque quien mantiene la base.
- **Admin · Knowledge Bases Studio** — mantenimiento completo: **Panel** (KPIs, reparto por capa, salud con sus incidencias, últimos cambios y últimos documentos con quién los incluyó y qué specs generaron), Documentos, Análisis, Specs, Grafo, **Gobernanza** (ADR, RFC y reglas con responsable y estado) y **Actividad** (quién ha cambiado qué, cuándo y desde dónde, filtrable).

El registro vive en `.kdd-studio/activity.json` dentro de la propia base, así que viaja con ella y lo ve todo el equipo. Cada cambio se firma con el usuario de la sesión de GitHub.

## El vocabulario de Knowledge-Driven Development

Por debajo, una iniciativa se guarda como `WRK-SPEC` con sus `WRK-PLAN` y sus `WRK-TASK`: es el formato KDD y no cambia. Pero el módulo lo usa gente que no sabe qué es una spec, así que en pantalla se habla en su idioma:

| Se guarda como | Se llama |
|---|---|
| `WRK-SPEC` | **Iniciativa** — lo que se quiere conseguir |
| `WRK-PLAN` | **Feature** — cada bloque de trabajo |
| `WRK-TASK` | **Historia de usuario** — cada pieza concreta que se ejecuta |

Los identificadores (`WRK-TASK-S001-002`) solo se enseñan en el rol **Admin**; en el rol Usuario no aparecen en ninguna pantalla. El asistente tiene la misma regla en su prompt: no dice «spec», «plan» ni «paquete» en la conversación. Los términos de Git (rama, commit, push, pull request) sí se usan con normalidad, porque el módulo trabaja sobre repositorios de verdad y son el nombre real de lo que pasa.

Una excepción deliberada: el mensaje de commit y el título de la pull request sí llevan el identificador. Es la trazabilidad entre el código y el conocimiento que lo justifica, y vive en el repositorio, no en la interfaz. Los dos campos son editables antes de confirmar.

## Instalación (usuario final)

`Doriath-Setup.exe` es autosuficiente: lleva dentro la aplicación, sus dependencias (incluido el runtime nativo de Copilot) y Node.js portable. Compartiendo ese único fichero (~390 MB) no hace falta nada más — ni `npm install`, ni instalar Node. Dos matices: como no va firmado, Windows enseña el aviso de SmartScreen (*Más información → Ejecutar de todos modos*), y si el equipo no tiene `gh` o `git`, el primer arranque se los descarga (necesita salida a internet, además de la que ya exige GitHub y Copilot).

1. Ejecuta `Doriath-Setup.exe`. Pide la carpeta de instalación (por defecto `%LOCALAPPDATA%\Doriath`) y crea:
   ```
   Doriath/
   ├── Doriath.exe          launcher (Doriath.cmd y Doriath-Diagnostico.cmd como alternativas)
   ├── app/                 aplicación
   ├── runtime/             Node portable (+ gh y git portables si hicieron falta)
   ├── data/                configuración, conversaciones, análisis, ejecuciones, logs
   ├── outputs/             ficheros generados por el asistente
   └── knowledge-bases/     carpeta sugerida para las bases de conocimiento
   ```
2. Se crean accesos directos en el Escritorio y el menú Inicio.
3. `Doriath.exe` comprueba `gh`/`git`, la sesión de GitHub, arranca el servidor y abre Chrome. Si ya hay una instancia en marcha, solo abre la pestaña.

Datos existentes en `data/`, `outputs/` y `knowledge-bases/` se conservan al reinstalar.

### Si el ejecutable sigue con el icono de Node

Windows solo sabe leer un icono comprimido en PNG dentro de un `.ico` **en el tamaño 256×256**. Los tamaños que dibuja el Explorador en las vistas de lista, detalles e iconos medianos (16, 24, 32 y 48) tienen que ir en el formato clásico DIB. Un `.ico` con todo en PNG se ve correcto en cualquier visor y en la pestaña de Propiedades, pero el Explorador cae al icono genérico. `public/brand/doriath.ico` se genera con `npm run icon` (Node puro, sin dependencias) y ya reparte los formatos como toca.

`npm run build` verifica el icono y lo dice al terminar (*"icono verificado (grupo 1, idioma 1033, 16/24/32/48/64/128/256 px)"*); falla si no puede ponerlo **o si algún tamaño por debajo de 256 viaja en PNG**. Así que si el build termina bien y Windows sigue enseñando el icono de Node:

1. Comprueba **qué fichero estás mirando**. `npm run build` regenera `dist\Doriath\Doriath.exe`, pero el acceso directo del Escritorio apunta a `%LOCALAPPDATA%\Doriath`, que conserva la versión anterior hasta que vuelvas a ejecutar el `Doriath-Setup.exe` recién construido.
2. Es la **caché de iconos del Explorador**, que guarda el icono por ruta y no se entera de que el fichero ha cambiado. Se limpia con `ie4uinit.exe -show` (o cerrando sesión). Para verlo sin tocar nada: clic derecho sobre el `.exe` → Propiedades, o míralo desde otra carpeta.

### Si Doriath no detecta tu sesión de GitHub

La sesión sale de la CLI `gh`. Si ya has hecho login y Doriath sigue pidiéndolo:

1. La propia pantalla de inicio de sesión muestra, bajo **"Qué ve Doriath al comprobar la sesión"**, el host configurado, qué ejecutable `gh` está usando, qué versión de Doriath se está ejecutando (con su commit y fecha de construcción) y la salida literal de `gh`. Si la sesión está en otro host (por ejemplo `github.com` en vez de `bbva.ghe.com`), se avisa explícitamente.
2. `npm run doctor` (o `Doriath.cmd doctor`) imprime lo mismo desde la consola, incluido el host configurado.
3. Si el host no es el correcto, cámbialo en **Ajustes → Host de GitHub Enterprise**.
4. Comprueba que estás ejecutando lo que acabas de construir: **Ajustes** muestra la ruta de instalación, la versión, el commit y la fecha de construcción. `npm run build` regenera `dist\Doriath`, pero el acceso directo del Escritorio apunta a la carpeta donde instalaste (`%LOCALAPPDATA%\Doriath`), que sigue con la versión anterior hasta que vuelvas a ejecutar el `Doriath-Setup.exe` nuevo.

Doriath no depende solo del código de salida de `gh auth status`: esa comprobación valida el token contra la API y en la red corporativa puede fallar por el proxy, los certificados o el SSO aunque la sesión sea válida. Cuando eso pasa, Doriath pide el token con `gh auth token` y, si existe, entra igualmente avisando de que no pudo validarlo. También busca `gh` fuera del PATH (la copia portable de `runtime/gh`, `%LOCALAPPDATA%\GitHubCLI` y `Program Files`), por si se instaló con Doriath ya abierto.

### Al seleccionar carpetas

El botón de elegir carpeta abre el **explorador de carpetas de Doriath**, no el diálogo de Windows: aquel depende de PowerShell y de que la ventana llegue a primer plano, y en equipos con la política restringida no llega a aparecer, dejando un botón que parece no hacer nada. El diálogo del sistema sigue disponible como atajo (*Selector de Windows*) dentro del propio explorador.

Las rutas se pueden pegar tal cual las copie Windows: *Copiar como ruta de acceso* las envuelve en comillas, y Doriath las quita (igual que los espacios sobrantes, la barra final y el prefijo `file://`).

### Si la ventana de Doriath.exe se cierra sola

`Doriath.exe` es una aplicación de consola: la ventana muestra los registros y, ante cualquier fallo, se queda abierta con "Pulsa una tecla para cerrar" (como FENIX). Si aun así se cierra sin mostrar nada:

1. Ejecuta `Doriath-Diagnostico.cmd` (junto a `Doriath.exe`): lanza el mismo ejecutable con la ventana fija y muestra el código de salida, incluso cuando el binario no llega a arrancar.
2. Revisa `data\logs\launcher.log`: recoge todo lo que imprime el launcher y el servidor (`data\logs\doriath.log` tiene el registro del servidor). Envíalo si pides ayuda.
3. Como alternativa, `Doriath.cmd` arranca el servidor directamente con el Node portable, sin pasar por el ejecutable.

`Doriath.exe` es un `node.exe` con el launcher inyectado (Node SEA) y no va firmado: si la política del equipo bloquea ejecutables sin firma, aparece un aviso de Windows o el proceso termina al instante; en ese caso usa `Doriath.cmd` o firma el binario.

## Desarrollo

```bash
npm run setup        # instala dependencias (con reintento contra npmjs si el Artifactory corporativo devuelve 401/403)
npm start            # arranca en http://127.0.0.1:4410 y abre el navegador
npm run doctor       # diagnóstico: gh, git, sesión, Copilot y modelos
npm run models       # catálogo real de modelos de la licencia
npm run check        # sintaxis de todos los módulos
npm test             # tests unitarios (node:test)
```

### Dependencias en la red BBVA

En un equipo corporativo `npm install` resuelve contra el Artifactory interno (`Npm_Virtual2`), que responde `401/403 Forbidden` (realm `Artifactory Realm`) cuando no hay credenciales válidas. `npm run setup` aplica el mismo criterio que `scripts/install.ps1` de FENIX:

1. Prueba `npm install` con la configuración del usuario.
2. Si el registro rechaza las descargas por autenticación, reintenta con `npm install --registry https://registry.npmjs.org/ --package-lock=false --no-audit` confiando en los certificados del sistema: `NODE_OPTIONS=--use-system-ca` cuando el Node lo admite (22.15 o superior; el Node portable del instalador lo admite) y, en todo caso, las CA del almacén de Windows exportadas a `.cache/system-ca-bundle.pem` vía `NODE_EXTRA_CA_CERTS`. El `.npmrc` del usuario no se modifica; queda un `.npmrc` de proyecto (ignorado por git) para las siguientes instalaciones.
3. Si npmjs también está bloqueado, hacen falta credenciales del Artifactory (`npm login --registry http://cibartifactory.igrupobbva:8084/artifactory/api/npm/Npm_Virtual2/`) o construir el instalador desde un equipo con salida a Internet e instalar el `.exe` resultante, que ya lleva todas las dependencias.

`npm run build:dist` usa el mismo mecanismo al instalar las dependencias del payload, y `Doriath.exe` lo repite si en el equipo destino falta alguna dependencia en `app/node_modules`.

### Proxy de salida

FENIX arranca siempre con el proxy local corporativo de Ivanti (`http://127.0.0.1:8999`). Doriath no lo activa por defecto; si tu red lo exige, ponlo en `data/config.json` (`network.proxyUrl`) o arranca con `--proxy http://127.0.0.1:8999` (o `DORIATH_PROXY`). Se aplica a gh, git, el runtime Copilot y las descargas del launcher.

Variables útiles: `DORIATH_HOME` (carpeta de datos), `DORIATH_PORT`, `DORIATH_GITHUB_HOST`, `DORIATH_VERBOSE=1`.

En desarrollo los datos van a `~/.doriath`; instalado, a `<raíz>/data`. La configuración está en `data/config.json` (host GitHub, modo de autenticación Copilot, carpetas, prefijo de ramas) y también se edita desde **Ajustes**.

## Build del instalador

```bash
npm run build:dist   # dist/Doriath: app + node_modules (paquete Copilot win32-x64) + Node portable
npm run build:exe    # dist/Doriath/Doriath.exe y dist/Doriath-Setup.exe (Node SEA + postject)
npm run build        # ambos
npm run icon         # regenera public/brand/doriath.ico desde public/brand/doriath-icon.png
```

- `build:dist` copia por defecto el `node_modules` ya probado del checkout (como FENIX) y retira las dependencias de desarrollo con `npm prune --omit=dev`; con `--fresh`, o al construir desde otra plataforma, reinstala desde el registro con el mismo reintento que `npm run setup`. En ambos casos comprueba que el runtime nativo de Copilot (`@github/copilot-win32-x64`) está en el payload y, si npm no lo seleccionó, lo instala explícitamente. También descarga el Node portable indicado en `scripts/launcher/tools.json`.
- `build:exe` empaqueta `scripts/launcher/launcher.cjs` y `setup.cjs` con esbuild, genera los blobs SEA e inyecta cada uno con `postject` en una copia de `node.exe`. Al construir en Windows el blob se genera con el propio `node.exe` portable (misma versión que ejecutará el launcher); desde otra plataforma se usa el Node del sistema.
- Después, `resedit` (JavaScript puro, sin binarios que descargar) pone en los dos ejecutables el icono `public/brand/doriath.ico` —siete resoluciones, de 16 a 256 px, las seis pequeñas en DIB y la de 256 en PNG— y los datos de versión, y de paso descarta la firma que `node.exe` traía y que `postject` deja inservible. Al terminar el build relee los dos ejecutables y comprueba que el icono está y que ningún tamaño pequeño va en PNG (ver *Si el ejecutable sigue con el icono de Node*).
- El payload va **pegado detrás** del instalador con un pie de 32 bytes que dice dónde empieza, como un autoextraíble clásico: incrustarlo como recurso SEA reventaba `postject` a partir de unos cientos de megas.
- `build:dist` retira del payload los runtimes de Copilot de otras plataformas (cada uno ocupa unos 300 MB), que aparecen al construir el paquete de Windows desde otro sistema.
- Los ejecutables no van firmados; firma Authenticode aparte si la política lo exige. Con `--platform linux` se generan binarios Linux para validar la mecánica.
- **Espacio en disco**: el build necesita unos 3 GB libres (payload ~600 MB, instalador ~750 MB entre zip y exe, más la caché de npm con el runtime de Copilot, ~300 MB). Los scripts lo comprueban antes de empezar y retiran los intermedios al terminar. Si la unidad del repositorio va justa, construye en otra con `DORIATH_DIST=D:\doriath-dist npm run build`. Con el disco lleno, npm descarta en silencio el runtime de Copilot por ser una dependencia opcional.

## Estructura del código

```
src/
├── cli.mjs, main.mjs, server.mjs      arranque, servidor HTTP (node:http), SSE
├── config.mjs, paths.mjs              configuración y rutas (dev vs instalado)
├── auth/gh.mjs                        sesión GitHub vía gh (token efímero, login en consola)
├── ai/                                Copilot SDK (cliente, sesiones, herramientas, permisos), prompts, YAML del modelo
├── kdd/                               núcleo KDD: layout, frontmatter, ids, secciones, store, grafo, BM25
├── knowledge/                         bases de conocimiento, documentos, extractores, analizador en dos fases
├── assistant/                         chats (assistant/work/knowledge/resolution), generadores docx/xlsx/pptx/html, salidas
├── work/                              repositorios locales, paquetes Work, ejecuciones con git
└── routes/                            API JSON
public/                                frontend (HTML/CSS/JS sin bundler) con identidad BBVA × NFQ
prompts/, kdd-reference/               prompts y preámbulo canónico de KDD Studio
scripts/                               build, launcher e instalador
docs/                                  FENIX-core.md, kdd-studio-funcionamiento.md, identidad BBVA, módulos de referencia de FENIX
```

## Maqueta interactiva

`docs/demo/doriath-demo.html` es una maqueta autónoma del frontal (un solo fichero, sin servidor ni dependencias): ábrela con doble clic en cualquier navegador. Lleva datos ficticios en memoria y un conmutador **Usuario / Admin** en la cabecera, porque la aplicación enseña dos caras muy distintas de la misma base de conocimiento:

- **Usuario** — *My Knowledge Bases*: sin una sola palabra de KDD. Sube documentos, Doriath "aprende" de ellos y contesta preguntas; si una respuesta no encaja, se corrige desde el propio chat y queda aprendida. Nunca se le habla de specs, capas ni IDs. Tiene también el asistente y el módulo de Knowledge-Driven Development.
- **Admin** — *Knowledge Bases Studio*: panel de salud (grafo, total de specs y reparto por capa ARCH/DOM/PROD/FEAT…), documentos con quién los incluyó y qué specs generaron, catálogo de specs con análisis y edición, gobernanza (ADR, RFC y reglas con responsable y estado) y un registro de actividad con quién ha cambiado qué y desde dónde.

Las dos vistas arrancan con un selector de bases de conocimiento, para elegir primero sobre cuál trabajas y después moverte por su menú. Las dos caras están conectadas: una corrección hecha por el usuario desde el chat aparece en el registro del administrador como un cambio en la spec correspondiente, listo para revisar.

## Identidad visual

La interfaz y los documentos generados siguen `docs/identidad-bbva`: paleta (Electric Blue, Serene, Sand, Midnight y acentos), tipografías Source Serif 4 y Lato (empaquetadas en `public/fonts`), cajas bentō con radios 16/24, retícula de 8 px, logo BBVA primario y NFQ como autoría. Los logos con transparencia de `public/brand` se derivan de los originales de la guía.
