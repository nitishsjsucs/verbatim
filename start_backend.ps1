# Start the full Govinda stack (backend + frontend + optional ngrok tunnel)
# Usage:
#   .\start_backend.ps1                                          # local dev only
#   .\start_backend.ps1 -NgrokDomain "your-domain.ngrok-free.app"   # expose via ngrok

param(
    [string]$NgrokDomain = ""
)

# ── Load root .env (backend secrets) ────────────────────────────────────────
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

$webDir = Join-Path $PSScriptRoot "web"

# ── Determine the public app URL ─────────────────────────────────────────────
if ($NgrokDomain -ne "") {
    # Strip any protocol the user may have included, then normalise
    $cleanDomain = $NgrokDomain -replace "^https?://", ""
    $appUrl = "https://$cleanDomain"
} else {
    $appUrl = "http://localhost:3000"
}

Write-Host "App URL: $appUrl" -ForegroundColor Cyan

# ── Write web/.env.local so Next.js auth uses the correct origin ──────────────
$webEnvLocal = Join-Path $webDir ".env.local"

# Load existing web .env.local so we don't lose other keys (e.g. BETTER_AUTH_SECRET)
$existingEnv = @{}
if (Test-Path $webEnvLocal) {
    Get-Content $webEnvLocal | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $existingEnv[$matches[1].Trim()] = $matches[2].Trim()
        }
    }
}

# Override the URL-related keys
$existingEnv["BETTER_AUTH_URL"]        = $appUrl
$existingEnv["NEXT_PUBLIC_AUTH_URL"]   = $appUrl
$existingEnv["NEXT_PUBLIC_APP_URL"]    = $appUrl
# NEXT_PUBLIC_API_URL is no longer needed (proxy handles it), but keep blank to avoid overriding
$existingEnv.Remove("NEXT_PUBLIC_API_URL") | Out-Null

# Write back
$lines = $existingEnv.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }
$lines | Set-Content $webEnvLocal
Write-Host "web/.env.local updated" -ForegroundColor DarkGray

# ── Kill anything on port 8001 ────────────────────────────────────────────────
$existing = Get-NetTCPConnection -LocalPort 8001 -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Killing existing process on port 8001..." -ForegroundColor Yellow
    $existing | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500
}

# ── Kill anything on port 3000 ────────────────────────────────────────────────
$existing3000 = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($existing3000) {
    Write-Host "Killing existing process on port 3000..." -ForegroundColor Yellow
    $existing3000 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500
}

# ── Start ngrok tunnel (frontend port 3000) ───────────────────────────────────
if ($NgrokDomain -ne "") {
    Write-Host "Starting ngrok tunnel: $appUrl -> localhost:3000" -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "ngrok http --domain=$cleanDomain 3000"
    Start-Sleep -Seconds 2
}

# ── Start Next.js dev server ──────────────────────────────────────────────────
Write-Host "Starting Next.js frontend on port 3000..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$webDir'; npm run dev"

# ── Start FastAPI backend (blocks — this window stays open as the backend log) ─
Write-Host "Starting Govinda backend on port 8001..." -ForegroundColor Cyan
uvicorn app_backend.main:app --host 0.0.0.0 --port 8001
