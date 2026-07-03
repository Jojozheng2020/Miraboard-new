param(
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RuntimeDir = Join-Path $ProjectRoot ".tmp"
$StatePath = Join-Path $RuntimeDir "miraboard-runtime.json"
$StdoutPath = Join-Path $RuntimeDir "server-out.log"
$StderrPath = Join-Path $RuntimeDir "server-err.log"
$Ports = 5178..5185
$ExpectedServerHash = (Get-FileHash -LiteralPath (Join-Path $ProjectRoot "server.py") -Algorithm SHA256).Hash.ToLowerInvariant()

New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null

function Get-MiraBoardHealth([int]$Port) {
  try {
    return Invoke-RestMethod -TimeoutSec 2 "http://127.0.0.1:$Port/api/health"
  } catch {
    return $null
  }
}

function Test-MiraBoardHealth([int]$Port) {
  $health = Get-MiraBoardHealth $Port
  return $null -ne $health `
    -and $health.status -eq "ok" `
    -and $health.appRoot -eq $ProjectRoot `
    -and $health.serverSourceHash -eq $ExpectedServerHash
}

function Open-MiraBoard([int]$Port) {
  if (-not $NoBrowser) {
    Start-Process "http://127.0.0.1:$Port/" | Out-Null
  }
}

foreach ($port in $Ports) {
  $health = Get-MiraBoardHealth $port
  if ($null -ne $health -and $health.status -eq "ok" -and $health.appRoot -eq $ProjectRoot -and $health.serverSourceHash -ne $ExpectedServerHash) {
    $staleListener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($staleListener) {
      Write-Host "Stopping outdated MiraBoard instance on port $port..."
      Stop-Process -Id $staleListener.OwningProcess -Force -ErrorAction SilentlyContinue
      for ($attempt = 1; $attempt -le 20; $attempt += 1) {
        if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 100
      }
    }
    continue
  }
  if ($null -ne $health -and $health.status -eq "ok" -and $health.appRoot -eq $ProjectRoot -and $health.serverSourceHash -eq $ExpectedServerHash) {
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    @{ port = $port; pid = $listener.OwningProcess; status = "healthy"; checkedAt = (Get-Date).ToString("s") } |
      ConvertTo-Json | Set-Content -Path $StatePath -Encoding UTF8
    Write-Host "MiraBoard is already running: http://127.0.0.1:$port/"
    Open-MiraBoard $port
    exit 0
  }
}

$Port = $null
foreach ($candidate in $Ports) {
  $listener = Get-NetTCPConnection -LocalPort $candidate -State Listen -ErrorAction SilentlyContinue
  if (-not $listener) {
    $Port = $candidate
    break
  }
}
if ($null -eq $Port) {
  Write-Error "Ports 5178-5185 are all in use."
  exit 1
}

$BundledPython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if (Test-Path $BundledPython) {
  $PythonExe = $BundledPython
} else {
  $PythonCommand = Get-Command python -ErrorAction SilentlyContinue
  if (-not $PythonCommand) {
    Write-Error "Python is not available."
    exit 1
  }
  $PythonExe = $PythonCommand.Source
}
$PythonWindowless = Join-Path (Split-Path -Parent $PythonExe) "pythonw.exe"
if (Test-Path $PythonWindowless) {
  $ServerPythonExe = $PythonWindowless
} else {
  $ServerPythonExe = $PythonExe
}

Remove-Item -LiteralPath $StdoutPath, $StderrPath -Force -ErrorAction SilentlyContinue
$PreviousPort = $env:MIRABOARD_PORT
$env:MIRABOARD_PORT = [string]$Port
try {
  $process = Start-Process -FilePath $ServerPythonExe `
    -ArgumentList "server.py" `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $StdoutPath `
    -RedirectStandardError $StderrPath `
    -PassThru
} finally {
  if ($null -eq $PreviousPort) {
    Remove-Item Env:MIRABOARD_PORT -ErrorAction SilentlyContinue
  } else {
    $env:MIRABOARD_PORT = $PreviousPort
  }
}

for ($attempt = 1; $attempt -le 30; $attempt += 1) {
  if ($process.HasExited) {
    $detail = if (Test-Path $StderrPath) { (Get-Content $StderrPath -Raw).Trim() } else { "" }
    Write-Error "Server exited early with code $($process.ExitCode). $detail"
    exit 1
  }
  if (Test-MiraBoardHealth $Port) {
    @{ port = $Port; pid = $process.Id; status = "healthy"; startedAt = (Get-Date).ToString("s"); python = $ServerPythonExe } |
      ConvertTo-Json | Set-Content -Path $StatePath -Encoding UTF8
    Write-Host "MiraBoard started: http://127.0.0.1:$Port/"
    Open-MiraBoard $Port
    exit 0
  }
  Start-Sleep -Milliseconds 500
}

Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
$detail = if (Test-Path $StderrPath) { (Get-Content $StderrPath -Raw).Trim() } else { "" }
Write-Error "Server did not pass health check within 15 seconds. $detail"
exit 1
