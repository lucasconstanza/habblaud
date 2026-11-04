param(
    [switch]$AbrirPainel
)

$ErrorActionPreference = 'Stop'
$script:projectRoot = Split-Path -Parent $PSScriptRoot
$script:server = Join-Path $script:projectRoot 'dist/server/index.js'
$script:startScript = Join-Path $PSScriptRoot 'start-habblaud.ps1'
$script:url = 'http://127.0.0.1:4747'

function Start-Habblaud {
    & $script:startScript | Out-Null
}

function Open-Habblaud {
    try {
        Start-Habblaud
        Start-Process -FilePath $script:url | Out-Null
    }
    catch {
        [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Habblaud') | Out-Null
    }
}

function Stop-Habblaud {
    try {
        $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
            Where-Object { $_.CommandLine -and $_.CommandLine.Contains($script:server, [System.StringComparison]::OrdinalIgnoreCase) })
        if ($processes.Count -gt 1) {
            throw 'Mais de um servidor corresponde ao Habblaud. Nenhum processo foi encerrado.'
        }
        if ($processes.Count -eq 1) {
            Stop-Process -Id $processes[0].ProcessId -ErrorAction Stop
        }
    }
    catch {
        [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Habblaud') | Out-Null
    }
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$createdNew = $false
$mutex = [System.Threading.Mutex]::new($true, 'Local\HabblaudTrayLucas', [ref]$createdNew)
if (-not $createdNew) {
    $mutex.Dispose()
    if ($AbrirPainel) { Open-Habblaud }
    exit 0
}

$icon = [System.Drawing.Icon]::new((Join-Path $PSScriptRoot 'habblaud.ico'))
$tray = [System.Windows.Forms.NotifyIcon]::new()
$menu = [System.Windows.Forms.ContextMenuStrip]::new()
$context = [System.Windows.Forms.ApplicationContext]::new()

try {
    $openItem = [System.Windows.Forms.ToolStripMenuItem]::new('Abrir painel')
    $openItem.add_Click({ Open-Habblaud })
    [void]$menu.Items.Add($openItem)

    $startItem = [System.Windows.Forms.ToolStripMenuItem]::new('Iniciar servidor')
    $startItem.add_Click({
        try { Start-Habblaud }
        catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Habblaud') | Out-Null }
    })
    [void]$menu.Items.Add($startItem)

    $stopItem = [System.Windows.Forms.ToolStripMenuItem]::new('Fechar servidor')
    $stopItem.add_Click({ Stop-Habblaud })
    [void]$menu.Items.Add($stopItem)

    [void]$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new())
    $exitItem = [System.Windows.Forms.ToolStripMenuItem]::new('Sair da bandeja')
    $exitItem.add_Click({
        Stop-Habblaud
        $context.ExitThread()
    })
    [void]$menu.Items.Add($exitItem)

    $tray.Icon = $icon
    $tray.Text = 'Habblaud'
    $tray.ContextMenuStrip = $menu
    $tray.add_DoubleClick({ Open-Habblaud })
    $tray.Visible = $true

    Start-Habblaud
    if ($AbrirPainel) { Open-Habblaud }
    [System.Windows.Forms.Application]::Run($context)
}
finally {
    $tray.Visible = $false
    $tray.Dispose()
    $menu.Dispose()
    $icon.Dispose()
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
