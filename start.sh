#!/usr/bin/env sh
# Планировщик квартиры: обновить и запустить (Linux и macOS).
# Вся работа в tools/start.mjs — здесь только проверки и клонирование.
set -u
cd "$(dirname "$0")"

command -v node >/dev/null 2>&1 || { echo "Нужен Node.js 20 или новее: https://nodejs.org"; exit 1; }
command -v git  >/dev/null 2>&1 || { echo "Нужен git"; exit 1; }

if [ ! -f tools/start.mjs ]; then
  if [ ! -f 3d/tools/start.mjs ]; then
    echo "Забираю проект из GitHub..."
    git clone https://github.com/Igor123qwe/3d.git 3d || exit 1
  fi
  cd 3d
fi

exec node tools/start.mjs "$@"
