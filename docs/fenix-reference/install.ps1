<#
.SYNOPSIS
  Instalador interactivo de FENIX.
  Verifica prerrequisitos, instala dependencias, autentica contra GHE
  y crea el primer proyecto.

.NOTES
  Ejecutar desde la raiz del proyecto:
    powershell -ExecutionPolicy Bypass -File scripts\install.ps1
  O mediante npm:
    npm run setup
#>

$ErrorActionPreference = "Stop"
# En PowerShell 7.4+, esta preferencia convierte cualquier salida de un comando
# nativo con codigo de salida distinto de cero en una excepcion terminante,
# incluso cuando el script ya comprueba $LASTEXITCODE manualmente (ver gh auth
# status, npm install, etc). La desactivamos para conservar el comportamiento
# clasico y que esas comprobaciones funcionen como estan escritas.
$PSNativeCommandUseErrorActionPreference = $false
$Host.UI.RawUI.WindowTitle = "FENIX - Instalador"

# -- Constantes ----------------------------------------------------------------
$FIXED_GHE_HOST        = "bbva.ghe.com"
$NODE_VERSION          = "22.23.1"
$GH_VERSION            = "2.96.0"
$GH_DIST_DIR           = "gh_${GH_VERSION}_windows_amd64"
$DEPENDENCIES_DIR      = Join-Path $PSScriptRoot "..\dependencies"
$GH_INSTALL_DIR        = Join-Path $env:LOCALAPPDATA "GitHubCLI\$GH_DIST_DIR"
$ROOT_DIR              = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$YES_VALUES            = @("s", "S", "si", "Si", "SI", "y", "Y", "yes")

# El Node.js, el Git y el gh embebidos en dependencies/ no se distribuyen en el
# repositorio: se descargan si hacen falta (ver scripts/ensure-node.ps1,
# scripts/ensure-git.ps1 y scripts/ensure-gh.ps1). En la version instalada ya
# vienen dentro del paquete.
. (Join-Path $PSScriptRoot "ensure-node.ps1")
. (Join-Path $PSScriptRoot "ensure-git.ps1")
. (Join-Path $PSScriptRoot "ensure-gh.ps1")
. (Join-Path $PSScriptRoot "ensure-oracle-client.ps1")
$GIT_VERSION = "2.55.0.3"

# -- Helpers -------------------------------------------------------------------

function Write-Banner {
  Write-Host ""
  Write-Host "  +======================================================+" -ForegroundColor Cyan
  Write-Host "  |                                                      |" -ForegroundColor Cyan
  Write-Host "  |                 FENIX  -  Instalador                 |" -ForegroundColor Cyan
  Write-Host "  |                                                      |" -ForegroundColor Cyan
  Write-Host "  +======================================================+" -ForegroundColor Cyan
  Write-Host ""
}

function Write-Step {
  param([string]$Number, [string]$Title)
  Write-Host ""
  Write-Host "  [$Number] $Title" -ForegroundColor Yellow
  Write-Host "  ------------------------------------------------------" -ForegroundColor DarkGray
}

function Write-Ok {
  param([string]$Message)
  Write-Host "  [OK]    $Message" -ForegroundColor Green
}

function Write-Warn {
  param([string]$Message)
  Write-Host "  [WARN]  $Message" -ForegroundColor DarkYellow
}

function Write-Fail {
  param([string]$Message)
  Write-Host "  [ERROR] $Message" -ForegroundColor Red
}

function Write-Info {
  param([string]$Message)
  Write-Host "  [INFO]  $Message" -ForegroundColor Gray
}

function Read-YesNo {
  param(
    [string]$Prompt,
    [bool]$DefaultYes = $true
  )

  $suffix = if ($DefaultYes) { "(S/n)" } else { "(s/N)" }
  $choice = Read-Host "  $Prompt $suffix"

  if (-not $choice) {
    return $DefaultYes
  }

  return $choice -in $script:YES_VALUES
}

function Confirm-Continue {
  param([string]$Prompt = "Continuar?")
  if (-not (Read-YesNo -Prompt $Prompt -DefaultYes $true)) {
    Write-Host ""
    Write-Host "  Instalacion cancelada por el usuario." -ForegroundColor DarkYellow
    exit 0
  }
}

function Test-CommandExists {
  param([string]$Name)
  $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-Native {
  param(
    [Parameter(Mandatory)] [string]$FilePath,
    [string[]]$Arguments = @()
  )

  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $FilePath @Arguments 2>&1
    return [PSCustomObject]@{
      ExitCode = $LASTEXITCODE
      Output   = $output
    }
  } finally {
    $ErrorActionPreference = $previous
  }
}

function Exit-WithPause {
  param([int]$Code = 1)
  Write-Host ""
  Read-Host "  Pulsa Enter para cerrar esta ventana"
  exit $Code
}

function Test-GhAuthenticated {
  param([Parameter(Mandatory)] [string]$Hostname)

  if (-not $script:GhExe) {
    return $false
  }

  $result = Invoke-Native -FilePath $script:GhExe -Arguments @("auth", "status", "--hostname", $Hostname)
  return $result.ExitCode -eq 0
}

function Ensure-GhAuthentication {
  param([Parameter(Mandatory)] [string]$Hostname)

  if (-not $script:GhExe) {
    Write-Warn "GitHub CLI no disponible. Se omite autenticacion en $Hostname."
    return $false
  }

  if (Test-GhAuthenticated -Hostname $Hostname) {
    Write-Ok "Ya autenticado en $Hostname."
    return $true
  }

  Write-Info "No hay sesion activa en $Hostname."

  while ($true) {
    if (-not (Read-YesNo -Prompt "Autenticarse ahora con gh auth login?" -DefaultYes $true)) {
      Write-Warn "Se continua sin autenticar en gh. Algunas funciones de FENIX no estaran disponibles hasta hacer login."
      return $false
    }

    Write-Info "Se abrira el navegador para autenticarte en $Hostname."
    Write-Info "El codigo quedara copiado: pegalo en el navegador y confirma el acceso."
    Write-Host ""
    & $script:GhExe auth login --hostname $Hostname --web --clipboard --git-protocol https
    $loginExitCode = $LASTEXITCODE
    Write-Host ""

    if ($loginExitCode -eq 0 -and (Test-GhAuthenticated -Hostname $Hostname)) {
      Write-Ok "Autenticacion completada."
      return $true
    }

    Write-Warn "No se pudo completar la autenticacion en $Hostname."

    if (-not (Read-YesNo -Prompt "Reintentar autenticacion ahora?" -DefaultYes $true)) {
      Write-Warn "Se continua sin autenticar en gh. Puedes completar el login mas tarde con:"
      Write-Info "  gh auth login --hostname $Hostname"
      return $false
    }
  }
}

# -- Inicio --------------------------------------------------------------------

Push-Location $ROOT_DIR
try {

$script:GhExe = $null

Write-Banner
Write-Host "  Este instalador configurara tu entorno paso a paso." -ForegroundColor White
Write-Host "  Host GHE fijo: $FIXED_GHE_HOST" -ForegroundColor DarkGray
Write-Host ""
Confirm-Continue "Iniciar la instalacion?"

# -- 1. Node.js ----------------------------------------------------------------

Write-Step "1/7" "Descargar / verificar Node.js embebido"

try {
  $node = Get-BundledNode -DependenciesDir $DEPENDENCIES_DIR -NodeVersion $NODE_VERSION
} catch {
  Write-Fail $_.Exception.Message
  Exit-WithPause
}
$NodeExe = $node.NodeExe
$NpmCmd  = $node.NpmCmd
$NODE_DIST_DIR = $node.DistDir

$nodeVersion = (& $NodeExe --version).TrimStart("v")
Write-Ok "Node.js $nodeVersion (incluido en dependencies/$NODE_DIST_DIR, no depende del sistema)"

# -- 2. Oracle Instant Client --------------------------------------------------

Write-Step "2/7" "Preparar Oracle Instant Client"

$oracleLicenseUrl = "https://www.oracle.com/downloads/licenses/instant-client-lic.html"
Write-Info "Oracle 11.2 requiere Instant Client 19c para el modo Thick de FENIX."
Write-Info "El paquete se descarga directamente desde Oracle y se valida por SHA-256."
Write-Host "  Licencia: $oracleLicenseUrl" -ForegroundColor White
if (Read-YesNo -Prompt "Aceptas la licencia de Oracle Instant Client y quieres descargarlo ahora?" -DefaultYes $true) {
  try {
    $oracleClient = Get-BundledOracleClient -DependenciesDir $DEPENDENCIES_DIR -AcceptLicense
    $env:FENIX_ORACLE_CLIENT_DIR = $oracleClient.ClientDir
    Write-Ok "Oracle Instant Client $($oracleClient.Version) disponible en dependencies/$($oracleClient.DistDir)"
  } catch {
    Write-Warn "No se pudo instalar Oracle Instant Client: $($_.Exception.Message)"
    Write-Info "FENIX seguira disponible; Oracle 12.1 o posterior podra usar modo Thin."
  }
} else {
  Write-Warn "Se omite Oracle Instant Client. Las bases Oracle anteriores a 12.1 no estaran disponibles."
}

# -- 3. Git --------------------------------------------------------------------

Write-Step "3/7" "Verificar Git"

# Ya no se exige que el puesto tenga Git instalado: FENIX embebe MinGit. Si el
# usuario ya tiene el suyo, se respeta y se usa ese.
if (Test-CommandExists "git") {
  Write-Ok (git --version)
} else {
  Write-Info "Git no esta instalado en el sistema. Se usara el Git embebido en FENIX."
  try {
    $git = Get-BundledGit -DependenciesDir $DEPENDENCIES_DIR -GitVersion $GIT_VERSION
    $env:PATH = "$($git.CmdDir);$env:PATH"
    Write-Ok (& $git.GitExe --version)
  } catch {
    Write-Fail "No se pudo preparar el Git embebido: $($_.Exception.Message)"
    Write-Host "  Alternativa: instala Git desde https://git-scm.com/download/win" -ForegroundColor White
    Exit-WithPause
  }
}

# -- 4. GitHub CLI -------------------------------------------------------------

Write-Step "4/7" "Verificar / Instalar GitHub CLI (gh)"

$ghInstalled = Test-CommandExists "gh"
$ghAvailable = $false

if ($ghInstalled) {
  $script:GhExe = (Get-Command gh -ErrorAction SilentlyContinue).Source
  if (-not $script:GhExe) {
    Write-Warn "Se detecto gh en PATH pero no se pudo resolver su ejecutable. Se continuara sin gh en esta sesion."
  } else {
    $versionResult = Invoke-Native -FilePath $script:GhExe -Arguments @("--version")
    $ghVersion = (($versionResult.Output | Select-Object -First 1) -as [string])
    Write-Ok "GitHub CLI ya instalado: $ghVersion"
    $ghAvailable = $true
  }
} else {
  Write-Info "GitHub CLI no encontrado. Se instalara para el usuario actual desde dependencies/$GH_DIST_DIR."

  if (-not (Read-YesNo -Prompt "Instalar GitHub CLI ahora?" -DefaultYes $true)) {
    Write-Warn "Se continua sin GitHub CLI. Puedes instalarlo mas tarde con scripts\\install.ps1 o desde https://cli.github.com/"
    $gh = $null
  } else {
    try {
      $gh = Get-BundledGh -DependenciesDir $DEPENDENCIES_DIR -GhVersion $GH_VERSION
    } catch {
      Write-Warn "GitHub CLI no esta instalado y no se pudo obtener en dependencies/$GH_DIST_DIR."
      Write-Info "Se continua sin gh. Puedes instalarlo mas tarde desde https://cli.github.com/"
      $gh = $null
    }
  }

  if ($gh) {
    Write-Info "Copiando GitHub CLI a $GH_INSTALL_DIR..."
    New-Item -ItemType Directory -Path $GH_INSTALL_DIR -Force | Out-Null
    Copy-Item -Path (Join-Path $gh.GhDir "*") -Destination $GH_INSTALL_DIR -Recurse -Force

    $ghBinDir = Join-Path $GH_INSTALL_DIR "bin"
    $candidateGhExe = Join-Path $ghBinDir "gh.exe"

    # Add to the User PATH (no admin rights required)
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if (($userPath -split ";") -notcontains $ghBinDir) {
      $newUserPath = if ($userPath) { "$userPath;$ghBinDir" } else { $ghBinDir }
      [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
    }

    # Refresh PATH for current session
    $env:Path = "$env:Path;$ghBinDir"

    if (Test-Path $candidateGhExe) {
      $script:GhExe = $candidateGhExe
      $versionResult = Invoke-Native -FilePath $script:GhExe -Arguments @("--version")
      $ghVersion = (($versionResult.Output | Select-Object -First 1) -as [string])
      Write-Ok "GitHub CLI instalado: $ghVersion"
      $ghAvailable = $true
    } else {
      Write-Warn "GitHub CLI se copio, pero no se localiza gh.exe en $ghBinDir."
      Write-Info "Se continua sin gh en esta sesion."
    }
  }
}

# -- 4. Autenticacion GHE -----------------------------------------------------

Write-Step "5/7" "Autenticacion en GitHub Enterprise ($FIXED_GHE_HOST)"

$isAuthenticated = $false
if ($ghAvailable -or $script:GhExe) {
  $isAuthenticated = Ensure-GhAuthentication -Hostname $FIXED_GHE_HOST
} else {
  Write-Warn "Se omite autenticacion porque gh no esta disponible."
}

# Enlaza git con las credenciales de gh. Es imprescindible en un puesto que no
# tenga Git instalado: el MinGit embebido no trae Git Credential Manager, y
# src/capability-analyzer.mjs no pasa credenciales explicitas para la plataforma
# github (solo lo hace para gitlab), asi que sin esto las operaciones contra
# repositorios de GHE fallan con "could not read Username".
if ($isAuthenticated) {
  $setup = Invoke-Native -FilePath $script:GhExe -Arguments @("auth", "setup-git", "--hostname", $FIXED_GHE_HOST)
  if ($setup.ExitCode -eq 0) {
    Write-Ok "git enlazado con las credenciales de gh para $FIXED_GHE_HOST."
  } else {
    Write-Warn "No se pudo enlazar git con gh. Reintentalo con:"
    Write-Info "  gh auth setup-git --hostname $FIXED_GHE_HOST"
  }
}

# -- 5. Dependencias npm ------------------------------------------------------

Write-Step "6/7" "Instalar dependencias del proyecto (npm install)"

Write-Info "Ejecutando npm install..."
try {
  $npmInstall = Invoke-Native -FilePath $NpmCmd -Arguments @("install", "--loglevel", "error")
  $npmInstall.Output | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
} catch {
  Write-Host "  $($_.Exception.Message)" -ForegroundColor DarkGray
  $npmInstall = [PSCustomObject]@{
    ExitCode = $LASTEXITCODE
    Output   = @($_.Exception.Message)
  }
}

if ($npmInstall.ExitCode -ne 0) {
  $joinedOutput = ($npmInstall.Output | Out-String)

  if ($joinedOutput -match "E401|E403|Forbidden|Incorrect or missing password|Unable to authenticate") {
    Write-Warn "Artifactory rechazo la descarga. Reintentando desde npmjs con los certificados de Windows..."

    $previousPath = $env:PATH
    $previousNodeOptions = $env:NODE_OPTIONS
    $bundledNodeDir = Split-Path $NpmCmd -Parent
    try {
      $env:PATH = "$bundledNodeDir;$previousPath"
      $env:NODE_OPTIONS = "--use-system-ca"
      $npmInstall = Invoke-Native -FilePath $NpmCmd -Arguments @(
        "install",
        "--registry", "https://registry.npmjs.org/",
        "--package-lock=false",
        "--no-audit",
        "--loglevel", "error"
      )
      $npmInstall.Output | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    } finally {
      $env:PATH = $previousPath
      $env:NODE_OPTIONS = $previousNodeOptions
    }
  }

  if ($npmInstall.ExitCode -ne 0) {
    Write-Fail "npm install fallo. Revisa los errores anteriores."
    Exit-WithPause
  }
}

Write-Ok "Dependencias instaladas."

# -- 6. Crear proyecto --------------------------------------------------------

Write-Step "7/7" "Configurar proyecto"

$projects = & $NpmCmd run projects --silent 2>&1

$hasProjects = $false
if ($projects -and $projects -notmatch "No hay proyectos") {
  $hasProjects = $true
}

if ($hasProjects) {
  Write-Ok "Ya existen proyectos configurados:"
  Write-Host ""
  & $NpmCmd run projects --silent 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
  Write-Host ""

  $createNew = Read-Host "  Crear un nuevo proyecto adicional? (s/N)"
  if ($createNew -in $YES_VALUES) {
    Write-Info "Iniciando asistente de configuracion de proyecto..."
    Write-Host ""
    & $NpmCmd run init-project
    if ($LASTEXITCODE -ne 0) {
      Write-Warn "El asistente de proyecto termino con errores. Puedes reintentarlo luego con: npm run init-project"
    }
  }
} else {
  Write-Info "No hay proyectos configurados. Se iniciara el asistente de configuracion."
  Confirm-Continue "Crear el primer proyecto?"
  Write-Host ""
  & $NpmCmd run init-project
  if ($LASTEXITCODE -ne 0) {
    Write-Warn "No se pudo completar la creacion del proyecto en este momento."
    Write-Info "Puedes reintentarlo luego con: npm run init-project"
  }
}

# -- Resumen final -------------------------------------------------------------

Write-Host ""
Write-Host "  +======================================================+" -ForegroundColor Green
Write-Host "  |                                                      |" -ForegroundColor Green
Write-Host "  |          Instalacion completada                      |" -ForegroundColor Green
Write-Host "  |                                                      |" -ForegroundColor Green
Write-Host "  +======================================================+" -ForegroundColor Green
Write-Host ""

# Identify available projects for final instructions
$finalProjects = & $NpmCmd run projects --silent 2>&1
$hasFinalProjects = $finalProjects -and $finalProjects -notmatch "No hay proyectos"

Write-Host "  Comandos utiles:" -ForegroundColor White
Write-Host ""
Write-Host "    Validar entorno:" -ForegroundColor Gray
if ($hasFinalProjects) {
  Write-Host '    npm run doctor -- --project <ID>' -ForegroundColor Cyan
} else {
  Write-Host "    npm run doctor" -ForegroundColor Cyan
}
Write-Host ""
Write-Host "    Iniciar FENIX:" -ForegroundColor Gray
if ($hasFinalProjects) {
  Write-Host '    npm start -- --project <ID>' -ForegroundColor Cyan
} else {
  Write-Host "    npm start" -ForegroundColor Cyan
}
Write-Host ""
Write-Host "    Ver modelos disponibles:" -ForegroundColor Gray
Write-Host "    npm run models" -ForegroundColor Cyan
Write-Host ""
Write-Host "    Crear otro proyecto:" -ForegroundColor Gray
Write-Host "    npm run init-project" -ForegroundColor Cyan
Write-Host ""

# Offer to create a desktop shortcut
$createShortcut = Read-Host "  Crear acceso directo en el Escritorio para arrancar con un doble clic? (S/n)"
if (-not $createShortcut -or $createShortcut -in $YES_VALUES) {
  Write-Host ""
  & (Join-Path $PSScriptRoot "create-shortcut.ps1")
  Write-Host ""
}

# Offer to run doctor
$runDoctor = Read-Host "  Ejecutar diagnostico ahora? (S/n)"
if (-not $runDoctor -or $runDoctor -in $YES_VALUES) {
  Write-Host ""
  & $NpmCmd run doctor 2>&1 | ForEach-Object { Write-Host "  $_" }
  if ($LASTEXITCODE -ne 0) {
    Write-Warn "Doctor reporto incidencias. La instalacion sigue completada; revisa el diagnostico cuando quieras."
  }
}

# Offer to start
Write-Host ""
$runStart = Read-Host "  Arrancar FENIX ahora? (S/n)"
if (-not $runStart -or $runStart -in $YES_VALUES) {
  Write-Host ""
  Write-Info "Arrancando FENIX..."
  & $NpmCmd start
  if ($LASTEXITCODE -ne 0) {
    Write-Warn "No se pudo arrancar FENIX ahora. Puedes reintentarlo mas tarde con: npm start"
  }
}

} catch {
  Write-Host ""
  Write-Host "  +======================================================+" -ForegroundColor Red
  Write-Host "  |                ERROR EN LA INSTALACION               |" -ForegroundColor Red
  Write-Host "  +======================================================+" -ForegroundColor Red
  Write-Host ""
  Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
  Write-Host ""
  Write-Host "  Detalle:" -ForegroundColor DarkGray
  Write-Host "  $($_.InvocationInfo.PositionMessage)" -ForegroundColor DarkGray
  Write-Host ""
  Read-Host "  Pulsa Enter para cerrar esta ventana"
  exit 1
} finally {
  Pop-Location
}
