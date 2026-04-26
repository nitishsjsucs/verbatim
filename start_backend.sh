#!/bin/bash
# Start the Govinda backend with MongoDB Atlas
# Usage: ./start_backend.sh
# Optional: ./start_backend.sh --ngrok-domain "maniacally-unaggravating-delisa.ngrok-free.dev"

NGROK_DOMAIN=""

# Parse args
while [[ $# -gt 0 ]]; do
    case $1 in
        --ngrok-domain|-NgrokDomain)
            NGROK_DOMAIN="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

# Load .env file
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
    while IFS= read -r line; do
        # Skip comments and blank lines
        [[ "$line" =~ ^\s*# ]] && continue
        [[ -z "$line" ]] && continue
        if [[ "$line" =~ ^([^=]+)=(.*)$ ]]; then
            key="${BASH_REMATCH[1]// /}"
            val="${BASH_REMATCH[2]}"
            export "$key"="$val"
        fi
    done < "$ENV_FILE"
    echo ".env loaded"
else
    echo "WARNING: No .env file found. Create one from .env.example"
fi

# Kill anything already on port 8001
EXISTING_PID=$(lsof -ti tcp:8001 2>/dev/null)
if [[ -n "$EXISTING_PID" ]]; then
    echo "Killing existing process on port 8001..."
    kill -9 $EXISTING_PID 2>/dev/null
    sleep 0.5
fi

echo "Starting Govinda backend on port 8001..."

# Start ngrok in a new terminal tab if domain provided
if [[ -n "$NGROK_DOMAIN" ]]; then
    echo "Starting ngrok tunnel for domain: $NGROK_DOMAIN"
    osascript -e "tell application \"Terminal\" to do script \"ngrok http --region=in --domain=$NGROK_DOMAIN 8001\"" &
fi

# Use venv uvicorn if present
if [[ -f "$SCRIPT_DIR/.venv/bin/uvicorn" ]]; then
    "$SCRIPT_DIR/.venv/bin/uvicorn" app_backend.main:app --host 0.0.0.0 --port 8001
else
    uvicorn app_backend.main:app --host 0.0.0.0 --port 8001
fi
