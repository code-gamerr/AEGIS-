$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
if (-not (Test-Path .\.venv\Scripts\python.exe)) {
  python -m venv .venv
  .\.venv\Scripts\pip install -r backend\requirements.txt
}
if (-not (Test-Path .\frontend\node_modules)) {
  npm --prefix frontend install
}
$env:PYTHONPATH = "$root\backend"
Start-Process -FilePath "$root\.venv\Scripts\python.exe" -ArgumentList "-m","uvicorn","app.main:app","--host","127.0.0.1","--port","8000" -WorkingDirectory "$root\backend"
Start-Process -FilePath "npm" -ArgumentList "run","dev" -WorkingDirectory "$root\frontend"
Write-Host "API http://127.0.0.1:8000/api/health"
Write-Host "UI  http://127.0.0.1:5173"
