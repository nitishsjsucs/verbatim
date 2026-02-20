# Start the Govinda backend with MongoDB Atlas
# Usage: .\start_backend.ps1
# Optional: .\start_backend.ps1 -NgrokDomain "fox-happy-cobra.ngrok-free.app"

param(
    [string]$NgrokDomain = ""
)

# ── Load secrets from .env file (never committed to git) ─────────────────────
$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
        }
    }
    Write-Host ".env loaded" -ForegroundColor DarkGray
} else {
    Write-Host "WARNING: No .env file found at $envFile" -ForegroundColor Red
    Write-Host "Create one based on .env.example" -ForegroundColor Red
}
# ─────────────────────────────────────────────────────────────────────────────

Write-Host "Starting Govinda backend on port 8001..." -ForegroundColor Cyan

if ($NgrokDomain -ne "") {
    Write-Host "Starting ngrok tunnel for domain: $NgrokDomain" -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "ngrok http --domain=$NgrokDomain 8001"
}

uvicorn app_backend.main:app --host 0.0.0.0 --port 8001 --reload
