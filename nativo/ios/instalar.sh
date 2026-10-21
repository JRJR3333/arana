#!/bin/bash
# Prepara la app de la araña en el Mac de Juan y abre Xcode.
# Uso (en Terminal):
#   curl -fsSL https://raw.githubusercontent.com/JRJR3333/arana/master/nativo/ios/instalar.sh | bash
# Se puede repetir cuando quiera: baja la última versión y vuelve a preparar el proyecto.
set -euo pipefail

DEST="${HOME}/Arana"
TOOLS="${HOME}/.arana"
REPO="https://github.com/JRJR3333/arana.git"

say() { printf '\n\033[1m🕷  %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1"; exit 1; }

# 1. Xcode
say "Compruebo Xcode..."
if ! xcodebuild -version >/dev/null 2>&1; then
  if [ -d /Applications/Xcode.app ]; then
    fail "Xcode está instalado pero no activo. Ejecute:  sudo xcode-select -s /Applications/Xcode.app  y vuelva a lanzar este comando."
  fi
  fail "Falta Xcode. Instálelo gratis desde la App Store, ábralo una vez (acepte la licencia y descargue «iOS») y vuelva a lanzar este comando."
fi
xcodebuild -version | head -1

# 2. Código de la araña
if [ -d "${DEST}/.git" ]; then
  say "Bajo la última versión de la araña..."
  git -C "${DEST}" pull --ff-only
else
  say "Descargo la araña en ${DEST}..."
  git clone --depth 1 "${REPO}" "${DEST}"
fi

# 3. XcodeGen (genera el proyecto de Xcode a partir de project.yml)
if command -v xcodegen >/dev/null 2>&1; then
  XCODEGEN="xcodegen"
else
  XCODEGEN="${TOOLS}/xcodegen/bin/xcodegen"
  if [ ! -x "${XCODEGEN}" ]; then
    say "Descargo XcodeGen (solo la primera vez)..."
    mkdir -p "${TOOLS}"
    curl -fsSL -o "${TOOLS}/xcodegen.zip" \
      https://github.com/yonaskolb/XcodeGen/releases/latest/download/xcodegen.zip
    rm -rf "${TOOLS}/xcodegen"
    unzip -q -o "${TOOLS}/xcodegen.zip" -d "${TOOLS}"
    chmod +x "${TOOLS}/xcodegen/bin/xcodegen"
    rm -f "${TOOLS}/xcodegen.zip"
  fi
fi

say "Preparo el proyecto..."
cd "${DEST}/nativo/ios"
"${XCODEGEN}" generate --quiet

# 4. Abrir Xcode
say "Abro Xcode. Ahora siga la guía: elegir su equipo y pulsar ▶."
open Arana.xcodeproj
