#Requires -Version 5.1
<#
.SYNOPSIS
  Install Character Studio onto this PC from the payload next to this script.

.PARAMETER InstallDir
  Where to put the app. Default: %LOCALAPPDATA%\Programs\CharacterStudio

.PARAMETER PayloadDir
  Folder that contains CharacterStudio.exe, app\, library\, runtime\.
  Default: <this script>\payload

.PARAMETER AllUsers
  Install for every account under Program Files (needs Administrator).

.PARAMETER NoDesktopShortcut
  Skip the desktop shortcut.
#>
[CmdletBinding()]
param(
  [string]$InstallDir = "",
  [string]$PayloadDir = "",
  [switch]$AllUsers,
  [switch]$NoDesktopShortcut
)

$ErrorActionPreference = "Stop"
$AppName = "Character Studio"
$AppId = "{8F3C2A1B-6D4E-4B9A-A2C1-91E0D7B5F4A3}"
$Publisher = "Character Studio"
$Version = "1.0.0"

function Test-IsAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($id)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-ScriptRoot {
  if ($PSScriptRoot) { return $PSScriptRoot }
  return Split-Path -Parent $MyInvocation.MyCommand.Path
}

$root = Get-ScriptRoot
if (-not $PayloadDir) {
  $PayloadDir = Join-Path $root "payload"
}
if (-not $InstallDir) {
  if ($AllUsers) {
    $InstallDir = Join-Path ${env:ProgramFiles} "CharacterStudio"
  } else {
    $InstallDir = Join-Path $env:LOCALAPPDATA "Programs\CharacterStudio"
  }
}

$exeName = "CharacterStudio.exe"
$payloadExe = Join-Path $PayloadDir $exeName
$payloadApp = Join-Path $PayloadDir "app\app.py"
$payloadPy = Join-Path $PayloadDir "runtime\python\pythonw.exe"

Write-Host ""
Write-Host "Character Studio installer"
Write-Host "=========================="
Write-Host "Payload : $PayloadDir"
Write-Host "Install : $InstallDir"
Write-Host ""

if (-not (Test-Path $payloadExe)) {
  throw "Missing $payloadExe. Run Build-Payload.ps1 on the build machine first, or copy the full payload folder."
}
if (-not (Test-Path $payloadApp)) {
  throw "Missing app\app.py in the payload."
}
if (-not (Test-Path $payloadPy)) {
  throw "Missing runtime\python\pythonw.exe. This package needs the full runtime folder (ComfyUI, Blender, Python)."
}

if ($AllUsers -and -not (Test-IsAdmin)) {
  throw "AllUsers install needs an elevated PowerShell (Run as administrator)."
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

Write-Host "Copying files (runtime is large; this can take a while)..."
$robolog = Join-Path $env:TEMP ("CharacterStudio-install-" + [guid]::NewGuid().ToString("N") + ".log")
$rc = Start-Process -FilePath "robocopy.exe" -ArgumentList @(
  "`"$PayloadDir`"",
  "`"$InstallDir`"",
  "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:2", "/W:2",
  "/XD", "payload"
) -Wait -PassThru -NoNewWindow
# robocopy exit codes 0-7 are success
if ($rc.ExitCode -ge 8) {
  throw "Copy failed (robocopy exit $($rc.ExitCode)). Log hint: $robolog"
}

# Drop the nested installer helpers into the install root for uninstall.
Copy-Item -Force (Join-Path $root "Uninstall-CharacterStudio.ps1") (Join-Path $InstallDir "Uninstall-CharacterStudio.ps1")
if (Test-Path (Join-Path $PayloadDir "README.md")) {
  Copy-Item -Force (Join-Path $PayloadDir "README.md") (Join-Path $InstallDir "README.md") -ErrorAction SilentlyContinue
}

$installedExe = Join-Path $InstallDir $exeName
if (-not (Test-Path $installedExe)) {
  throw "Install finished but $installedExe is missing."
}

# Start Menu
$programs = if ($AllUsers) {
  Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs"
} else {
  Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
}
$startDir = Join-Path $programs $AppName
New-Item -ItemType Directory -Force -Path $startDir | Out-Null

$wsh = New-Object -ComObject WScript.Shell
$startLink = Join-Path $startDir "$AppName.lnk"
$sc = $wsh.CreateShortcut($startLink)
$sc.TargetPath = $installedExe
$sc.WorkingDirectory = $InstallDir
$sc.IconLocation = (Join-Path $InstallDir "CharacterStudio.ico") + ",0"
if (-not (Test-Path (Join-Path $InstallDir "CharacterStudio.ico"))) {
  $sc.IconLocation = "$installedExe,0"
}
$sc.Save()

$uninstallLink = Join-Path $startDir "Uninstall $AppName.lnk"
$usc = $wsh.CreateShortcut($uninstallLink)
$usc.TargetPath = "powershell.exe"
$usc.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $InstallDir 'Uninstall-CharacterStudio.ps1')`""
$usc.WorkingDirectory = $InstallDir
$usc.Save()

if (-not $NoDesktopShortcut) {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $deskLink = Join-Path $desktop "$AppName.lnk"
  $dsc = $wsh.CreateShortcut($deskLink)
  $dsc.TargetPath = $installedExe
  $dsc.WorkingDirectory = $InstallDir
  $dsc.IconLocation = $sc.IconLocation
  $dsc.Save()
}

# Add/Remove Programs
$uninstallCmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $InstallDir 'Uninstall-CharacterStudio.ps1')`""
$regRoot = if ($AllUsers) {
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppId"
} else {
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppId"
}
New-Item -Path $regRoot -Force | Out-Null
Set-ItemProperty $regRoot -Name "DisplayName" -Value $AppName
Set-ItemProperty $regRoot -Name "DisplayVersion" -Value $Version
Set-ItemProperty $regRoot -Name "Publisher" -Value $Publisher
Set-ItemProperty $regRoot -Name "InstallLocation" -Value $InstallDir
Set-ItemProperty $regRoot -Name "DisplayIcon" -Value $installedExe
Set-ItemProperty $regRoot -Name "UninstallString" -Value $uninstallCmd
Set-ItemProperty $regRoot -Name "QuietUninstallString" -Value "$uninstallCmd -Quiet"
Set-ItemProperty $regRoot -Name "NoModify" -Value 1 -Type DWord
Set-ItemProperty $regRoot -Name "NoRepair" -Value 1 -Type DWord
try {
  $bytes = (Get-ChildItem $InstallDir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  if ($bytes) {
    Set-ItemProperty $regRoot -Name "EstimatedSize" -Value ([int]($bytes / 1KB)) -Type DWord
  }
} catch {}

# Remember where we installed for the uninstaller.
$set = @{
  InstallDir = $InstallDir
  AllUsers = [bool]$AllUsers
  AppId = $AppId
  AppName = $AppName
  Version = $Version
}
$set | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $InstallDir "install.json")

Write-Host ""
Write-Host "Installed $AppName to:"
Write-Host "  $InstallDir"
Write-Host "Start Menu and desktop shortcuts are ready."
Write-Host "Uninstall from Start Menu, Settings > Apps, or Uninstall-CharacterStudio.ps1."
Write-Host ""
