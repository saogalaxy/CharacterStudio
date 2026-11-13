#Requires -Version 5.1
<#
.SYNOPSIS
  Build the ONLINE installer (small, Git-friendly).

  Output:
    dist\CharacterStudio-Online-Install\
      Online-Setup.exe
      Uninstall.exe
      online-manifest.json
      README-ONLINE.txt

  This does NOT include runtime. Users need runtimeBundleUrl set, then
  Online-Setup.exe downloads CharacterStudio-Runtime.zip.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

function Invoke-Csc([string]$outExe, [string]$source, [string]$ico) {
  $csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
  if (-not (Test-Path $csc)) { throw "csc.exe not found" }
  $args = @("/nologo", "/target:winexe", "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll")
  if ($ico -and (Test-Path $ico)) { $args += "/win32icon:$ico" }
  $args += "/out:$outExe", $source
  & $csc @args
  if ($LASTEXITCODE -ne 0) { throw "csc failed" }
}

$installerDir = $PSScriptRoot
$repo = Split-Path -Parent $installerDir
$outRoot = Join-Path $repo "dist\CharacterStudio-Online-Install"
$ico = Join-Path $repo "CharacterStudio.ico"

Write-Host "Building ONLINE installer (download runtime)..."
New-Item -ItemType Directory -Force -Path $outRoot | Out-Null

$onlineExe = Join-Path $installerDir "Online-Setup.exe"
$uninst = Join-Path $installerDir "Uninstall.exe"
Invoke-Csc $onlineExe (Join-Path $installerDir "OnlineSetup\Program.cs") $ico
Invoke-Csc $uninst (Join-Path $installerDir "Uninstall\Program.cs") $ico

# Also rebuild app launcher so the repo has a current exe for the online installer to copy.
$tmp = Join-Path $repo "CharacterStudio.new.exe"
Invoke-Csc $tmp (Join-Path $repo "launcher\Program.cs") $ico
Move-Item -Force $tmp (Join-Path $repo "CharacterStudio.exe")

Copy-Item -Force $onlineExe (Join-Path $outRoot "Online-Setup.exe")
Copy-Item -Force $uninst (Join-Path $outRoot "Uninstall.exe")
Copy-Item -Force (Join-Path $installerDir "online-manifest.json") (Join-Path $outRoot "online-manifest.json")

@"
Character Studio — ONLINE install package
=========================================
Small installer for Git users. Downloads the runtime from the internet.

Before you share:
1. On your build PC run:  installer\Publish-RuntimeBundle.ps1
2. Upload dist\CharacterStudio-Runtime.zip somewhere with an HTTPS link
3. Put that link in online-manifest.json → runtimeBundleUrl
4. Commit/push the Git repo (app, library, installer). Users clone it.
5. They run Online-Setup.exe from this folder (or from installer\ after build)

Do not confuse with Offline-Setup.exe (full USB package, no download).
"@ | Set-Content -Encoding UTF8 (Join-Path $outRoot "README-ONLINE.txt")

Write-Host ""
Write-Host "Done. ONLINE package:"
Write-Host "  $outRoot"
Write-Host "Set runtimeBundleUrl in online-manifest.json after you host the runtime zip."
Write-Host ""
