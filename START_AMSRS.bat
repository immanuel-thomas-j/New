@echo off
title AMSRS Coastal Rescue System
cd /d "%~dp0"
echo =======================================================
echo  Starting AMSRS Real-Time Relay & Guard Server...
echo =======================================================
echo.
start http://localhost:8080/console
node server.js
pause
