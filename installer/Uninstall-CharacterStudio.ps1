#Requires -Version 5.1
<#
.SYNOPSIS
  Remove a Character Studio install created by Install-CharacterStudio.ps1.

.PARAMETER Quiet
  Do not ask for confirmation.
#>
[CmdletBinding()]
param(
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$AppName = "Character Studio"
$AppId = "{8F3C2A1B-6D4E-4B9A-A2C1-91E0D7B5F4A3}"

function Get-ScriptRoot {
  if ($PSScriptRoot) { return $PSScriptRoot }
  return Split-Path -Parent $MyInvocation.MyCommand.Path
}

$root = Get-ScriptRoot
$metaPath = Join-Path $root "install.json"
$InstallDir = $root
$AllUsers = $false

if (Test-Path $metaPath) {
  $meta = Get-Content $metaPath -Raw | ConvertFrom-Json
  if ($meta.InstallDir) { $InstallDir = [string]$meta.InstallDir }
  if ($meta.AllUsers) { $AllUsers = [bool]$meta.AllUsers }
  if ($meta.AppId) { $AppId = [string]$meta.AppId }
  if ($meta.AppName) { $AppName = [string]$meta.AppName }
}

if (-not $Quiet) {
  $answer = Read-Host "Uninstall $AppName from `"$InstallDir`"? [y/N]"
  if ($answer -notmatch '^(y|yes)$') {
    Write-Host "Cancelled."
    exit 0
  }
}

Write-Host "Stopping Character Studio processes..."
Get-Process -Name "CharacterStudio","pythonw","python" -ErrorAction SilentlyContinue |
  Where-Object {
    try {
      $_.Path -and ($_.Path.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase))
    } catch { $false }
  } |
  ForEach-Object {
    try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch {}
  }

# Shortcuts
$programsUser = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$AppName"
$programsAll = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\$AppName"
foreach ($dir in @($programsUser, $programsAll)) {
  if (Test-Path $dir) {
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
$desktop = [Environment]::GetFolderPath("Desktop")
$deskLink = Join-Path $desktop "$AppName.lnk"
if (Test-Path $deskLink) {
  Remove-Item -LiteralPath $deskLink -Force -ErrorAction SilentlyContinue
}

# Registry
foreach ($hive in @(
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppId",
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppId"
)) {
  if (Test-Path $hive) {
    Remove-Item -LiteralPath $hive -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "Removing files from $InstallDir ..."
# Delete everything except this running script; schedule leftover removal.
$self = $MyInvocation.MyCommand.Path
Get-ChildItem -LiteralPath $InstallDir -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -ne $self } |
  ForEach-Object {
    Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
  }

$cmd = @"
Start-Sleep -Seconds 1
Remove-Item -LiteralPath '$InstallDir' -Recurse -Force -ErrorAction SilentlyContinue
"@
Start-Process -FilePath "powershell.exe" -ArgumentList @(
  "-NoProfile", "-WindowStyle", "Hidden", "-Command", $cmd
) -WindowStyle Hidden

Write-Host "Character Studio has been uninstalled."
