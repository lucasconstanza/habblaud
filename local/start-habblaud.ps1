$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$server = Join-Path $projectRoot 'dist/server/index.js'
$url = 'http://127.0.0.1:4747'

if (-not (Test-Path -LiteralPath $server -PathType Leaf)) {
    throw 'Habblaud não compilado. Execute npm run build na pasta do projeto.'
}

$expectedVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version

function Get-HabblaudHealth {
    try {
        return Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 2
    }
    catch {
        return $null
    }
}

$health = Get-HabblaudHealth
if ($health -and $health.ok -and $health.version -eq $expectedVersion) {
    Write-Output "Habblaud já está no ar em $url"
    exit 0
}
if ($health) {
    throw 'A porta 4747 já está ocupada por outro serviço ou outra versão do Habblaud.'
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
$env:HABBLAUD_HOST = '127.0.0.1'
$env:HABBLAUD_WORLD = '0'
$env:HABBLAUD_UPDATE_CHECK = '0'
$env:HABBLAUD_PTY = '0'

Start-Process -FilePath $node -ArgumentList $server -WorkingDirectory $projectRoot -WindowStyle Hidden | Out-Null

for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    $health = Get-HabblaudHealth
    if ($health -and $health.ok -and $health.version -eq $expectedVersion) {
        Write-Output "Habblaud iniciado em $url"
        exit 0
    }
}

throw 'O Habblaud não respondeu em 10 segundos. Confira a instalação e a porta 4747.'
