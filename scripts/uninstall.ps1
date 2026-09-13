#Requires -Version 5.1
<#
    antigravity-hans uninstaller
    ----------------------------
    Stops the localisation daemon and restores the original Antigravity
    shortcuts from backup. Antigravity itself was never modified, so once the
    daemon is gone the UI returns to English immediately.

    Usage:
        powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$ProjectDir = Split-Path -Parent $PSScriptRoot
$BackupDir = Join-Path $ProjectDir 'backup'
$Launcher = Join-Path $ProjectDir 'launcher.vbs'

function Step($m) { Write-Host "  $m" }
function Ok($m) { Write-Host "  [ok] $m" -ForegroundColor Green }
function Warn2($m) { Write-Host "  [!!] $m" -ForegroundColor Yellow }

Write-Host ''
Write-Host 'antigravity-hans uninstaller' -ForegroundColor Cyan
Write-Host '----------------------------'
Write-Host ''

# ------------------------------------------------------------- stop daemon ---
Step 'Stopping the localisation daemon...'
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*hans-daemon*' }
if ($procs) {
    foreach ($p in $procs) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        Ok "stopped PID $($p.ProcessId)"
    }
} else {
    Step '  (not running)'
}

# ----------------------------------------------------------- restore links ---
Step 'Restoring shortcuts...'
$shell = New-Object -ComObject WScript.Shell
$map = @{
    'Antigravity.lnk.desktop.bak'   = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Antigravity.lnk'
    'Antigravity.lnk.startmenu.bak' = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Antigravity.lnk'
}

$restored = 0
foreach ($bak in $map.Keys) {
    $src = Join-Path $BackupDir $bak
    if (-not (Test-Path $src)) { continue }
    Copy-Item $src $map[$bak] -Force
    Ok "restored: $($map[$bak])"
    $restored++
}

if ($restored -eq 0) {
    Warn2 "No backup found in $BackupDir"
    Warn2 'If a shortcut still points at launcher.vbs, repoint it at Antigravity.exe manually.'
}

# ---------------------------------------------------------------- cleanup ---
Step 'Cleaning generated files...'
foreach ($f in @($Launcher, (Join-Path $ProjectDir 'src\hans-daemon.log'), (Join-Path $ProjectDir 'src\hans-daemon.pid'))) {
    if (Test-Path $f) {
        Remove-Item $f -Force -ErrorAction SilentlyContinue
        Ok "removed $(Split-Path $f -Leaf)"
    }
}

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green
Write-Host ''
Write-Host '  Antigravity was never modified, so it is already back to English.'
Write-Host '  Restart the app if it is currently open.'
Write-Host ''
Write-Host '  The repository itself was left in place. Delete the folder to'
Write-Host '  remove it completely.'
Write-Host ''
