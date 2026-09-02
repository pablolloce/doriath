<#
.SYNOPSIS
  Arranque "de un clic" de FENIX: instala dependencias si
  faltan, arranca el servidor y abre el navegador automaticamente.

.NOTES
  Pensado para ejecutarse desde un acceso directo de escritorio
  (ver scripts/create-shortcut.ps1), pero tambien funciona a mano:
    powershell -ExecutionPolicy Bypass -File scripts\launch.ps1
    powershell -ExecutionPolicy Bypass -File scripts\launch.ps1 -ProjectId mi-proyecto
#>

param(
  [string]$ProjectId
)

$ErrorActionPreference = "Stop"
try { $Host.UI.RawUI.WindowTitle = "FENIX" } catch {}

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

# El Node.js, el Git y el gh embebidos en dependencies/ no se distribuyen en el
# repositorio: se descargan aqui si hacen falta (ver scripts/ensure-node.ps1,
# scripts/ensure-git.ps1 y scripts/ensure-gh.ps1). En la version instalada ya
# vienen dentro del paquete.
. (Join-Path $PSScriptRoot "ensure-node.ps1")
. (Join-Path $PSScriptRoot "ensure-git.ps1")
. (Join-Path $PSScriptRoot "ensure-gh.ps1")
. (Join-Path $PSScriptRoot "ensure-oracle-client.ps1")
. (Join-Path $PSScriptRoot "ensure-update.ps1")
$NODE_VERSION = "22.23.1"
$GIT_VERSION  = "2.55.0.3"
$GH_VERSION   = "2.96.0"
$GH_DIST_DIR  = "gh_${GH_VERSION}_windows_amd64"

# Origen de la versión publicada y de la descarga manual.
$UPDATE_REPO = "bbva.ghe.com/free/fenix"
$UPDATE_REPOSITORY_URL = "https://artifactory.globaldevtools.bbva.com:443/artifactory/cib-apps-generic-local/tfit/fenix"

function Write-Info { param([string]$Message) Write-Host "  $Message" -ForegroundColor Gray }
function Write-Ok   { param([string]$Message) Write-Host "  [OK]    $Message" -ForegroundColor Green }
function Write-Warn { param([string]$Message) Write-Host "  [WARN]  $Message" -ForegroundColor DarkYellow }
function Write-Fail { param([string]$Message) Write-Host "  [ERROR] $Message" -ForegroundColor Red }

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

function Wait-ForExit {
  Write-Host ""
  Read-Host "  Pulsa Enter para cerrar esta ventana" | Out-Null
}

function Get-ChromiumBrowser {
  # Edge y Chrome comparten el modificador --app. Se respeta primero el navegador
  # HTTP predeterminado de Windows si es uno de ellos.
  try {
    $userChoice = Get-ItemProperty `
      -Path "HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice" `
      -ErrorAction Stop
    $openCommandKey = "Registry::HKEY_CLASSES_ROOT\$($userChoice.ProgId)\shell\open\command"
    $openCommand = (Get-Item -LiteralPath $openCommandKey -ErrorAction Stop).GetValue("")
    $defaultBrowser = $null

    if ($openCommand -match '^\s*"([^"]+\.exe)"') {
      $defaultBrowser = $Matches[1]
    } elseif ($openCommand -match '^\s*([^\s"]+\.exe)') {
      $defaultBrowser = $Matches[1]
    }

    $executableName = [System.IO.Path]::GetFileName($defaultBrowser)
    if ($executableName -in @("chrome.exe", "msedge.exe") -and (Test-Path -LiteralPath $defaultBrowser)) {
      return $defaultBrowser
    }
  } catch {}

  # Si no se puede resolver la asociacion, se buscan las rutas registradas por
  # los instaladores y, por ultimo, las ubicaciones habituales.
  $candidates = @(
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe",
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"
  )

  foreach ($key in $candidates) {
    try {
      $path = (Get-ItemProperty -Path $key -ErrorAction Stop).'(default)'
      if ($path -and (Test-Path $path)) { return $path }
    } catch {}
  }

  $fallbacks = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  )

  foreach ($path in $fallbacks) {
    if ($path -and (Test-Path $path)) { return $path }
  }

  return $null
}

function Open-FenixWindow {
  <#
    Abre FENIX en modo aplicacion: ventana propia, sin barra de direcciones ni
    pestanas, con el titulo y el icono de la pagina. Las ventanas secundarias
    (visor de documentos, terminal de paso) se abren solas del mismo modo,
    porque son del mismo origen y por tanto entran en el "scope" de la app;
    los enlaces externos (PR/MR) siguen yendo al navegador por defecto.

    Se puede forzar el navegador normal con FENIX_NO_APP_MODE=1.
  #>
  param([string]$Url)

  if ($env:FENIX_NO_APP_MODE -eq "1") {
    Start-Process $Url
    return
  }

  $browser = Get-ChromiumBrowser
  if (-not $browser) {
    Write-Info "No se encontro Edge ni Chrome. Se abrira el navegador por defecto."
    Start-Process $Url
    return
  }

  try {
    # Sin --window-size a proposito: el navegador recuerda el tamano y la
    # posicion de la ventana de app entre arranques.
    Start-Process -FilePath $browser -ArgumentList "--app=$Url"
  } catch {
    Write-Warn "No se pudo abrir en modo aplicacion ($($_.Exception.Message)). Se usara el navegador por defecto."
    Start-Process $Url
  }
}

function Wait-FenixServer {
  <#
    Espera a que el servidor termine, pero sin bloquear la ventana: mientras
    tanto, la tecla A vuelve a abrir FENIX en modo aplicacion. Por eso no se
    imprime la URL en la consola; el terminal la convertiria en un enlace que
    abre una pestana normal del navegador, que es justo lo que se quiere evitar.

    Si la consola no admite lectura de teclas (entrada redirigida, ejecucion
    desde otro script), se cae a una espera normal.
  #>
  param(
    [System.Diagnostics.Process]$ServerProcess,
    [string]$Url
  )

  try {
    $null = [System.Console]::KeyAvailable
  } catch {
    Wait-Process -Id $ServerProcess.Id
    return
  }

  while (-not $ServerProcess.HasExited) {
    if ([System.Console]::KeyAvailable) {
      $key = [System.Console]::ReadKey($true)
      if ($key.Key -eq [System.ConsoleKey]::A) {
        Write-Info "Abriendo FENIX..."
        Open-FenixWindow -Url $Url
      }
    }
    Start-Sleep -Milliseconds 150
  }
}

function Stop-ListeningFenix {
  param([int]$Port)

  try {
    $connection = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort $Port -State Listen `
      -ErrorAction Stop | Select-Object -First 1
    if (-not $connection -or -not $connection.OwningProcess) {
      throw "No se pudo identificar el proceso que escucha en el puerto $Port."
    }

    $listenerProcessId = [int]$connection.OwningProcess
    Write-Info "Deteniendo la instancia anterior (PID $listenerProcessId)..."
    Stop-Process -Id $listenerProcessId -Force -ErrorAction Stop

    for ($i = 0; $i -lt 40; $i++) {
      if (-not (Get-Process -Id $listenerProcessId -ErrorAction SilentlyContinue)) {
        Write-Ok "Instancia anterior detenida."
        return $true
      }
      Start-Sleep -Milliseconds 250
    }

    throw "El proceso anterior no se detuvo dentro del tiempo esperado."
  } catch {
    Write-Fail $_.Exception.Message
    return $false
  }
}

$serverProcess = $null
Push-Location $RootDir
try {
  Write-Host ""
  Write-Host "  +======================================================+" -ForegroundColor Cyan
  Write-Host "  |                        FENIX                          |" -ForegroundColor Cyan
  Write-Host "  +======================================================+" -ForegroundColor Cyan
  Write-Host ""
	
  # -- Aviso de actualizacion -----------------------------------------------
  # La version se detecta en GHE y el usuario descarga manualmente el EXE de
  # Artifactory, donde puede completar el login SSO desde su navegador.
  # Ver scripts/ensure-update.ps1. Se puede saltar con FENIX_SKIP_UPDATE=1.
  $ghExe = (Get-Command gh -ErrorAction SilentlyContinue).Source
  if (-not $ghExe) {
    try {
      $ghExe = (Get-BundledGh -DependenciesDir (Join-Path $RootDir "dependencies") -GhVersion $GH_VERSION).GhExe
    } catch {
      Write-Warn "No se pudo obtener GitHub CLI; se omite la comprobacion de actualizaciones."
      $ghExe = $null
    }
  }

  if ($ghExe) {
    Invoke-FenixUpdateCheck `
      -RootDir $RootDir `
      -GhExe $ghExe `
      -Repo $UPDATE_REPO `
      -RepositoryUrl $UPDATE_REPOSITORY_URL | Out-Null
  }

  try {
    $node = Get-BundledNode -DependenciesDir (Join-Path $RootDir "dependencies") -NodeVersion $NODE_VERSION
  } catch {
    Write-Fail $_.Exception.Message
    Wait-ForExit
    exit 1
  }
  $NodeExe = $node.NodeExe
  $NpmCmd  = $node.NpmCmd

  $oracleClient = Get-BundledOracleClient -DependenciesDir (Join-Path $RootDir "dependencies")
  if ($oracleClient) {
    $env:FENIX_ORACLE_CLIENT_DIR = $oracleClient.ClientDir
  }

  # FENIX ejecuta git constantemente (clone, fetch, checkout, stash...). Se
  # antepone el embebido al PATH de ESTE proceso, que heredara el servidor. No
  # se toca el PATH del usuario: si ya tiene un Git instalado, sigue intacto
  # fuera de FENIX.
  try {
    $git = Get-BundledGit -DependenciesDir (Join-Path $RootDir "dependencies") -GitVersion $GIT_VERSION
    $env:PATH = "$($git.CmdDir);$env:PATH"
  } catch {
    Write-Fail $_.Exception.Message
    Wait-ForExit
    exit 1
  }

  $dependenciesReady = Test-Path (Join-Path $RootDir "node_modules")
  if ($dependenciesReady) {
    $packageJson = Get-Content (Join-Path $RootDir "package.json") -Raw | ConvertFrom-Json
    foreach ($dependency in $packageJson.dependencies.PSObject.Properties.Name) {
      $dependencyPath = $dependency -replace "/", [System.IO.Path]::DirectorySeparatorChar
      $dependencyManifest = Join-Path (Join-Path $RootDir "node_modules") (Join-Path $dependencyPath "package.json")
      if (-not (Test-Path $dependencyManifest)) {
        $dependenciesReady = $false
        break
      }
    }
  }

  if (-not $dependenciesReady) {
    Write-Info "Instalando o reparando dependencias (npm install)..."
    $npmInstall = Invoke-Native -FilePath $NpmCmd -Arguments @("install", "--loglevel", "error")
    if ($npmInstall.ExitCode -ne 0) {
      foreach ($line in $npmInstall.Output) {
        if ($line) {
          Write-Host "  $line" -ForegroundColor DarkGray
        }
      }
      Write-Fail "npm install fallo. Revisa los mensajes anteriores."
      Wait-ForExit
      exit 1
    }
    Write-Ok "Dependencias instaladas."
  }

  # -- Resolver puerto -----------------------------------------------------
  $projectsRoot = Join-Path $RootDir ".workbench\projects"
  $port = 4310
  if ($ProjectId) {
    $configPath = Join-Path $projectsRoot "$ProjectId\workbench.config.json"
    if (Test-Path $configPath) {
      try {
        $projectConfig = Get-Content $configPath -Raw | ConvertFrom-Json
        if ($projectConfig.server.port) { $port = [int]$projectConfig.server.port }
      } catch {
        Write-Warn "No se pudo leer el puerto de $configPath, se usara el puerto por defecto ($port)."
      }
    }
  }

  $launchUrl = "http://127.0.0.1:$port/"
  if ($ProjectId) {
    $encodedProjectId = [System.Uri]::EscapeDataString($ProjectId)
    $launchUrl += "?project=$encodedProjectId"
  }

  # Evita lanzar un segundo proceso contra el mismo puerto. Esto tambien cubre el
  # caso bootstrap: el servidor activo puede cargar el proyecto mediante ?project=.
  $existingFenix = $false
  try {
    $existingHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2
    $existingFenix = $existingHealth.status -eq "ok"
  } catch {}

  if ($existingFenix) {
    Write-Warn "Ya hay una instancia de FENIX activa en el puerto $port. Se reemplazara."
    if (-not (Stop-ListeningFenix -Port $port)) {
      Write-Fail "No se puede iniciar una instancia nueva mientras el puerto siga ocupado."
      Wait-ForExit
      exit 1
    }
  }

  # -- Conexion de red -------------------------------------------------------
  # El arranque de un clic usa siempre el proxy configurado para el proyecto. Si no
  # hay una URL configurada, aplica el proxy local corporativo de Ivanti por defecto.
  $proxyUrl = "http://127.0.0.1:8999"
  if ($projectConfig -and $projectConfig.network -and $projectConfig.network.proxy) {
    if ($projectConfig.network.proxy.url) { $proxyUrl = $projectConfig.network.proxy.url }
  }

  # -- Arrancar el servidor -------------------------------------------------
  $nodeArgs = @("src/cli.mjs", "start")
  if ($ProjectId) { $nodeArgs += @("--project", $ProjectId) }
  $nodeArgs += @("--proxy", $proxyUrl, "--quiet-proxy")

  Write-Info "Arrancando el servidor..."
  $previousLauncherPid = $env:FENIX_LAUNCHER_PID
  try {
    $env:FENIX_LAUNCHER_PID = [string]$PID
    $serverProcess = Start-Process -FilePath $NodeExe -ArgumentList $nodeArgs `
      -NoNewWindow -PassThru -WorkingDirectory $RootDir
  } finally {
    if ($null -eq $previousLauncherPid) {
      Remove-Item Env:\FENIX_LAUNCHER_PID -ErrorAction SilentlyContinue
    } else {
      $env:FENIX_LAUNCHER_PID = $previousLauncherPid
    }
  }

  $healthUrl = "http://127.0.0.1:$port/api/health"
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    if ($serverProcess.HasExited) { break }
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 1
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
  }

  if ($ready) {
    Write-Ok "Listo. Abriendo FENIX..."
    Open-FenixWindow -Url $launchUrl
  } elseif ($serverProcess.HasExited) {
    Write-Fail "El servidor se detuvo antes de arrancar. Revisa los mensajes anteriores."
    Wait-ForExit
    exit 1
  } else {
    Write-Warn "El servidor tarda mas de lo esperado. Pulsa A cuando quieras abrir FENIX."
  }

  Write-Host ""
  Write-Info "Esta ventana muestra los registros de FENIX."
  Write-Host "  [A]     Abrir FENIX" -ForegroundColor Cyan
  Write-Info "Cierra esta ventana o pulsa Ctrl+C para detenerlo."
  Write-Host ""

  Wait-FenixServer -ServerProcess $serverProcess -Url $launchUrl
} catch {
  Write-Fail $_.Exception.Message
  Wait-ForExit
  exit 1
} finally {
  if ($serverProcess -and -not $serverProcess.HasExited) {
    Write-Info "Deteniendo el servidor..."
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
  }
  Pop-Location
}
