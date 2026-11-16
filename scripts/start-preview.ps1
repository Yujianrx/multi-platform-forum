param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$previewUrl = 'http://127.0.0.1:3000/forum'
Set-Location -LiteralPath $projectRoot

function Test-Preview {
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 2
        $info = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/public' -TimeoutSec 2
        return ($health.ok -eq $true -and $info.development -eq $true -and [bool]$info.name)
    } catch { return $false }
}

if (-not (Test-Preview)) {
    $listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    if ($listener) { throw 'Port 3000 is occupied. Close the other service before starting this preview.' }
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
        throw 'Dependencies are missing. Run npm ci in the project folder first.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist/server/main.js')) -or
        -not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist/client/index.html'))) {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Build failed. Check the output above.' }
    }
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    $logDir = Join-Path $projectRoot 'work'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    # Local preview uses the existing development database and never seeds or resets data.
    $env:NODE_ENV = 'development'
    $env:SERVE_BUILD = 'true'
    $env:HOST = '127.0.0.1'
    $env:PORT = '3000'
    $env:APP_ORIGIN = 'http://127.0.0.1:3000'
    $env:DATA_DIR = Join-Path $projectRoot 'data'
    $env:MODERATION_PROVIDER = 'development'
    $env:DATABASE_URL = ''
    # Keep a deployment .env from redirecting a local preview into an external database.
    $previewEnv = Join-Path $logDir 'local-preview.env'
    Set-Content -LiteralPath $previewEnv -Value '# Local preview configuration is supplied by the launcher.' -Encoding ascii
    $env:DOTENV_CONFIG_PATH = $previewEnv
    $env:DOTENV_PATH = $previewEnv
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $previewProcess = Start-Process -FilePath $nodePath -ArgumentList 'dist/server/main.js' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir "preview-$stamp.log") -RedirectStandardError (Join-Path $logDir "preview-$stamp-error.log") -PassThru
    for ($attempt=0; $attempt -lt 45; $attempt++) {
        if (Test-Preview) { break }
        if ($previewProcess.HasExited) { throw "Preview stopped. Check work/preview-$stamp-error.log." }
        Start-Sleep -Milliseconds 500
    }
    if (-not (Test-Preview)) { throw 'Preview did not become ready. Check the logs in work/.' }
}
Write-Output "Preview ready: $previewUrl"
if (-not $NoBrowser) { Start-Process $previewUrl }
