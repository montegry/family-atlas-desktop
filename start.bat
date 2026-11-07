@echo off
setlocal
cd /d "%~dp0"
if exist "src-tauri\target\release\family-atlas-desktop.exe" (
  start "" "src-tauri\target\release\family-atlas-desktop.exe"
  exit /b 0
)
echo Build the desktop application first: npm ci, then npm run build
pause
