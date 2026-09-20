#!/usr/bin/env bash
# ============================================================
#  Планировщик квартиры: обновить и запустить (Linux и macOS)
#  Запуск: ./start.sh
# ============================================================
set -u

REPO="https://github.com/Igor123qwe/3d.git"
PORT="${PORT:-5173}"
cd "$(dirname "$0")"

fail() {
  echo
  echo "Не получилось: $1"
  exit 1
}

command -v git >/dev/null 2>&1 || fail "не найден git"
command -v npm >/dev/null 2>&1 || fail "не найден Node.js (нужна версия 20 или новее)"

# ---------- если рядом нет проекта, забираем его ----------
if [ ! -f package.json ]; then
  echo "[1/4] Проект рядом не найден, забираю из git..."
  git clone "$REPO" 3d || fail "не удалось склонировать"
  cd 3d
else
  echo "[1/4] Обновляю из git..."
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git pull --ff-only || echo "[!] Обновиться не вышло — похоже, есть свои несохранённые правки. Продолжаю на том, что лежит на диске."
  fi
fi

# ---------- зависимости ----------
# ставим, только если их нет или package-lock.json новее отметки
if [ ! -d node_modules ] || [ ! -f .npm-stamp ] || [ package-lock.json -nt .npm-stamp ]; then
  echo "[2/4] Ставлю зависимости, это займёт пару минут..."
  npm install || fail "npm install не отработал"
  touch .npm-stamp
else
  echo "[2/4] Зависимости на месте."
fi

# ---------- настройки ----------
if [ ! -f .env ]; then
  [ -f .env.example ] && cp .env.example .env
  echo "[3/4] Создан файл .env. Чтобы включить ИИ, впишите в него ключ ROUTERAI_API_KEY."
  echo "      Без ключа приложение работает, просто без кнопок с ИИ."
else
  echo "[3/4] Настройки на месте."
fi

# ---------- запуск ----------
echo "[4/4] Запускаю. Адрес: http://localhost:$PORT"
echo
echo "    Чтобы остановить — Ctrl+C."
echo

# браузер открываем фоном, когда сервер уже поднимется
(
  for _ in $(seq 1 40); do
    if curl -s -o /dev/null "http://localhost:$PORT/"; then break; fi
    sleep 0.5
  done
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$PORT" >/dev/null 2>&1
  elif command -v open >/dev/null 2>&1; then open "http://localhost:$PORT" >/dev/null 2>&1
  fi
) &

exec npm run dev -- --port "$PORT"
