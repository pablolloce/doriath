<#
.SYNOPSIS
  Publica una version de FENIX como release en GitHub Enterprise, subiendo el
  instalador. Este es un canal manual de release; los puestos se actualizan
  desde el EXE que el CI corporativo publica posteriormente en Artifactory.

.NOTES
  Uso:
    npm run publish:release
    powershell -ExecutionPolicy Bypass -File scripts\publish-release.ps1 -DryRun

  El flujo normal se ejecuta con un unico comando:
    npm run release -- 0.7.0

  La version SIEMPRE sale de package.json: es la misma que build-dist.mjs
  escribe en BUILD.json y en installer/version.iss, de modo que lo que se
  publica, lo que se instala y lo que se compara no pueden divergir.
#>

param(
  [switch]$DryRun,
  [string]$Repo = "bbva.ghe.com/free/fenix",
  [string]$Notes
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

# gh no se versiona en el repositorio; se descarga si hace falta.
. (Join-Path $PSScriptRoot "ensure-gh.ps1")

# En Windows PowerShell 5.1, con $ErrorActionPreference = "Stop" cualquier cosa
# que un comando nativo escriba en stderr se convierte en error terminante. gh
# usa stderr para mensajes normales ("release not found"), asi que las llamadas
# se aislan aqui y el resultado se decide siempre por $LASTEXITCODE.
function Invoke-Gh {
  param([Parameter(Mandatory)] [string[]]$Arguments)

  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $script:ghExe @Arguments 2>&1
    return [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Output = $output }
  } finally {
    $ErrorActionPreference = $previous
  }
}

function Write-Info { param([string]$m) Write-Host "  $m" -ForegroundColor Gray }
function Write-Ok   { param([string]$m) Write-Host "  [OK]    $m" -ForegroundColor Green }
function Write-Fail { param([string]$m) Write-Host "  [ERROR] $m" -ForegroundColor Red }

Write-Host ""
Write-Host "  FENIX - publicar release" -ForegroundColor Cyan
Write-Host ""

$version = (Get-Content (Join-Path $RootDir "package.json") -Raw | ConvertFrom-Json).version
$tag = $version
$installer = Join-Path $RootDir "dist\FENIX-Setup-$version.exe"
$checksum = "$installer.sha256"

Write-Info "version: $version"
Write-Info "tag:     $tag"
Write-Info "repo:    $Repo"

$branch = (& git -C $RootDir branch --show-current).Trim()
$status = & git -C $RootDir status --porcelain
if ($LASTEXITCODE -ne 0 -or $branch -ne "main" -or $status) {
  Write-Fail "La publicacion manual exige main limpio; rama actual: $branch."
  exit 1
}

if (-not (Test-Path $installer)) {
  Write-Fail "No existe $installer."
  Write-Info "Genera el instalador antes:"
  Write-Info "  npm run build:dist"
  Write-Info "  iscc installer\fenix.iss"
  exit 1
}

$sizeMb = [math]::Round((Get-Item $installer).Length / 1MB, 1)
Write-Info "asset:   FENIX-Setup-$version.exe ($sizeMb MB)"

$installerHash = (Get-FileHash -Algorithm SHA256 -Path $installer).Hash.ToLowerInvariant()
Set-Content -Path $checksum -Value "$installerHash  $(Split-Path $installer -Leaf)" -Encoding Ascii
Write-Info "sha256:  $installerHash"

# Aviso, no bloqueo: sin firma el instalador dispara SmartScreen en los puestos.
$signature = Get-AuthenticodeSignature $installer
if ($signature.Status -ne "Valid") {
  Write-Host "  [WARN]  El instalador NO esta firmado (estado: $($signature.Status))." -ForegroundColor DarkYellow
  Write-Host "          SmartScreen y AppLocker lo bloquearan en los puestos." -ForegroundColor DarkYellow
}

$script:ghExe = (Get-Command gh -ErrorAction SilentlyContinue).Source
if (-not $script:ghExe) {
  try {
    $script:ghExe = (Get-BundledGh -DependenciesDir (Join-Path $RootDir "dependencies")).GhExe
  } catch {
    Write-Fail "No se encuentra gh. Ejecuta scripts\install.ps1 o instala GitHub CLI."
    exit 1
  }
}
$ghExe = $script:ghExe
if (-not (Test-Path $ghExe)) {
  Write-Fail "No se encuentra gh. Ejecuta scripts\install.ps1 o instala GitHub CLI."
  exit 1
}

# La plataforma corporativa es la unica autorizada para crear tags y releases.
# Este fallback solo adjunta assets a una release ya creada y nunca sobrescribe.
$existing = Invoke-Gh @("release", "view", $tag, "--repo", $Repo, "--json", "tagName,assets")
if ($existing.ExitCode -ne 0) {
  Write-Fail "La release $tag no existe. Fusiona primero la PR de version y espera a Create release."
  exit 1
}

$tagCommit = (& git -C $RootDir rev-list -n 1 $tag).Trim()
$headCommit = (& git -C $RootDir rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or -not $tagCommit -or $tagCommit -ne $headCommit) {
  Write-Fail "El tag $tag no apunta al HEAD de main; no se publicara un binario de otro commit."
  exit 1
}

$buildFile = Join-Path $RootDir "dist\FENIX\BUILD.json"
if (-not (Test-Path $buildFile)) {
  Write-Fail "No existe BUILD.json. Ejecuta npm run build:installer desde el commit del tag $tag."
  exit 1
}
$build = Get-Content $buildFile -Raw | ConvertFrom-Json
if ($build.version -ne $version -or $build.commit -ne $headCommit) {
  Write-Fail "El instalador no fue construido desde la version y commit del tag $tag."
  exit 1
}

$release = ($existing.Output -join "") | ConvertFrom-Json
$publishedInstaller = $release.assets | Where-Object { $_.name -eq (Split-Path $installer -Leaf) } | Select-Object -First 1
if ($publishedInstaller) {
  Write-Fail "La release $tag ya contiene $(Split-Path $installer -Leaf); no se sobrescribe."
  Write-Info "Sube la version en package.json y genera una release nueva."
  exit 1
}

if ($DryRun) {
  Write-Host ""
  Write-Ok "DryRun: se adjuntarian el instalador y su checksum a la release $tag."
  exit 0
}

Write-Info "Adjuntando instalador y checksum a la release $tag..."
$uploaded = Invoke-Gh @("release", "upload", $tag, $installer, $checksum, "--repo", $Repo)
if ($uploaded.ExitCode -ne 0) {
  Write-Fail "gh release upload fallo:"
  $uploaded.Output | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
  exit 1
}

Write-Host ""
Write-Ok "Instalador y checksum adjuntados a la release $tag."
Write-Info "Los puestos la detectaran en el siguiente arranque de FENIX."
