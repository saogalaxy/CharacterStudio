@echo off
cd /d D:\CharacterStudio
start "Character Studio API" "D:\CharacterStudio\runtime\python\python.exe" "D:\CharacterStudio\app\app.py" --headless --port 8765
echo Character Studio API starting on http://127.0.0.1:8765
