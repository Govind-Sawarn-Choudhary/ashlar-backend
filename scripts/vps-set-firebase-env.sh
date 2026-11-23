#!/usr/bin/env bash
# Run ON THE VPS inside backend/ after copying .firebase-service-account.json
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SA="$ROOT/.firebase-service-account.json"
ENV_FILE="$ROOT/.env"

if [[ ! -f "$SA" ]]; then
  echo "Missing $SA — copy from your machine (do not commit to git)."
  exit 1
fi

LINE="FIREBASE_SERVICE_ACCOUNT_JSON=$(node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync('$SA','utf8'))))")"

if grep -q '^FIREBASE_SERVICE_ACCOUNT_JSON=' "$ENV_FILE" 2>/dev/null; then
  sed -i.bak '/^FIREBASE_SERVICE_ACCOUNT_JSON=/d' "$ENV_FILE"
fi
echo "$LINE" >> "$ENV_FILE"
echo "Updated $ENV_FILE — restart: pm2 restart ashlar-api"