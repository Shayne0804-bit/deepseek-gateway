# Demarre DeepSeek Gateway sur Windows (PowerShell).
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js est introuvable. Installez Node.js 24+ : https://nodejs.org/" -ForegroundColor Red
    Read-Host "Appuyez sur Entree pour fermer"
    exit 1
}

if (-not (Test-Path (Join-Path $PSScriptRoot 'data'))) {
    New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot 'data') | Out-Null
}

node server.js
