#Requires -Version 5.1
<#
.SYNOPSIS
  Zip runtime\ into CharacterStudio-Runtime.zip for the ONLINE installer to download.

  1) Run this on your build PC.
  2) Upload dist\CharacterStudio-Runtime.zip to a host (Drive, R2, HF, etc.).
  3) Put the HTTPS link in installer\online-manifest.json → runtimeBundleUrl
  4) Ship the Online installer / Git repo. Users run Online-Setup.exe and it pulls the zip.
#>
[CmdletBinding()]
param(
  [switch]$SkipConfirm
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $repo "runtime"
$outDir = Join-Path $repo "dist"
$outZip = Join-Path $outDir "CharacterStudio-Runtime.zip"

if (-not (Test-Path (Join-Path $runtime "python\pythonw.exe"))) {
  throw "runtime\python\pythonw.exe missing."
}

$size = (Get-ChildItem $runtime -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
$gb = [math]::Round($size / 1GB, 1)
Write-Host "Packing runtime\ (~$gb GB) → $outZip"
if (-not $SkipConfirm) {
  $a = Read-Host "Continue? [Y/n]"
  if ($a -match '^(n|no)$') { throw "Cancelled." }
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
if (Test-Path $outZip) { Remove-Item -Force $outZip }

# Compress-Archive struggles with huge trees; use tar if available, else .NET zip via PowerShell 5 is slow.
$tar = Get-Command tar.exe -ErrorAction SilentlyContinue
if ($tar) {
  Push-Location $runtime
  try {
    & tar.exe -a -c -f $outZip *
    if ($LASTEXITCODE -ne 0) { throw "tar failed" }
  } finally { Pop-Location }
} else {
  Write-Host "Using Compress-Archive (slower)..."
  Compress-Archive -Path (Join-Path $runtime "*") -DestinationPath $outZip -Force
}

$final = (Get-Item $outZip).Length
Write-Host ""
Write-Host ("Created {0} ({1:N1} GB)" -f $outZip, ($final / 1GB))
Write-Host "Upload this file, then set runtimeBundleUrl in installer\online-manifest.json"
Write-Host ""
