@echo off
REM 定义要关闭的主程序进程名
set PROCESS_NAME=MusicParty.exe

REM --- 步骤 1: (新增) 关闭残留的旧CMD窗口 ---
echo Closing old 'MyMusicSite' window if it exists...
:: 这个命令会根据窗口标题"MyMusicSite"来查找并强制关闭对应的cmd.exe窗口
:: > nul 2>&1 的作用是隐藏执行结果，这样即使找不到旧窗口也不会显示错误信息
taskkill /F /FI "WINDOWTITLE eq MyMusicSite*" /IM cmd.exe 

REM --- 步骤 2: 关闭主程序进程 ---
echo Closing main process (%PROCESS_NAME%)...
taskkill /F /IM %PROCESS_NAME% /T

REM --- 步骤 3: 等待1秒，确保端口被释放 ---
echo Waiting for 3 seconds...
timeout /t 1 /nobreak > nul

REM --- 步骤 4: 在新的窗口中启动主程序 ---
echo Starting new process in a new window...
start "MyMusicSite" "%~dp0#start.bat"

exit