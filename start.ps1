# Listening Coach - Start Script
param(
  [ValidateSet('dev', 'prod')]
  [string]$Mode = 'dev'
)

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootDir

function Step { param($Msg, $Emoji = '>>>')
  Write-Host "`n$Emoji $Msg" -ForegroundColor Cyan
}

function Ok { param($Msg)
  Write-Host "[OK] $Msg" -ForegroundColor Green
}

function Err { param($Msg)
  Write-Host "[FAIL] $Msg" -ForegroundColor Red
}

# Install deps if needed
if (-not (Test-Path "node_modules")) {
  Step "Installing dependencies..." "npm"
  npm install
  if ($LASTEXITCODE -ne 0) { Err "npm install failed"; exit 1 }
}

# === DEV ===
if ($Mode -eq 'dev') {
  Step "DEV MODE - Starting Vite + Neutralino" "dev"

  # Kill old processes on port 5173
  $old = netstat -ano 2>$null | Select-String ":5173"
  if ($old) {
    $pid = ($old -split '\s+')[-1]
    if ($pid -and $pid -ne '0') { taskkill /F /PID $pid 2>$null; Start-Sleep 1 }
  }

  # Start Vite
  Step "Starting Vite dev server..." "vite"
  $vite = Start-Job -ScriptBlock { Set-Location $using:RootDir; npm run dev }

  # Wait for Vite
  for ($i = 0; $i -lt 20; $i++) {
    try { $r = [System.Net.WebRequest]::Create("http://localhost:5173"); $r.Timeout=1000; $r.GetResponse().Close(); break }
    catch { Start-Sleep -Milliseconds 500 }
  }
  Ok "Vite ready on http://localhost:5173"

  # Start Neutralino
  Step "Starting Neutralino app... (Ctrl+C to stop)" "app"
  $bin = "$RootDir\bin\neutralino-win_x64.exe"
  if (Test-Path $bin) {
    & $bin "--load-dir-res" "--path=$RootDir" "--url=http://localhost:5173"
  } else {
    npx @neutralinojs/neu run
  }

  # Cleanup
  Stop-Job $vite -ErrorAction SilentlyContinue
  Remove-Job $vite -ErrorAction SilentlyContinue
  Ok "Dev mode stopped"
  exit 0
}

# === PROD ===
if ($Mode -eq 'prod') {
  Step "PRODUCTION BUILD" "build"

  Step "Building React frontend..." "vite"
  npm run build
  if ($LASTEXITCODE -ne 0) { Err "Build failed"; exit 1 }
  Ok "Frontend build OK"

  if (-not (Test-Path "$RootDir\bin\neutralino-win_x64.exe")) {
    Step "Downloading Neutralino binaries..." "download"
    npx @neutralinojs/neu update
  }

  Step "Building .exe..." "exe"
  npx @neutralinojs/neu build --release
  if ($LASTEXITCODE -ne 0) { Err "Build failed"; exit 1 }

  # Show result
  Step "Output files:" "done"
  Get-ChildItem -Path "$RootDir\dist" -Filter "*.exe" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host ("  [EXE] " + $_.FullName + " (" + [math]::Round($_.Length/1MB,1) + " MB)") -ForegroundColor Green
  }
  Get-ChildItem -Path "$RootDir\dist" -Filter "*.msi" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host ("  [MSI] " + $_.FullName + " (" + [math]::Round($_.Length/1MB,1) + " MB)") -ForegroundColor Green
  }
  exit 0
}
