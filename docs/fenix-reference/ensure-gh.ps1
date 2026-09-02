<#
.SYNOPSIS
  Resuelve el GitHub CLI (gh) embebido en dependencies/, descargandolo si no
  esta presente. Se dot-sourcea desde install.ps1, launch.ps1 y
  publish-release.ps1 para no duplicar la logica de descarga, igual que
  ensure-node.ps1 y ensure-git.ps1.

.NOTES
  FENIX usa gh para autenticarse contra GitHub Enterprise, leer los
  repositorios y consultar la ultima release al buscar actualizaciones.

  El binario ya no se versiona en el repositorio: pesa 40 MB y el repositorio
  corporativo rechaza tanto los ficheros .exe como cualquier fichero de mas de
  5 MB. Se descarga aqui en el primer arranque, igual que Node y MinGit.

  Si en el puesto ya hay un gh instalado y accesible por PATH, los llamantes lo
  usan y esta funcion no llega a invocarse: el embebido es solo el plan B.
#>

function Get-BundledGh {
  param(
    [Parameter(Mandatory)] [string]$DependenciesDir,
    [string]$GhVersion = "2.96.0"
  )

  $distDir = "gh_${GhVersion}_windows_amd64"
  $ghDir   = Join-Path $DependenciesDir $distDir
  $ghExe   = Join-Path $ghDir "bin\gh.exe"

  if (-not (Test-Path $ghExe)) {
    Write-Host "  [INFO]  GitHub CLI no encontrado en dependencies/$distDir. Descargando..." -ForegroundColor Gray

    $zipUrl  = "https://github.com/cli/cli/releases/download/v$GhVersion/$distDir.zip"
    $zipPath = Join-Path ([System.IO.Path]::GetTempPath()) "$distDir.zip"

    try {
      New-Item -ItemType Directory -Path $ghDir -Force | Out-Null
      $previousProgress = $ProgressPreference
      $ProgressPreference = "SilentlyContinue"
      try {
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
      } finally {
        $ProgressPreference = $previousProgress
      }
      # Igual que el zip de MinGit, el de gh no trae carpeta raiz: su contenido
      # (bin/, LICENSE) cuelga de la raiz del archivo, asi que hay que extraer
      # directamente dentro de $ghDir.
      Expand-Archive -Path $zipPath -DestinationPath $ghDir -Force
    } catch {
      Write-Host "  [ERROR] No se pudo descargar GitHub CLI desde $zipUrl." -ForegroundColor Red
      Write-Host "  Descargalo manualmente y descomprimelo en dependencies/$distDir." -ForegroundColor White
      throw
    } finally {
      Remove-Item $zipPath -ErrorAction SilentlyContinue
    }

    if (-not (Test-Path $ghExe)) {
      throw "La descarga de GitHub CLI no genero dependencies/$distDir/bin/gh.exe."
    }

    Write-Host "  [OK]    GitHub CLI $GhVersion descargado en dependencies/$distDir." -ForegroundColor Green
  }

  [PSCustomObject]@{
    GhExe   = $ghExe
    GhDir   = $ghDir
    BinDir  = (Join-Path $ghDir "bin")
    DistDir = $distDir
  }
}
