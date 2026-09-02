# Doriath

Workbench local para BBVA CIB que une la operativa de **FENIX** (sesión corporativa de GitHub con `gh`, agente **GitHub Copilot** sin BYOK, trabajo sobre repositorios Git) con la metodología de **KDD Studio** (Knowledge-Driven Development: conocimiento como specs versionadas que se activan como contexto del trabajo).

Se ejecuta en el equipo del usuario: un servidor Node en `127.0.0.1` y una pestaña en Chrome. No hay backend remoto ni base de datos: el estado vive en ficheros.

## Módulos

| Módulo | Qué hace |
|---|---|
| **Knowledge Base Studio** | Importa documentos (PDF, Word, Excel, PowerPoint, Markdown, texto, código) a una base de conocimiento local y genera specs KDD con el analizador en dos fases de KDD Studio (átomos → plan de curación → bodies). Preview con preguntas abiertas y chat de resolución antes de persistir. Catálogo, edición, grafo e impacto. |
| **BBVA CIB Assistant** | Chat con contexto de todas las bases de conocimiento (herramientas de consulta, no memoria). Genera entregables con la identidad BBVA × NFQ: Word, Excel, PowerPoint, HTML, Markdown, código. |
| **Knowledge-Driven Development** | Entrevista en 4 fases (entender, clasificar, validar, generar) que produce la iniciativa WRK-SPEC con sus planes y tareas, detecta los repositorios necesarios (carpetas locales con `.git`), y ejecuta cada tarea con Copilot sobre el repositorio: diff revisable, commit, push y pull request. |

Las bases de conocimiento son carpetas locales con la misma disposición que las fuentes locales de KDD Studio (`specs/<capa>/…`, `docs-tecnicos/`, `.kdd-studio/`), así que son intercambiables.

## Requisitos en el equipo (Windows)

- **GitHub CLI** (`gh`) con sesión en `bbva.ghe.com`. Si falta, el launcher descarga una versión portable y abre el inicio de sesión (`gh auth login --web`).
- **Git**. Si falta, el launcher descarga MinGit portable.
- Licencia de **GitHub Copilot** en la cuenta corporativa. Doriath pasa al runtime el token de la sesión de `gh` y, si no vale, usa la sesión propia del runtime (`copilot login --host bbva.ghe.com`).
- Chrome (opcional): se abre una pestaña nueva en la instancia en ejecución; sin Chrome se usa el navegador predeterminado.

No hace falta Node instalado: el instalador incluye un Node portable.

## Instalación (usuario final)

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
```

- `build:dist` copia por defecto el `node_modules` ya probado del checkout (como FENIX) y retira las dependencias de desarrollo con `npm prune --omit=dev`; con `--fresh`, o al construir desde otra plataforma, reinstala desde el registro con el mismo reintento que `npm run setup`. En ambos casos comprueba que el runtime nativo de Copilot (`@github/copilot-win32-x64`) está en el payload y, si npm no lo seleccionó, lo instala explícitamente. También descarga el Node portable indicado en `scripts/launcher/tools.json`.
- `build:exe` empaqueta `scripts/launcher/launcher.cjs` y `setup.cjs` con esbuild, genera los blobs SEA e inyecta cada uno con `postject` en una copia de `node.exe`. Al construir en Windows el blob se genera con el propio `node.exe` portable (misma versión que ejecutará el launcher); desde otra plataforma se usa el Node del sistema. El instalador lleva `dist/payload.zip` como asset embebido.
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

## Identidad visual

La interfaz y los documentos generados siguen `docs/identidad-bbva`: paleta (Electric Blue, Serene, Sand, Midnight y acentos), tipografías Source Serif 4 y Lato (empaquetadas en `public/fonts`), cajas bentō con radios 16/24, retícula de 8 px, logo BBVA primario y NFQ como autoría. Los logos con transparencia de `public/brand` se derivan de los originales de la guía.
