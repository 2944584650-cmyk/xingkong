@echo off
echo Cleaning up previous server processes...

:: 查找占用 3000 端口的僵尸进程并强行结束它，保证新启动的服务器绝对能在 3000 端口成功运行
FOR /F "tokens=5" %%a in ('netstat -aon ^| find ":3000" ^| find "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)

:: 等待 2 秒，确保操作系统彻底释放端口
timeout /t 2 /nobreak >nul

:: 使用 Vite 启动开发服务器，这会自动进行 TypeScript 和 React 的编译，并保留窗口防止闪退
start "Game Server" cmd /k "npm run dev"

exit
