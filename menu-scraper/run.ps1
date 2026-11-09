# Starts the menu scraper on http://localhost:8787 (set PORT in .env to change it).
$py = Join-Path $env:USERPROFILE ".menu-scraper\venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Host "Setting up for the first time (a few minutes)..."
    python -m venv (Join-Path $env:USERPROFILE ".menu-scraper\venv")
    & $py -m pip install -q -r (Join-Path $PSScriptRoot "requirements.txt")
    & $py -m patchright install chromium
}
& $py (Join-Path $PSScriptRoot "app.py")
