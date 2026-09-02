<#
.SYNOPSIS
  Resuelve el Git embebido (MinGit) en dependencies/, descargandolo si no esta
  presente. Se dot-sourcea desde install.ps1, launch.ps1 y build-dist para no
  duplicar la logica de descarga, igual que ensure-node.ps1.

.NOTES
  FENIX invoca git de forma intensiva (clone, fetch, checkout, stash, switch...),
  asi que sin git no funciona nada. Embeberlo evita que cada puesto tenga que
  instalar Git for Windows por su cuenta.

  Se usa MinGit, la distribucion minima oficial de Git for Windows pensada para
  empaquetarse dentro de otras aplicaciones. No incluye bash, la interfaz
  grafica ni Git Credential Manager; FENIX no los necesita porque pasa las
  credenciales de forma explicita en la linea de comandos.

  Si en el puesto ya hay un Git instalado, este embebido NO lo reemplaza: solo
  se antepone al PATH del proceso de FENIX, sin tocar el PATH del usuario.
#>

function Get-BundledGit {
  param(
    [Parameter(Mandatory)] [string]$DependenciesDir,
    [string]$GitVersion = "2.55.0.3"
  )

  $distDir = "MinGit-$GitVersion-64-bit"
  $gitDir  = Join-Path $DependenciesDir $distDir
  $gitExe  = Join-Path $gitDir "cmd\git.exe"

  if (-not (Test-Path $gitExe)) {
    Write-Host "  [INFO]  Git no encontrado en dependencies/$distDir. Descargando..." -ForegroundColor Gray

    # El tag de la release usa un formato distinto al del nombre del fichero:
    # 2.55.0.3 -> v2.55.0.windows.3
    $parts = $GitVersion.Split(".")
    $tag = "v$($parts[0]).$($parts[1]).$($parts[2]).windows.$($parts[3])"
    $zipUrl  = "https://github.com/git-for-windows/git/releases/download/$tag/MinGit-$GitVersion-64-bit.zip"
    $zipPath = Join-Path ([System.IO.Path]::GetTempPath()) "$distDir.zip"

    try {
      New-Item -ItemType Directory -Path $gitDir -Force | Out-Null
      $previousProgress = $ProgressPreference
      $ProgressPreference = "SilentlyContinue"
      try {
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
      } finally {
        $ProgressPreference = $previousProgress
      }
      # A diferencia del zip de Node, el de MinGit no trae carpeta raiz: su
      # contenido (cmd/, mingw64/, usr/) cuelga de la raiz del archivo, asi que
      # hay que extraer directamente dentro de $gitDir.
      Expand-Archive -Path $zipPath -DestinationPath $gitDir -Force
    } catch {
      Write-Host "  [ERROR] No se pudo descargar Git desde $zipUrl." -ForegroundColor Red
      Write-Host "  Descargalo manualmente y descomprimelo en dependencies/$distDir." -ForegroundColor White
      throw
    } finally {
      Remove-Item $zipPath -ErrorAction SilentlyContinue
    }

    if (-not (Test-Path $gitExe)) {
      throw "La descarga de Git no genero dependencies/$distDir/cmd/git.exe."
    }

    Write-Host "  [OK]    Git $GitVersion descargado en dependencies/$distDir." -ForegroundColor Green
  }

  [PSCustomObject]@{
    GitExe = $gitExe
    GitDir = $gitDir
    CmdDir = (Join-Path $gitDir "cmd")
    DistDir = $distDir
  }
}
