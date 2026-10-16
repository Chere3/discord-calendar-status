#!/bin/zsh
# Compila el lector de calendario, lo registra en launchd y construye Vencord con el plugin.
set -euo pipefail
cd "${0:A:h}"

BIN="$HOME/.local/bin/discord-calendar-state"
PLIST="$HOME/Library/LaunchAgents/com.diego.discord-calendar-status.plist"
LOGS="$HOME/Library/Logs/discord-calendar-status.log"

# El binario vive fuera del disco externo para que launchd no necesite permiso de volúmenes extraíbles.
swiftc -O calendar/main.swift -o "$BIN" \
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker calendar/Info.plist
codesign -s - -f --identifier com.diego.discord-calendar-status "$BIN"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.diego.discord-calendar-status</string>
    <key>ProgramArguments</key>
    <array>
        <string>$BIN</string>
    </array>
    <key>StartInterval</key>
    <integer>60</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>$LOGS</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$UID/com.diego.discord-calendar-status" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"

# Vencord resuelve los alias (@api, @utils) desde su propio árbol, así que el plugin se copia, no se enlaza.
[[ -d vendor/Vencord ]] || git clone --depth 1 https://github.com/Vendicated/Vencord vendor/Vencord
rm -rf vendor/Vencord/src/userplugins/calendarStatus
mkdir -p vendor/Vencord/src/userplugins
cp -R plugin/calendarStatus vendor/Vencord/src/userplugins/
cd vendor/Vencord
npx -y pnpm@11.9.0 install --frozen-lockfile
npx -y pnpm@11.9.0 build
# Sin package.json Vesktop considera inválida la carpeta y la pisa con el Vencord oficial.
[[ -f dist/package.json ]] || echo '{}' > dist/package.json

echo "Listo. Vencord compilado en $PWD/dist"
