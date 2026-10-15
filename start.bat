@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo [1/2] 首次运行，正在安装依赖...
  call npm install
  if errorlevel 1 (echo. & echo 依赖安装失败，请检查网络或 .npmrc 镜像 & pause & exit /b 1)
)
echo [2/2] 启动 高德用量监控...
call npx electron .
pause
