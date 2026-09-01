# Arquitectura y funcionamiento core de FENIX

## 1. Proposito y limites

FENIX es un workbench agentico local para Windows. Expone una aplicacion HTTP en
`127.0.0.1`, coordina GitHub Copilot u OpenAI Codex y ejecuta workflows sobre
repositorios Git.

Este documento se concentra en:

- construccion, empaquetado e instalacion;
- arranque del backend;
- autenticacion de GitHub y GitHub Copilot;
- configuracion, clonacion y aislamiento de repositorios;
- ejecucion end-to-end de workflows, especialmente los de desarrollo;
- persistencia, cancelacion, reanudacion y trazabilidad.

Se omiten deliberadamente las integraciones de bases de datos y el detalle de la
estructura visual del frontend.

## 2. Vista arquitectonica

```text
Usuario
  |
  | navegador local / ventana Chromium --app
  v
Frontend estatico (public/)
  |
  | HTTP JSON contra 127.0.0.1
  v
Servidor Node.js (src/server.mjs)
  |
  +-- configuracion y estado local (.workbench/)
  +-- motor de workflows (src/workflow/)
  +-- adaptador de IA (src/ai-runtime.mjs)
  |     +-- GitHub Copilot SDK
  |     `-- OpenAI Codex SDK
  +-- Git / gh CLI
  +-- GitHub / GitLab / SonarQube
  `-- repositorios y worktrees locales
```

La aplicacion no necesita un servidor remoto propio ni una base de datos central
para operar. El estado autoritativo se guarda en ficheros bajo `.workbench/`.
Las comunicaciones externas se producen al acceder a GitHub, GitLab, Copilot,
Codex, SonarQube, registros de paquetes o remotos Git.

Los puntos de entrada principales son:

- `src/cli.mjs`: CLI, resolucion de proyecto, proxy y comandos operativos.
- `src/main.mjs`: arranque minimo del servidor desde una configuracion.
- `src/server.mjs`: servidor HTTP, rutas API y estaticos.
- `src/ai-runtime.mjs`: seleccion explicita entre Copilot y Codex.
- `src/workflow/run-lifecycle.mjs`: maquina de estados de los runs.
- `src/workflow/step-handlers/`: implementacion de cada clase de paso.
- `src/integrations/`: Git, GitHub, GitLab, Copilot, Codex, Sonar y procesos.

## 3. Build y distribucion

### 3.1 Dependencias de desarrollo y runtime

El proyecto es ESM (`"type": "module"`) y exige Node.js `>=22.12.0`. Sus dos
dependencias agenticas principales son:

- `@github/copilot-sdk`;
- `@openai/codex-sdk`.

No existe un bundler de frontend ni una compilacion TypeScript. El codigo
JavaScript `.mjs` y los recursos de `public/` se distribuyen como ficheros de
runtime. El build es principalmente un proceso de ensamblado y empaquetado.

Comandos relevantes:

```powershell
npm install
npm run check
npm test
npm run build:dist
npm run build:installer
```

`npm run check` ejecuta controles propios sobre el codigo y los imports del
frontend. `npm test` usa el test runner nativo de Node y genera cobertura LCOV.

### 3.2 Construccion del payload

`scripts/build-dist.mjs` crea:

```text
dist/
`-- FENIX/
```

Primero elimina `dist/` y copia los elementos necesarios en runtime:

```text
src/
public/
scripts/
workflows/
workflow-assets/
prompts/
global-agents/
docs/
package.json
README.md
Guia.md
```

Despues prepara dependencias de produccion de una de estas formas:

- modo normal: copia el `node_modules/` ya probado en el checkout;
- `--fresh`: ejecuta `npm install --omit=dev` dentro del payload.

El modo normal pretende empaquetar exactamente el arbol probado. El propio
script advierte que el proyecto no basa su reproducibilidad en reinstalar desde
un lockfile durante este paso.

Si estan disponibles, incorpora tambien runtimes portables:

```text
dependencies/node-v22.23.1-win-x64/
dependencies/gh_2.96.0_windows_amd64/
dependencies/MinGit-2.55.0.3-64-bit/
```

La ausencia de alguno no invalida necesariamente el payload: los scripts
`ensure-node.ps1`, `ensure-gh.ps1` y `ensure-git.ps1` pueden descargarlo mas
tarde. Oracle Instant Client no se redistribuye y se obtiene aparte cuando el
usuario acepta su licencia.

El build escribe dos sellos:

- `dist/FENIX/BUILD.json`: version, fecha y, si esta disponible,
  commit de origen;
- `installer/version.iss`: version de `package.json` para Inno Setup.

### 3.3 Construccion del instalador

`scripts/build-installer.ps1`:

1. resuelve `node.exe`;
2. obtiene el commit con `git rev-parse HEAD`;
3. exporta temporalmente `FENIX_BUILD_COMMIT`;
4. ejecuta `scripts/build-dist.mjs`;
5. localiza Inno Setup 6 (`ISCC.exe`);
6. compila `installer\fenix.iss`;
7. comprueba que existe `dist\FENIX-Setup-<version>.exe`;
8. calcula SHA-256 y crea el fichero `.sha256`.

El resultado contractual es:

```text
dist/FENIX-Setup-<version>.exe
dist/FENIX-Setup-<version>.exe.sha256
```

El script presupone que el arbol fuente contiene la definicion Inno Setup
`installer\fenix.iss`.

### 3.4 Flujo de release

`scripts/release-version.ps1` solo permite publicar desde `main`, valida que la
version sea SemVer, comprueba tags y ramas remotas y exige un ticket Jira.
Despues:

1. crea `release/<version>`;
2. actualiza `package.json` y `package-lock.json`;
3. ejecuta `npm run check` y `npm test`;
4. crea commit y push;
5. abre una pull request de release mediante `gh pr create`.

Tras el merge, la automatizacion de la plataforma debe crear la release y
construir/publicar el instalador y su checksum. `scripts/publish-release.ps1`
verifica version, commit, hash y firma Authenticode antes de subir los assets
con `gh release upload`.

## 4. Instalacion en Windows

El instalador coloca FENIX bajo `%LOCALAPPDATA%\FENIX` sin requerir permisos de
administrador. La configuracion inicial ejecuta `scripts/install.ps1`.

El asistente realiza siete fases:

1. **Node.js**: usa o descarga la version portable fijada.
2. **Oracle Instant Client**: preparacion opcional.
3. **Git**: usa el existente o MinGit portable.
4. **GitHub CLI**: usa `gh` del `PATH` o descarga/copia la version portable.
5. **Autenticacion GitHub Enterprise**.
6. **Dependencias npm**: ejecuta `npm install`; si el registro corporativo
   rechaza la descarga por autenticacion, puede reintentar contra npmjs usando
   certificados del sistema.
7. **Proyecto inicial**: ejecuta `npm run init-project`.

El `gh` portable se instala para el usuario y su carpeta `bin` se agrega al
`PATH` de usuario. MinGit se usa de forma distinta: durante el arranque se
antepone al `PATH` del proceso de FENIX, sin reemplazar el Git del usuario.

## 5. Identidades y autenticacion

### 5.1 Hay dos responsabilidades diferentes

FENIX distingue:

- **GitHub/Git**: acceso a repositorios, API REST, pull requests, clone y push.
- **GitHub Copilot**: acceso a modelos y ejecucion del agente mediante una
  licencia de Copilot.

Tambien separa dos hosts configurables:

```json
{
  "github": {
    "host": "bbva.ghe.com"
  },
  "copilot": {
    "host": "bbva.ghe.com",
    "authentication": "signed-in-user",
    "allowByok": false
  }
}
```

Aunque normalmente coinciden, `github.host` y `copilot.host` no se mezclan
automaticamente porque una topologia Enterprise puede alojar codigo y Copilot
de forma diferente.

### 5.2 Login de GitHub CLI

Durante `install.ps1`, FENIX comprueba:

```powershell
gh auth status --hostname bbva.ghe.com
```

Si no hay sesion, pregunta al usuario y puede ejecutar:

```powershell
gh auth login `
  --hostname bbva.ghe.com `
  --web `
  --clipboard `
  --git-protocol https
```

`gh` abre el navegador y GitHub Enterprise puede redirigir al SSO corporativo.
La autenticacion, MFA y federacion pertenecen a GitHub y al proveedor de
identidad corporativo; FENIX no recibe la contrasena ni implementa ese OAuth.

Tras autenticar, el instalador ejecuta:

```powershell
gh auth setup-git --hostname bbva.ghe.com
```

Esto es importante cuando se usa MinGit, porque MinGit no incluye Git Credential
Manager. Git queda enlazado con el helper de credenciales de `gh`.

Para sus llamadas REST, FENIX obtiene temporalmente el token mediante:

```powershell
gh auth token --hostname <github.host>
```

`src/integrations/github.mjs` mantiene el resultado como una promesa en memoria
durante 30 segundos para coalescer peticiones concurrentes. No lo persiste en
sus propios ficheros.

Para clonar repositorios GitHub usa:

```powershell
gh repo clone <url> <destino>
```

Por tanto, el acceso GitHub de FENIX depende de una sesion valida de `gh`.

### 5.3 Login y uso de GitHub Copilot

FENIX no admite BYOK para Copilot. `config.mjs` solo acepta:

```text
copilot.authentication = signed-in-user
```

Al crear un cliente, `src/integrations/copilot.mjs` hace conceptualmente:

```javascript
new CopilotClient({
  workingDirectory,
  baseDirectory: "<storage>/copilot-home",
  useLoggedInUser: true,
  env: entornoSaneado,
  telemetry,
  logLevel: "warning"
});
```

Las decisiones importantes son:

- no se pasa `gitHubToken`;
- `useLoggedInUser: true` ordena al runtime oficial reutilizar la identidad
  autenticada;
- `GH_HOST` se fija a `config.copilot.host`;
- `COPILOT_HOME` se controla mediante `baseDirectory`;
- se eliminan del proceso hijo claves como `OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, `AZURE_OPENAI_API_KEY`, `GOOGLE_API_KEY` y credenciales
  AWS, evitando que el runtime use accidentalmente otro proveedor;
- el SDK arranca el runtime Copilot oficial en modo headless y no desactiva su
  mecanismo de usuario autenticado.

FENIX delega al runtime oficial el descubrimiento y uso de la sesion. No conoce
la contrasena ni guarda una API key de Copilot. Si el runtime no encuentra una
identidad licenciada util, la consulta de modelos o la ejecucion falla. El
diagnostico indica entonces que se revise la autenticacion y, para GHE.com,
propone:

```powershell
copilot login --host bbva.ghe.com
```

Es importante no confundir esta identidad con el token REST obtenido mediante
`gh auth token`: son interfaces y responsabilidades distintas, aunque ambas
terminen representando al mismo usuario corporativo.

### 5.4 Comprobacion de disponibilidad

La disponibilidad real no se decide por una bandera local. FENIX crea un
`CopilotClient`, lo arranca y consulta:

```javascript
client.listModels()
client.rpc.account.getQuota({})
```

Si la cuenta, licencia y politica organizativa permiten Copilot, recibe el
catalogo efectivo de modelos y su cuota. Un modelo configurado explicitamente
se rechaza si no aparece en ese catalogo.

El comando:

```powershell
npm run doctor -- --provider copilot
```

comprueba, entre otros elementos:

- disponibilidad de Node y Git;
- sesion de `gh` contra `github.host`;
- repositorios configurados;
- agentes y skills detectados;
- autenticacion Copilot;
- catalogo de modelos y compatibilidad del modelo seleccionado.

El comando:

```powershell
npm run models -- --provider copilot
```

lista los modelos realmente habilitados para esa identidad y licencia.

### 5.5 Cambio o perdida de sesion

Si se cierra la sesion de `gh`, las operaciones GitHub que soliciten un token o
usen `gh repo clone` fallan con un mensaje que pide ejecutar `gh auth login`.
El servidor normal no abre por si solo un prompt interactivo.

Para cambiar la identidad GitHub:

```powershell
gh auth logout --hostname bbva.ghe.com
gh auth login --hostname bbva.ghe.com --web --clipboard --git-protocol https
```

Si hay varias identidades registradas, puede usarse el mecanismo de seleccion
de cuenta ofrecido por la version instalada de `gh`.

Para renovar la identidad que usa el runtime Copilot:

```powershell
copilot login --host bbva.ghe.com
```

Conviene reiniciar FENIX despues de un cambio de identidad, porque las sesiones
de chat Copilot pueden conservar un proceso vivo durante varios turnos.

## 6. Configuracion y proyectos

Un proyecto FENIX representa un conjunto de unidades logicas de repositorio.
Su configuracion vive en:

```text
.workbench/projects/<projectId>/workbench.config.json
```

`src/config.mjs` carga, valida y transforma las rutas relativas en absolutas.
Los elementos principales son:

- identidad y nombre del proyecto;
- servidor local (`127.0.0.1:4310` por defecto);
- hosts GitHub/Copilot/GitLab;
- repositorios y ramas objetivo;
- workflows, prompts y agentes;
- almacenamiento operativo;
- perfiles de seguridad;
- limites de entrada y adjuntos.

Una entrada de `repositories[]` es una **unidad logica**. Varias unidades pueden
apuntar a una unica URL fisica, por ejemplo varios modulos de un monorepo.

Cada unidad contiene, entre otros:

- `id`: identidad logica;
- `url`: remoto fisico;
- `platform`: `github` o `gitlab`;
- `targetBranch`: rama base;
- `repoKey`: identidad estable del clon fisico compartido;
- `projectPath`: subcarpeta de la unidad dentro del repositorio;
- comandos de instalacion, tests y analisis;
- metadatos del stack detectado.

Al cargar la configuracion se derivan:

```text
rootPath = <projectBase>/repos/<repoKey>
path     = <rootPath>/<projectPath>
```

## 7. Repositorios: deteccion, clon y aislamiento

### 7.1 Alta sin clonacion inmediata

Al dar de alta un repositorio, FENIX puede consultar el remoto para descubrir
manifiestos, modulos y referencias. Operaciones como `git ls-remote` no
requieren un clon.

El clon se crea de forma perezosa la primera vez que una ejecucion necesita
trabajar realmente sobre ese repositorio.

### 7.2 Clon canonico

La ubicacion del clon gestionado es:

```text
.workbench/projects/<projectId>/repos/<repoKey>/
```

Todas las unidades con la misma URL comparten el mismo `repoKey` y, por tanto,
un solo clon canonico. `repoKey` se persiste para que reordenar o eliminar
unidades no cambie la carpeta ni fuerce una reclonacion.

`ensureRepositoryCloned()`:

1. comprueba si `repository.rootPath` ya existe;
2. crea la carpeta padre;
3. clona segun la plataforma;
4. no hace nada si el clon ya esta presente.

Para GitHub:

```powershell
gh repo clone <repository.url> <repository.rootPath> -- -c core.longpaths=true
```

Para GitLab usa `git clone`. El PAT se pasa como
`http.extraheader=Authorization: Basic ...` en esa invocacion, no dentro de la
URL, para que no quede persistido en `.git/config`.

En Windows se aplica `core.longpaths=true` por comando para reducir errores de
`MAX_PATH` sin cambiar la configuracion global del usuario.

### 7.3 Actualizacion desde el remoto

Antes de preparar un run, FENIX realiza `git fetch origin` sobre el clon
canonico. La rama objetivo procede de `repository.targetBranch` y tiene
`develop` como fallback historico.

El clon canonico funciona como cache Git y origen de worktrees. Los pasos de un
run no deben modificarlo directamente.

### 7.4 Worktrees por ejecucion

Cada run obtiene un worktree aislado por unidad:

```text
.workbench/projects/<projectId>/storage/wt/<runHash>/<repositoryId>/
```

La preparacion ejecuta, en esencia:

```powershell
git worktree add --detach <worktree> origin/<targetBranch>
```

Si la unidad declara sparse checkout, primero crea el worktree con
`--no-checkout`, aplica el patron y despues hace checkout.

Consecuencias del diseño:

- dos runs pueden trabajar en paralelo sobre el mismo remoto;
- cada unidad logica tiene su directorio, incluso dentro de un monorepo;
- el checkout del usuario no se toca;
- una pausa por aprobacion conserva rama, commits y cambios;
- una reanudacion reutiliza el worktree registrado;
- un fallo conserva el worktree para inspeccion o relanzamiento;
- una finalizacion correcta permite limpiar los worktrees.

Al pasar los repositorios preparados a los handlers, FENIX reemplaza
temporalmente:

```text
repository.rootPath -> raiz del worktree
repository.path     -> raiz del worktree + projectPath
```

Por eso los handlers operan sobre el aislamiento sin tener que conocer el clon
canonico.

## 8. Arranque completo de la aplicacion

El acceso directo ejecuta `scripts/launch.ps1`.

### 8.1 Preparacion del launcher

El launcher:

1. localiza o descarga Node, Git y `gh`;
2. antepone MinGit al `PATH` del proceso;
3. comprueba o repara `node_modules`;
4. lee el puerto del proyecto;
5. detecta otra instancia mediante `/api/health`;
6. detiene la instancia anterior identificando su PID;
7. configura el proxy;
8. arranca el proceso Node.

El comando resultante es equivalente a:

```powershell
node src/cli.mjs start `
  --project <projectId> `
  --proxy <proxyUrl> `
  --quiet-proxy
```

`FENIX_LAUNCHER_PID` enlaza el ciclo de vida del servidor con la consola del
launcher. Si el padre desaparece, `closeServerWhenParentExits()` cierra el
servidor y sus conexiones.

### 8.2 Backend

`src/cli.mjs`:

1. interpreta el comando;
2. resuelve proyecto o modo bootstrap;
3. carga la configuracion;
4. aplica proveedor e idioma globales;
5. prepara variables de proxy;
6. llama a `startServer(config)`.

`src/server.mjs` crea un servidor con `node:http`. No usa Express. Para cada
peticion:

1. calcula proyecto y contexto;
2. superpone ajustes globales;
3. prueba secuencialmente los grupos de rutas;
4. sirve `public/` si no coincide una API;
5. devuelve JSON de error ante una excepcion.

Al iniciar tambien:

- crea el pool de sesiones de chat;
- crea el almacen de agentes;
- reconcilia runs que quedaron activos tras una caida;
- mantiene contextos por proyecto;
- registra metricas de rendimiento.

El launcher sondea:

```text
GET http://127.0.0.1:<port>/api/health
```

Cuando recibe 200, abre Edge o Chrome con `--app=<url>`. Si no encuentra un
navegador Chromium, abre el navegador predeterminado.

## 9. Motor de workflows

### 9.1 Definicion declarativa

Los workflows incluidos viven en `workflows/*.json`. Un workflow declara:

- identidad, nombre, track y descripcion;
- si necesita escritura;
- inputs obligatorios;
- modelo orquestador recomendado;
- secuencia de `steps`.

Cada paso define un `scope`. `src/workflow/step-handlers/index.mjs` lo traduce a
un handler:

| Scope | Responsabilidad |
|---|---|
| `each-repository` | Analisis IA por repositorio |
| `each-repository-implementation` | Edicion de codigo |
| `each-repository-command` | Comandos nativos |
| `each-repository-git-diff` | Inspeccion de cambios Git |
| `each-repository-sonar` | Analisis y quality gate |
| `each-repository-gitlab` | Push y MR/PR |
| `each-repository-pr-comments` | Resolucion de comentarios |
| `aggregate` | Sintesis global |
| `aggregate-docs` | Documentacion agregada |
| `approval` | Pausa y decision humana |

### 9.2 Creacion de un run

El frontend envia:

```text
POST /api/runs
```

`src/routes/runs.mjs` valida:

- longitud minima del requisito;
- existencia del workflow;
- Jira cuando sea obligatorio;
- cantidad de repositorios;
- referencias, adjuntos y ajustes avanzados.

Luego llama a `createAndStartRun()` y responde `202 Accepted`.

El run se persiste inmediatamente con:

```text
status = evaluating
steps = []
runtime.nextStepIndex = 0
runtime.outputByStep = {}
```

Esto desacopla la respuesta HTTP de la ejecucion larga y permite que el cliente
consulte el progreso.

### 9.3 Evaluacion y aclaraciones

Antes de tocar repositorios, FENIX:

1. resuelve proveedor y modelo;
2. aplica esfuerzo de razonamiento y tier de contexto;
3. registra idioma, repositorios, adjuntos y Jira;
4. pide a la IA, sin herramientas de filesystem, que determine si faltan datos
   imprescindibles.

Si faltan datos:

```text
evaluating -> needs-clarification
```

El run se pausa. Las respuestas del usuario se agregan al contexto y la
ejecucion continua. Si no hacen falta:

```text
evaluating -> queued -> running
```

### 9.4 Preparacion del entorno

`executeRunInternal()`:

1. restaura la configuracion exacta del run;
2. crea un token de cancelacion;
3. marca la fase de preparacion;
4. crea o reutiliza worktrees;
5. ejecuta discovery del proyecto;
6. carga bindings, rendimiento historico y cache de agentes;
7. restaura consumo de intentos anteriores si es un relanzamiento.

### 9.5 Bucle de pasos

Para cada paso, el motor:

1. comprueba cancelacion;
2. evalua si necesita aprobacion;
3. persiste `nextStepIndex` y outputs antes de pausar;
4. resuelve el handler por `scope`;
5. elimina del paso los repositorios declarados sin impacto;
6. aplica overrides de modelo, razonamiento, contexto y agente;
7. invoca el handler;
8. agrega outputs, eventos, artifacts y consumo;
9. continua o pausa segun el resultado.

Los pasos por repositorio usan concurrencia limitada. La salida de pasos
anteriores se conserva en `outputByStep` y se inserta en prompts posteriores.
Existe un presupuesto de caracteres para evitar que la concatenacion de outputs
anteriores desborde el contexto del modelo.

## 10. Ejecucion de Copilot dentro de un paso

`src/ai-runtime.mjs` selecciona exactamente un proveedor. Si el run pide
Copilot, llama a `executeCopilotStep()`. Un error Copilot no provoca un cambio
silencioso a Codex.

La secuencia es:

1. comprobar cancelacion;
2. crear `CopilotClient`;
3. arrancar el runtime;
4. leer el catalogo y validar modelo/tier/esfuerzo;
5. construir herramientas y perfil de permisos;
6. crear una sesion streaming;
7. registrar listeners de eventos;
8. enviar el prompt;
9. validar la respuesta y reintentar si el paso lo exige;
10. recopilar contenido, fuentes y consumo;
11. desconectar sesion y parar cliente.

### 10.1 Perfiles de herramientas

| Perfil | Herramientas base |
|---|---|
| `no-tools` | ninguna |
| `analysis-readonly` | `grep`, `glob`, `view` |
| `implementation-guarded` | lectura, `edit`, `create` |
| `implementation` | lectura, `edit`, `create` |

`createPermissionHandler()` aplica una segunda barrera:

- `no-tools`: rechaza todo;
- `analysis-readonly`: solo aprueba operaciones de lectura;
- `implementation-guarded`: rechaza escritura/shell sin canal de aprobacion;
- `implementation`: aprueba las solicitudes del runtime.

Cuando un paso permite subagentes, agrega la herramienta `task`, agentes
personalizados y eventos de streaming de subagentes.

### 10.2 Sistema de mensajes

La sesion combina:

- rol e instrucciones del agente;
- skills seleccionadas;
- contexto del repositorio;
- idioma de salida;
- instrucciones especificas del paso.

El prompt del workflow interpola valores como:

```text
{{requirement}}
{{repository.name}}
{{repository.kind}}
{{repositoryImpact}}
{{previousOutputs}}
```

### 10.3 Streaming, bucles y respuestas largas

El listener procesa:

- `assistant.message`;
- `assistant.usage`;
- comienzo y fin de herramientas;
- subagentes;
- continuaciones automaticas por agotamiento del presupuesto de salida.

FENIX reconstruye respuestas que Copilot haya partido en varios turnos. Tambien
registra como evidencia las rutas consultadas mediante herramientas de lectura.

`copilot-loop-guard.mjs` detecta repeticion sin progreso:

- llamadas identicas;
- inspeccion repetida del mismo objetivo;
- demasiados subagentes;
- profundidad excesiva;
- delegacion repetida de la misma tarea.

Ante un bucle:

1. aborta la exploracion;
2. conserva lo ya producido;
3. solicita un ultimo informe sin herramientas;
4. solo falla si tampoco puede emitir contenido valido.

### 10.4 Cancelacion

Cada run tiene un `cancellationToken`. Mientras hay una sesion activa, el token
registra:

```javascript
session.abort()
```

Esto corta la peticion en curso y evita esperar al timeout. El motor vuelve a
comprobar el token entre pasos porque puede solicitarse una cancelacion cuando
no existe una sesion activa.

### 10.5 Consumo

Los eventos `assistant.usage` acumulan:

- tokens de entrada y salida;
- lecturas y escrituras de cache;
- tokens de razonamiento;
- modelos usados;
- AIU/nano-AIU;
- coste de premium requests comunicado por Copilot.

Antes de desconectar, FENIX intenta reconciliar:

```javascript
session.rpc.usage.getMetrics()
```

Si esa API experimental no esta disponible, conserva la suma de eventos. Los
tokens son telemetria tecnica; la unidad de consumo real de Copilot procede del
runtime/licencia y no se estima a partir del numero de tokens.

## 11. Workflow de desarrollo completo

El workflow `code-implementation.json` implementa:

```text
requisito + Jira
  -> analisis de impacto
  -> implementacion
  -> aprobacion
  -> preparacion/instalacion
  -> tests
  -> autofix
  -> Sonar
  -> push y MR/PR
  -> documentacion final
```

### 11.1 Analisis de impacto

El paso `repository-impact` corre una sesion de solo lectura por repositorio.
Pide:

- decidir si el requisito impacta esa unidad;
- identificar componentes y ficheros;
- describir cambios y tests;
- producir un `phase-plan` si el cambio es complejo.

El modelo puede devolver:

```json
{
  "applies": false,
  "reason": "El cambio pertenece a otra unidad",
  "detectedRepo": "otro-repositorio"
}
```

dentro de un bloque `json:relevance`. Los repositorios sin impacto quedan fuera
de implementacion, comandos, Sonar y MR.

### 11.2 Implementacion

El handler `each-repository-implementation`:

1. comprueba que el worktree es un repositorio Git;
2. lee el analisis de impacto;
3. recupera un plan previo si se esta reanudando;
4. crea una rama mediante `git switch -c <branch>`;
5. divide el trabajo en fases cuando procede;
6. resuelve agente y skills;
7. ejecuta Copilot con permisos de implementacion;
8. verifica cambios reales mediante Git;
9. persiste plan, progreso, commits y consumo.

El prompt exige editar los ficheros y no limitarse a describir una solucion.

### 11.3 Aprobacion

Antes de operaciones costosas, el workflow puede usar un paso `approval`.
El motor guarda:

- outputs;
- consumo;
- siguiente indice;
- worktrees;
- rama y commits existentes.

El run pasa a `awaiting-approval`. Aprobar reanuda desde el punto guardado. Una
decision de omision puede saltar a un paso posterior, por ejemplo crear la MR
sin ejecutar tests costosos.

### 11.4 Comandos y tests

Los pasos `each-repository-command` no piden a la IA que simule un comando:
ejecutan el comando configurado para el stack real de la unidad.

Ejemplos:

- Maven/Gradle;
- npm/Yarn;
- pytest;
- dotnet test;
- generadores NOVA.

Cada comando tiene timeout y log. Para tests con `autoFix`:

1. ejecuta el comando nativo;
2. si falla, entrega a Copilot comando y salida reales;
3. Copilot inspecciona produccion y tests relacionados;
4. aplica una reparacion limitada al fallo observado;
5. vuelve a ejecutar;
6. repite hasta `maxAttempts`.

Las instrucciones prohiben eliminar tests, ignorarlos, debilitar assertions o
cambiar produccion solo para satisfacer una suposicion incorrecta del test.

### 11.5 Sonar

El handler de Sonar ejecuta el comando configurado y consulta el quality gate.
El resultado se guarda en `run.quality.sonar`. Segun workflow y politica, un
fallo puede detener el run o abrir una aprobacion explicita.

### 11.6 Push y pull/merge request

El handler remoto:

1. recupera el analisis de impacto;
2. pide a la IA un titulo Conventional Commits, sin herramientas;
3. renderiza la descripcion;
4. determina plataforma por `repository.platform`;
5. publica la rama;
6. crea MR en GitLab o PR en GitHub;
7. guarda URL e identificador en `run.mergeRequests`.

La autenticacion es:

- GitHub: sesion de `gh` y API GitHub;
- GitLab: token configurado, pasado sin incrustarlo en el remoto.

### 11.7 Finalizacion

Al completar todos los pasos:

```text
status = completed
runtime.nextStepIndex = workflow.steps.length
runtime.outputByStep = <todos los resultados>
usage = <consumo agregado>
```

El motor puede iniciar analisis posterior si detecto friccion real entre tarea,
agentes o skills. Los worktrees completados se limpian; los fallidos se
conservan para diagnostico o relanzamiento.

## 12. Persistencia y trazabilidad

El almacenamiento operativo de cada proyecto se resuelve a partir de
`config.storage.directory`. De forma conceptual contiene:

```text
.workbench/projects/<projectId>/
|-- workbench.config.json
|-- repos/
|   `-- <repoKey>/                 clon canonico
`-- storage/
    |-- runs/                      estado y artefactos de ejecuciones
    |-- wt/<runHash>/              worktrees de codigo
    |-- aw/<runHash>/              worktrees de repositorios de agentes
    |-- copilot-home/              estado de sesiones del runtime Copilot
    |-- telemetry/                 telemetria local opcional
    `-- workflows/                 workflows creados por el usuario
```

`RunStore` persiste el run y mantiene caches de lectura. Cada entrada de paso
puede incluir:

- estado y timestamps;
- repositorio;
- agente y skills;
- modelo, esfuerzo y tier de contexto;
- outputs;
- fuentes consultadas;
- logs;
- subagentes;
- consumo;
- error.

Los logs vivos se acotan en memoria y el estado durable se escribe en disco.
La interfaz consulta summaries con ETag y carga detalles cuando son necesarios.

## 13. Estados y recuperacion

Estados principales:

```text
evaluating
  -> needs-clarification
  -> queued
  -> running
  -> awaiting-approval
  -> completed
  -> failed
  -> cancelling
  -> cancelled
```

El run registra `runtime.nextStepIndex`, `outputByStep`, worktrees y planes de
fase. Esto permite:

- continuar tras aclaraciones;
- continuar tras aprobaciones;
- relanzar desde un punto;
- conservar consumo ya realizado;
- reutilizar rama y commits;
- evitar repetir pasos completados innecesariamente.

Al arrancar un proceso nuevo, `reconcileOrphanedRuns()` revisa estados que
quedaron activos en disco. Una ejecucion marcada como activa por un proceso ya
muerto no puede seguir siendo considerada legitima y se reconcilia.

## 14. Fronteras de seguridad relevantes

Las principales medidas core son:

- servidor limitado a `127.0.0.1`;
- proveedor elegido de forma explicita, sin fallback cruzado silencioso;
- sin BYOK de Copilot;
- eliminacion de API keys ajenas del entorno Copilot;
- perfiles de herramientas por paso;
- callback de permisos del SDK;
- worktrees aislados;
- tokens GitLab por cabecera efimera, no en URL Git;
- token GitHub obtenido de `gh` y cacheado solo temporalmente;
- trazabilidad de fuentes sin necesidad de persistir el contenido completo;
- cancelacion activa de sesiones;
- deteccion de bucles agenticos;
- validacion de modelo contra el catalogo de la licencia real.

El perfil Copilot `implementation` tiene permisos amplios sobre el worktree y
puede aprobar operaciones solicitadas por el runtime. Su contencion principal
es el worktree aislado y la seleccion del directorio de trabajo; no debe
confundirse con un sandbox de sistema operativo completo.

## 15. Resumen secuencial

```text
Build
  1. check + tests
  2. copiar codigo y node_modules a dist/FENIX
  3. incluir runtimes portables
  4. sellar version/commit
  5. compilar Inno Setup
  6. generar SHA-256

Instalacion
  1. instalar en LocalAppData
  2. preparar Node, Git y gh
  3. hacer gh auth login y setup-git
  4. instalar dependencias
  5. crear proyecto

Arranque
  1. launcher resuelve runtimes y proxy
  2. inicia Node
  3. servidor carga proyecto y estado
  4. health responde
  5. navegador abre la aplicacion local
  6. consulta modelos/cuota Copilot

Run de desarrollo
  1. validar request
  2. persistir run
  3. resolver modelo y aclaraciones
  4. clonar/fetch y crear worktrees
  5. analizar impacto
  6. crear rama e implementar
  7. solicitar aprobacion
  8. instalar y ejecutar tests
  9. autofix si falla
 10. validar Sonar
 11. push y MR/PR
 12. agregar documentacion
 13. persistir resultado y limpiar aislamiento
```

## 16. Ficheros clave para profundizar

| Area | Ficheros |
|---|---|
| Scripts npm | `package.json` |
| Payload | `scripts/build-dist.mjs` |
| Instalador | `scripts/build-installer.ps1` |
| Release | `scripts/release-version.ps1`, `scripts/publish-release.ps1` |
| Instalacion | `scripts/install.ps1` |
| Runtimes portables | `scripts/ensure-node.ps1`, `ensure-git.ps1`, `ensure-gh.ps1` |
| Launcher | `scripts/launch.ps1` |
| CLI | `src/cli.mjs` |
| Servidor | `src/server.mjs` |
| Configuracion | `src/config.mjs` |
| Copilot | `src/integrations/copilot.mjs` |
| Autenticacion/API GitHub | `src/integrations/github.mjs` |
| Clonacion | `src/integrations/repository-clone.mjs` |
| Worktrees | `src/integrations/run-workspace.mjs` |
| Dispatcher IA | `src/ai-runtime.mjs` |
| Ciclo de vida | `src/workflow/run-lifecycle.mjs` |
| Carga de workflows | `src/workflow/loader.mjs` |
| Handlers | `src/workflow/step-handlers/` |
| Workflow end-to-end | `workflows/code-implementation.json` |
| Persistencia de runs | `src/run-store.mjs` |
| Seguridad | `src/security/permission-policy.mjs` |
| Guardia de bucles | `src/integrations/copilot-loop-guard.mjs` |
