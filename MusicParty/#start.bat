@echo off
:: 这行代码是关键：它会自动切换到当前 .bat 文件所在的目录
cd /d "%~dp0"
MusicParty --urls http://0.0.0.0:38080