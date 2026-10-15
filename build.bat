@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo 正在安装依赖...
  call npm install
  if errorlevel 1 (echo. & echo 依赖安装失败 & pause & exit /b 1)
)
echo 开始打包（首次会下载 electron，耐心等待）...
call npm run dist
if errorlevel 1 (echo. & echo 打包失败，请查看上方日志 & pause & exit /b 1)
echo.
echo 打包完成！产物在 release 目录：
dir /b release
pause
