@echo off
rem Snap installer for Windows: downloads the latest release installer and runs it.
rem Double-click this file.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; $r = Invoke-RestMethod 'https://api.github.com/repos/ponya5/snap/releases/latest'; $a = $r.assets | Where-Object name -like '*.exe' | Select-Object -First 1; if (-not $a) { throw 'No .exe in the latest release: https://github.com/ponya5/snap/releases' }; $f = Join-Path $env:TEMP $a.name; Write-Host ('Downloading ' + $a.name); Invoke-WebRequest $a.browser_download_url -OutFile $f; Start-Process $f -Wait; Remove-Item $f -ErrorAction SilentlyContinue"
if errorlevel 1 (echo Install failed. & pause & exit /b 1)
echo Done. Snap runs in the system tray.
pause
