@echo off
cd /d "%~dp0backend"
echo Starting backend on :8080...
go run ./cmd
