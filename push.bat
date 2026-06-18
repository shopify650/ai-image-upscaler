@echo off
cd /d "%~dp0"
echo Adding backend/api/upscale.ts...
git add backend/api/upscale.ts
echo Committing changes...
git commit -m "fix: resolve typescript compile errors in upscale.ts and bypass vercel blob"
echo Pushing to GitHub...
git push origin master
echo.
echo All done! Press any key to close this window.
pause > nul
