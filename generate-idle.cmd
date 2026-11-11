@echo off
cd /d "%~dp0"
echo Shuazi idle video: ONE task, 5 seconds, 720p, silent.
echo Uploads public/assets/shuazi.png to Volcengine. API charges may apply.
echo Existing task is resumed, not submitted again.
choice /C YN /N /M "Generate or resume this one video? [Y/N] "
if errorlevel 2 exit /b 0
node --env-file-if-exists=.env scripts/seedance.mjs --create-one
pause
