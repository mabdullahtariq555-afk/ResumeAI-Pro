@echo off
setlocal
echo ResumeAI Pro - No Login setup
echo.
set /p GEMINI_API_KEY=Enter Gemini API key: 
(
echo GEMINI_API_KEY=%GEMINI_API_KEY%
echo GEMINI_MODEL=gemini-3.1-flash-lite
echo PORT=3000
) > .env
echo.
echo .env created. Run: npm.cmd install ^&^& npm.cmd start
pause
