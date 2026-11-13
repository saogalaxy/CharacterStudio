#Requires -Version 5.1
<#
.SYNOPSIS
  Deprecated path name.

  A single giant Setup.exe hits Windows/Inno ~4GB limits with this runtime.
  Use the labeled Offline ZIP folder instead (same idea: one package to send).
#>
Write-Host ""
Write-Host "Single-file Setup.exe is not used (runtime is too large for one .exe)."
Write-Host "Use the OFFLINE zip package instead:"
Write-Host ""
Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File installer\Build-OfflinePackage.ps1"
Write-Host ""
Write-Host "Output: dist\CharacterStudio-Offline-Install\  →  Offline-Setup.exe + payload\"
Write-Host "For Git users: installer\Build-OnlineSetup.ps1 → Online-Setup.exe (downloads runtime)."
Write-Host ""
exit 1
