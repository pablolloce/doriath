<#
.SYNOPSIS
  Crea un acceso directo en el Escritorio para arrancar FENIX con un doble
  clic (icono propio, sin necesidad de terminal).

.NOTES
  Ejecutar desde la raiz del proyecto:
    powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1
  O mediante npm:
    npm run shortcut

  Si tienes varios proyectos configurados, puedes fijar uno concreto:
    npm run shortcut -- --project mi-proyecto
#>

param(
  [string]$ProjectId
)

$ErrorActionPreference = "Stop"
$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
# icon-256.png es el master del logotipo. favicon.png se sirve a 64px para la
# pestana del navegador, asi que escalarlo a 256 para el acceso directo daria
# un icono borroso.
$FaviconPath = Join-Path $RootDir "public\icon-256.png"
$IconDir = Join-Path $RootDir ".workbench\icons"
$IconPath = Join-Path $IconDir "workbench.ico"
$LaunchScript = Join-Path $RootDir "scripts\launch.ps1"
$ShortcutName = "FENIX.lnk"

function Write-Info { param([string]$Message) Write-Host "  $Message" -ForegroundColor Gray }
function Write-Ok   { param([string]$Message) Write-Host "  [OK]    $Message" -ForegroundColor Green }
function Write-Fail { param([string]$Message) Write-Host "  [ERROR] $Message" -ForegroundColor Red }

function New-IconFromPng {
  param([string]$PngPath, [string]$IcoPath)

  Add-Type -AssemblyName System.Drawing
  Add-Type -Namespace Win32Interop -Name IconNative -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool DestroyIcon(System.IntPtr hIcon);
"@ -ErrorAction SilentlyContinue

  $source = [System.Drawing.Image]::FromFile($PngPath)
  try {
    $size = 256
    $resized = New-Object System.Drawing.Bitmap $size, $size
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($resized)
      try {
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($source, 0, 0, $size, $size)
      } finally {
        $graphics.Dispose()
      }

      $hIcon = $resized.GetHicon()
      $icon = [System.Drawing.Icon]::FromHandle($hIcon)
      try {
        $stream = [System.IO.File]::Open($IcoPath, [System.IO.FileMode]::Create)
        try {
          $icon.Save($stream)
        } finally {
          $stream.Dispose()
        }
      } finally {
        $icon.Dispose()
        [void][Win32Interop.IconNative]::DestroyIcon($hIcon)
      }
    } finally {
      $resized.Dispose()
    }
  } finally {
    $source.Dispose()
  }
}

Push-Location $RootDir
try {
  Write-Host ""
  Write-Info "Creando acceso directo de FENIX..."

  if (-not (Test-Path $LaunchScript)) {
    Write-Fail "No se encuentra scripts\launch.ps1."
    exit 1
  }

  if (-not (Test-Path $IconDir)) {
    New-Item -ItemType Directory -Path $IconDir -Force | Out-Null
  }

  if (Test-Path $FaviconPath) {
    try {
      New-IconFromPng -PngPath $FaviconPath -IcoPath $IconPath
      Write-Ok "Icono generado en $IconPath"
    } catch {
      Write-Info "No se pudo generar el icono personalizado ($($_.Exception.Message)). Se usara el icono por defecto de PowerShell."
      $IconPath = $null
    }
  } else {
    Write-Info "No se encontro public\icon-256.png. Se usara el icono por defecto de PowerShell."
    $IconPath = $null
  }

  $desktop = [Environment]::GetFolderPath("Desktop")
  $shortcutPath = Join-Path $desktop $ShortcutName

  $arguments = "-NoLogo -ExecutionPolicy Bypass -File `"$LaunchScript`""
  if ($ProjectId) { $arguments += " -ProjectId `"$ProjectId`"" }

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = "$PSHOME\powershell.exe"
  $shortcut.Arguments = $arguments
  $shortcut.WorkingDirectory = $RootDir
  $shortcut.Description = "FENIX"
  $shortcut.WindowStyle = 1
  if ($IconPath -and (Test-Path $IconPath)) {
    $shortcut.IconLocation = "$IconPath,0"
  }
  $shortcut.Save()

  Write-Ok "Acceso directo creado en el Escritorio: $ShortcutName"
  Write-Info "Doble clic para arrancar FENIX y abrir el navegador automaticamente."
} finally {
  Pop-Location
}
