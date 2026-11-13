#Requires -Version 5.1
<#
.SYNOPSIS
  OFFLINE package — full copy for USB / zip (no download on the other PC).

  Output:
    dist\CharacterStudio-Offline-Install\
      Offline-Setup.exe     ← labeled offline installer
      Uninstall.exe
      payload\              ← exe, app, library, runtime, jobs

  Zip that folder and send it. They unzip → Offline-Setup.exe.

.PARAMETER AppOnly
  Skip runtime\ (test only).

.PARAMETER SkipRuntimeConfirm
  Do not prompt before copying runtime.
#>
[CmdletBinding()]
param(
  [switch]$AppOnly,
  [switch]$SkipRuntimeConfirm
)

$ErrorActionPreference = "Stop"

function Get-ScriptRoot {
  if ($PSScriptRoot) { return $PSScriptRoot }
  return Split-Path -Parent $MyInvocation.MyCommand.Path
}

function Invoke-Csc([string]$outExe, [string]$source, [string]$ico) {
  $csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
  if (-not (Test-Path $csc)) { throw "csc.exe not found at $csc" }
  $args = @("/nologo", "/target:winexe", "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll")
  if ($ico -and (Test-Path $ico)) { $args += "/win32icon:$ico" }
  $args += "/out:$outExe", $source
  & $csc @args
  if ($LASTEXITCODE -ne 0) { throw "csc failed for $source" }
}

$installerDir = Get-ScriptRoot
$repo = Split-Path -Parent $installerDir
$outRoot = Join-Path $repo "dist\CharacterStudio-Offline-Install"
$payload = Join-Path $outRoot "payload"
$ico = Join-Path $repo "CharacterStudio.ico"

Write-Host ""
Write-Host "Build OFFLINE install package (full local copy)"
Write-Host "Repo   : $repo"
Write-Host "Output : $outRoot"
Write-Host ""

$launcherCs = Join-Path $repo "launcher\Program.cs"
$exe = Join-Path $repo "CharacterStudio.exe"
Write-Host "Building CharacterStudio.exe..."
$tmp = Join-Path $repo "CharacterStudio.new.exe"
Invoke-Csc $tmp $launcherCs $ico
Move-Item -Force $tmp $exe

$setupOut = Join-Path $installerDir "Offline-Setup.exe"
$uninstOut = Join-Path $installerDir "Uninstall.exe"
Write-Host "Building Offline-Setup.exe..."
Invoke-Csc $setupOut (Join-Path $installerDir "Setup\Program.cs") $ico
Write-Host "Building Uninstall.exe..."
Invoke-Csc $uninstOut (Join-Path $installerDir "Uninstall\Program.cs") $ico

if (-not $AppOnly) {
  $runtime = Join-Path $repo "runtime"
  if (-not (Test-Path (Join-Path $runtime "python\pythonw.exe"))) {
    throw "runtime\python\pythonw.exe missing."
  }
  if (-not $SkipRuntimeConfirm) {
    $size = (Get-ChildItem $runtime -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    $gb = [math]::Round($size / 1GB, 1)
    Write-Host "runtime\ is about $gb GB."
    $answer = Read-Host "Continue? [Y/n]"
    if ($answer -match '^(n|no)$') { throw "Cancelled." }
  }
}

if (Test-Path $outRoot) {
  Write-Host "Removing old output..."
  Remove-Item -LiteralPath $outRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $payload | Out-Null

function Copy-Tree($from, $to) {
  New-Item -ItemType Directory -Force -Path $to | Out-Null
  $rc = Start-Process -FilePath "robocopy.exe" -ArgumentList @(
    "`"$from`"", "`"$to`"",
    "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:2", "/W:2",
    "/XD", "__pycache__", ".git"
  ) -Wait -PassThru -NoNewWindow
  if ($rc.ExitCode -ge 8) { throw "robocopy failed for $from (exit $($rc.ExitCode))" }
}

Write-Host "Copying app..."
Copy-Tree (Join-Path $repo "app") (Join-Path $payload "app")
Write-Host "Copying library..."
Copy-Tree (Join-Path $repo "library") (Join-Path $payload "library")
Copy-Item -Force $exe (Join-Path $payload "CharacterStudio.exe")
if (Test-Path $ico) { Copy-Item -Force $ico (Join-Path $payload "CharacterStudio.ico") }
if (Test-Path (Join-Path $repo "README.md")) {
  Copy-Item -Force (Join-Path $repo "README.md") (Join-Path $payload "README.md")
}
if (-not $AppOnly) {
  Write-Host "Copying runtime (long)..."
  Copy-Tree (Join-Path $repo "runtime") (Join-Path $payload "runtime")
}
New-Item -ItemType Directory -Force -Path (Join-Path $payload "jobs") | Out-Null

Copy-Item -Force $setupOut (Join-Path $outRoot "Offline-Setup.exe")
Copy-Item -Force $uninstOut (Join-Path $outRoot "Uninstall.exe")
Copy-Item -Force $uninstOut (Join-Path $payload "Uninstall.exe")

# Keep a short README inside the package.
@"
Character Studio — OFFLINE install package
==========================================
This folder is a full local install (app + runtime). No download.

1. Copy/unzip this whole folder onto the PC.
2. Double-click Offline-Setup.exe
3. Click Install.

Do not confuse with the Online Installer (Git + download runtime).
"@ | Set-Content -Encoding UTF8 (Join-Path $outRoot "README-OFFLINE.txt")

Write-Host ""
Write-Host "Done. OFFLINE package:"
Write-Host "  $outRoot"
Write-Host "Zip that folder and send it. They run Offline-Setup.exe"
Write-Host ""
