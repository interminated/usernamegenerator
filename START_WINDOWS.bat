@echo off
chcp 65001 >nul
cd /d "%~dp0"
node --version >nul 2>&1
if errorlevel 1 (
 echo Установите Node.js 22.13 или новее: https://nodejs.org/
 pause
 exit /b 1
)
node server.js
pause
