<#
.SYNOPSIS
  Resuelve el Node.js embebido en dependencies/, descargandolo si no esta
  presente. Se dot-sourcea desde install.ps1, launch.ps1 y bootstrap.ps1 para
  no duplicar la logica de descarga.
#>

function Get-BundledNode {
  param(
    [Parameter(Mandatory)] [string]$DependenciesDir,
    [string]$NodeVersion = "22.23.1"
  )

  $distDir = "node-v$NodeVersion-win-x64"
  $nodeDir = Join-Path $DependenciesDir $distDir
  $nodeExe = Join-Path $nodeDir "node.exe"
  $npmCmd  = Join-Path $nodeDir "npm.cmd"

  if (-not (Test-Path $nodeExe)) {
    Write-Host "  [INFO]  Node.js no encontrado en dependencies/$distDir. Descargando..." -ForegroundColor Gray

    $zipUrl  = "https://nodejs.org/dist/v$NodeVersion/$distDir.zip"
    $zipPath = Join-Path ([System.IO.Path]::GetTempPath()) "$distDir.zip"

    try {
      New-Item -ItemType Directory -Path $DependenciesDir -Force | Out-Null
      Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
      Expand-Archive -Path $zipPath -DestinationPath $DependenciesDir -Force
    } catch {
      Write-Host "  [ERROR] No se pudo descargar Node.js desde $zipUrl." -ForegroundColor Red
      Write-Host "  Descargalo manualmente y descomprimelo en dependencies/$distDir." -ForegroundColor White
      throw
    } finally {
      Remove-Item $zipPath -ErrorAction SilentlyContinue
    }

    if (-not (Test-Path $nodeExe)) {
      throw "La descarga de Node.js no genero dependencies/$distDir/node.exe."
    }

    Write-Host "  [OK]    Node.js $NodeVersion descargado en dependencies/$distDir." -ForegroundColor Green
  }

  [PSCustomObject]@{
    NodeExe = $nodeExe
    NpmCmd  = $npmCmd
    DistDir = $distDir
  }
}
