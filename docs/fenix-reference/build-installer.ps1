<#
.SYNOPSIS
  Construye el instalador Windows y su checksum sin crear commits, tags ni releases.

.NOTES
  Es el contrato de build para GitHub Actions y tambien puede ejecutarse en local:
    npm run build:installer
#>

$ErrorActionPreference = "Stop"
$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Invoke-Native {
  param(
    [Parameter(Mandatory)] [string]$FilePath,
    [Parameter(Mandatory)] [string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath termino con codigo $LASTEXITCODE."
  }
}

function Resolve-Iscc {
  $command = Get-Command iscc -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  foreach ($candidate in @(
    (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"),
    (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe")
  )) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }

  throw "No se encuentra Inno Setup 6 (ISCC.exe)."
}

Push-Location $RootDir
try {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $buildCommit = (& git -C $RootDir rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $buildCommit) {
    throw "No se pudo determinar el commit de origen del instalador."
  }
  $previousBuildCommit = $env:FENIX_BUILD_COMMIT
  try {
    $env:FENIX_BUILD_COMMIT = $buildCommit
    Invoke-Native -FilePath $node -Arguments @("scripts/build-dist.mjs")
  } finally {
    $env:FENIX_BUILD_COMMIT = $previousBuildCommit
  }
  Invoke-Native -FilePath (Resolve-Iscc) -Arguments @("installer\fenix.iss")

  $version = (Get-Content (Join-Path $RootDir "package.json") -Raw | ConvertFrom-Json).version
  $installer = Join-Path $RootDir "dist\FENIX-Setup-$version.exe"
  if (-not (Test-Path $installer)) {
    throw "No se genero $installer."
  }

  $hash = (Get-FileHash -Algorithm SHA256 -Path $installer).Hash.ToLowerInvariant()
  Set-Content -Path "$installer.sha256" -Value "$hash  $(Split-Path $installer -Leaf)" -Encoding Ascii
  Write-Host "  [OK] Instalador: $installer" -ForegroundColor Green
  Write-Host "  [OK] SHA-256:   $hash" -ForegroundColor Green
} finally {
  Pop-Location
}