#!/bin/zsh
DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="/Users/elias/.nvm/versions/node/v22.14.0/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "===================================================="
echo "  Vereinskeller Inventur & Bestands-App wird gestartet"
echo "===================================================="
echo ""
echo "Öffne im Browser: http://localhost:5173"
echo "(Zum Beenden einfach dieses Fenster schließen oder Strg+C drücken)"
echo ""

(sleep 2 && open "http://localhost:5173") &
cd "$DIR/../2_code" && npm run dev
