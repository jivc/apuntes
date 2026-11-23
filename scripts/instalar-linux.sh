#!/usr/bin/env bash
# Instala Apuntes en Linux (Fedora, Ubuntu, etc.) para tu usuario, sin necesidad de sudo.
# Uso:  bash instalar-linux.sh                (busca apuntes-*.tar.gz en esta carpeta)
#       bash instalar-linux.sh --desinstalar
set -euo pipefail
DEST="$HOME/.local/share/apuntes"
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor/512x512/apps"

if [[ "${1:-}" == "--desinstalar" ]]; then
  rm -rf "$DEST" "$APPS/apuntes.desktop" "$ICONS/apuntes.png" "$HOME/.local/bin/apuntes"
  echo "Apuntes se desinstaló. Tus notas siguen en tu carpeta de Dropbox."
  exit 0
fi

cd "$(dirname "$0")"
TAR="${1:-$(ls apuntes-*.tar.gz 2>/dev/null | sort -V | tail -1)}"
[[ -f "$TAR" ]] || { echo "No encontré apuntes-*.tar.gz junto a este script."; exit 1; }

echo "Instalando $TAR en $DEST…"
rm -rf "$DEST" && mkdir -p "$DEST" "$APPS" "$ICONS" "$HOME/.local/bin"
tar -xzf "$TAR" -C "$DEST" --strip-components=1
cp "$DEST/apuntes.png" "$ICONS/apuntes.png"
ln -sf "$DEST/apuntes" "$HOME/.local/bin/apuntes"

cat > "$APPS/apuntes.desktop" <<DESKTOP
[Desktop Entry]
Name=Apuntes
Comment=Notas Markdown sincronizadas con Dropbox
Exec="$DEST/apuntes" %U
Icon=apuntes
Type=Application
Categories=Office;TextEditor;
StartupWMClass=Apuntes
Terminal=false
DESKTOP
update-desktop-database "$APPS" >/dev/null 2>&1 || true
gtk-update-icon-cache "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true
echo "Listo. Busca «Apuntes» en tus aplicaciones (o escribe: apuntes)."
