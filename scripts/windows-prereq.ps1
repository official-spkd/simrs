# SIM RS · pemasangan prasyarat Windows. Jalankan di PowerShell "Run as Administrator".
#   Set-ExecutionPolicy -Scope Process Bypass; .\scripts\windows-prereq.ps1
$ErrorActionPreference = 'Stop'
function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Error "Jalankan PowerShell sebagai Administrator." }
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Write-Error "winget tidak ditemukan. Pasang 'App Installer' dari Microsoft Store." }

Step "WSL2 + Ubuntu 24.04"
$distros = (wsl --list --quiet) 2>$null
if ($distros -match 'Ubuntu-24.04') { Write-Host "Ubuntu-24.04 sudah ada." } else { wsl --install -d Ubuntu-24.04 }

Step "Docker Desktop"
winget install -e --id Docker.DockerDesktop --accept-source-agreements --accept-package-agreements

Step "Git for Windows"
winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements

Step "Visual Studio Code"
winget install -e --id Microsoft.VisualStudioCode --accept-source-agreements --accept-package-agreements

$wslcfg = Join-Path $env:USERPROFILE '.wslconfig'
if (-not (Test-Path $wslcfg)) {
  Step "Membuat .wslconfig (memori 8GB, 4 CPU)"
  "[wsl2]`nmemory=8GB`nprocessors=4`n" | Out-File -Encoding ascii $wslcfg
}

Write-Host "`nSelesai. Langkah berikutnya:" -ForegroundColor Green
Write-Host " 1. Restart Windows."
Write-Host " 2. Buka Docker Desktop > Settings > Resources > WSL Integration > aktifkan Ubuntu-24.04."
Write-Host " 3. Buka 'Ubuntu' dari Start Menu dan lanjutkan docs/11-setup-windows.md bagian 2."
