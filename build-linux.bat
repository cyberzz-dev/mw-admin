@echo off
setlocal EnableDelayedExpansion
chcp 65001 > nul

set ROOT=%~dp0
set FRONTEND=%ROOT%frontend
set BACKEND=%ROOT%backend
set WEB_TMP=%BACKEND%\cmd\web
set OUTPUT=%ROOT%mw-admin

:: Target architecture: default amd64, override with: build-linux.bat arm64
set ARCH=%1
if "%ARCH%"=="" set ARCH=amd64

echo ===== mw-admin Linux Cross-Compile Build =====
echo Target : linux/%ARCH%
echo.

:: Step 1: Build frontend
echo [1/4] Building frontend...
cd /d "%FRONTEND%"
call npm run build
if errorlevel 1 (
    echo [ERROR] Frontend build failed
    exit /b 1
)
cd /d "%ROOT%"
echo.

:: Step 2: Copy dist into backend embed dir
echo [2/4] Copying dist to backend embed dir...
if exist "%WEB_TMP%" rmdir /s /q "%WEB_TMP%"
xcopy /e /i /q /y "%FRONTEND%\dist" "%WEB_TMP%\dist\"
if errorlevel 1 (
    echo [ERROR] Failed to copy frontend dist
    exit /b 1
)
echo.

:: Step 3: Cross-compile Go binary for Linux
echo [3/4] Cross-compiling Go binary (linux/%ARCH%)...
cd /d "%BACKEND%"
set GOOS=linux
set GOARCH=%ARCH%
set CGO_ENABLED=0
go build -tags prod -ldflags="-s -w" -trimpath -o "%OUTPUT%" .\cmd\
if errorlevel 1 (
    cd /d "%ROOT%"
    rmdir /s /q "%WEB_TMP%"
    echo [ERROR] Go build failed
    exit /b 1
)
cd /d "%ROOT%"
echo.

:: Step 4: Clean up temporary embed dir
echo [4/4] Cleaning up...
rmdir /s /q "%WEB_TMP%"
echo.

echo ===== Build complete! =====
echo Output : %OUTPUT%  (linux/%ARCH% ELF binary)
echo.
echo Deploy : scp mw-admin user@host:/path/
echo Run    : chmod +x mw-admin ^&^& ./mw-admin
echo Access : http://host:8080
echo.
