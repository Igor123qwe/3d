@echo off
rem ============================================================
rem  Планировщик квартиры: обновить и запустить (Windows)
rem  Запуск: дважды щёлкнуть по файлу.
rem ============================================================
chcp 65001 >nul
setlocal enabledelayedexpansion
title Планировщик квартиры

set "REPO=https://github.com/Igor123qwe/3d.git"
set "PORT=5173"
cd /d "%~dp0"

rem ---------- проверка инструментов ----------
where git >nul 2>nul || (
  echo [X] Не найден git. Поставьте его: https://git-scm.com/download/win
  goto :fail
)
where npm >nul 2>nul || (
  echo [X] Не найден Node.js. Поставьте версию 20 или новее: https://nodejs.org
  goto :fail
)

rem ---------- если рядом нет проекта, забираем его ----------
if not exist "package.json" (
  echo [1/4] Проект рядом не найден, забираю из git...
  git clone "%REPO%" "3d" || goto :fail
  cd /d "%~dp03d"
) else (
  echo [1/4] Обновляю из git...
  git rev-parse --is-inside-work-tree >nul 2>nul && (
    git pull --ff-only || (
      echo [!] Обновиться не вышло: похоже, есть свои несохранённые правки.
      echo     Продолжаю на том, что лежит на диске.
    )
  )
)

rem ---------- зависимости ----------
set "NEED_INSTALL="
if not exist "node_modules" set "NEED_INSTALL=1"
if not exist ".npm-stamp" set "NEED_INSTALL=1"
if exist ".npm-stamp" (
  rem package-lock.json новее отметки — значит зависимости поменялись
  for /f %%i in ('dir /b /o-d "package-lock.json" ".npm-stamp" 2^>nul') do (
    if "%%i"=="package-lock.json" set "NEED_INSTALL=1"
    goto :checked
  )
)
:checked
if defined NEED_INSTALL (
  echo [2/4] Ставлю зависимости, это займёт пару минут...
  call npm install || goto :fail
  echo. > ".npm-stamp"
) else (
  echo [2/4] Зависимости на месте.
)

rem ---------- настройки ----------
if not exist ".env" (
  if exist ".env.example" copy /y ".env.example" ".env" >nul
  echo [3/4] Создан файл .env. Чтобы включить ИИ, впишите в него ключ ROUTERAI_API_KEY.
  echo       Без ключа приложение работает, просто без кнопок с ИИ.
) else (
  echo [3/4] Настройки на месте.
)

rem ---------- запуск ----------
echo [4/4] Запускаю. Адрес: http://localhost:%PORT%
echo.
echo     Браузер откроется сам через несколько секунд.
echo     Чтобы остановить — закройте это окно или нажмите Ctrl+C.
echo.
start "" cmd /c "timeout /t 5 >nul & start """" http://localhost:%PORT%"
call npm run dev -- --port %PORT%
goto :eof

:fail
echo.
echo Не получилось. Текст ошибки выше.
pause
exit /b 1
