# Start the Govinda backend with MongoDB Atlas
# Usage: .\start_backend.ps1
# Optional: .\start_backend.ps1 -NgrokDomain "fox-happy-cobra.ngrok-free.app"

param(
    [string]$NgrokDomain = ""
)

# ── Edit these once ──────────────────────────────────────────────────────────
# ── Load secrets from .env file (gitignored — never committed) ───────────────
$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
        }
    }
    Write-Host ".env loaded" -ForegroundColor DarkGray
} else {
    Write-Host "WARNING: No .env file found. Create one from .env.example" -ForegroundColor Red
}
# ─────────────────────────────────────────────────────────────────────────────

# Kill anything already on port 8001
$existing = Get-NetTCPConnection -LocalPort 8001 -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Killing existing process on port 8001..." -ForegroundColor Yellow
    $existing | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500
}

Write-Host "Starting Govinda backend on port 8001..." -ForegroundColor Cyan

if ($NgrokDomain -ne "") {
    Write-Host "Starting ngrok tunnel for domain: $NgrokDomain" -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "ngrok http --domain=$NgrokDomain 8001"
}

uvicorn app_backend.main:app --host 0.0.0.0 --port 8001
