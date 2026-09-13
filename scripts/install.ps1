#Requires -Version 5.1
<#
    antigravity-hans installer
    --------------------------
    Localises the Antigravity desktop UI into Simplified Chinese at runtime,
    by injecting a translation dictionary over the Chrome DevTools Protocol.

    It does NOT modify a single file inside the Antigravity installation.
    Everything it touches is either inside this repository or a shortcut.

    Usage:
        powershell -ExecutionPolicy Bypass -File scripts\install.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$ProjectDir = Split-Path -Parent $PSScriptRoot
$BackupDir = Join-Path $ProjectDir 'backup'
$Daemon = Join-Path $ProjectDir 'src\hans-daemon.js'
$Dict = Join-Path $ProjectDir 'src\hans-dict.json'
$Launcher = Join-Path $ProjectDir 'launcher.vbs'
$Template = Join-Path $PSScriptRoot 'launcher.vbs.template'

function Step($m) { Write-Host "  $m" }
function Ok($m) { Write-Host "  [ok] $m" -ForegroundColor Green }
function Warn2($m) { Write-Host "  [!!] $m" -ForegroundColor Yellow }
function Die($m) { Write-Host "  [XX] $m" -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host 'antigravity-hans installer' -ForegroundColor Cyan
Write-Host '--------------------------'
Write-Host ''

# ---------------------------------------------------------------- sanity ---
Step 'Checking repository files...'
foreach ($f in @($Daemon, $Dict, $Template)) {
    if (-not (Test-Path $f)) { Die "Missing required file: $f" }
}
Ok "daemon + dictionary found ($([math]::Round((Get-Item $Dict).Length / 1KB)) KB)"

# ------------------------------------------------------------------ node ---
Step 'Locating Node.js...'
$nodeExe = $null
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd) { $nodeExe = $cmd.Source }

if (-not $nodeExe) {
    foreach ($c in @(
            (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
            (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
            (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
        )) {
        if ($c -and (Test-Path $c)) { $nodeExe = $c; break }
    }
}
if (-not $nodeExe) {
    # No system Node. Rather than sending the user off to nodejs.org, fetch a
    # portable copy into the project folder. Nothing is installed system-wide
    # and nothing is written to PATH -- it lives and dies with this folder.
    Step 'Node.js not found - fetching a portable copy (about 30 MB)...'
    $runtimeDir = Join-Path $ProjectDir 'runtime'
    $nodeDir = Join-Path $runtimeDir 'node'
    if (-not (Test-Path $runtimeDir)) { New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null }

    try {
        $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing -TimeoutSec 30
        $lts = $index | Where-Object { $_.lts } | Select-Object -First 1
        if (-not $lts) { throw 'could not determine the current LTS release' }
        $ver = $lts.version

        $zipName = "node-$ver-win-x64.zip"
        $url = "https://nodejs.org/dist/$ver/$zipName"
        $zipPath = Join-Path $runtimeDir $zipName

        Step "  downloading $ver ..."
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing -TimeoutSec 600

        Step '  extracting ...'
        Expand-Archive -Path $zipPath -DestinationPath $runtimeDir -Force
        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

        $extracted = Join-Path $runtimeDir "node-$ver-win-x64"
        if (-not (Test-Path $extracted)) { throw "unexpected archive layout, expected $extracted" }
        if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
        Rename-Item -Path $extracted -NewName 'node'

        $nodeExe = Join-Path $nodeDir 'node.exe'
        Ok "portable node installed at runtime\node"
    }
    catch {
        Die "Could not fetch Node.js automatically ($($_.Exception.Message)).`n       Install it manually from https://nodejs.org and re-run this script."
    }
}
Ok "node: $nodeExe"

# The daemon relies on the global fetch and WebSocket APIs, which landed in
# Node 22. Older runtimes will fail at startup with no useful error.
$verRaw = (& $nodeExe --version) -replace '^v', ''
$major = [int]($verRaw -split '\.')[0]
if ($major -lt 22) {
    Die "Node.js $verRaw is too old. This tool needs Node 22 or newer (you have v$verRaw)."
}
Ok "node version v$verRaw (>= 22 required)"

# ------------------------------------------------------------ antigravity ---
Step 'Locating Antigravity...'
$agExe = Join-Path $env:LOCALAPPDATA 'Programs\antigravity\Antigravity.exe'
if (-not (Test-Path $agExe)) { $agExe = $null }

# Fall back to reading it out of an existing shortcut.
$shell = New-Object -ComObject WScript.Shell
$shortcutPaths = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Antigravity.lnk'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Antigravity.lnk')
)
if (-not $agExe) {
    foreach ($s in $shortcutPaths) {
        if (Test-Path $s) {
            $t = $shell.CreateShortcut($s).TargetPath
            if ($t -and (Test-Path $t) -and $t -notlike '*.vbs') { $agExe = $t; break }
        }
    }
}
if (-not $agExe) {
    Warn2 'Antigravity.exe not found in the usual place.'
    Warn2 'The localisation will still work once the app is running, but the'
    Warn2 'shortcut step below needs an existing Antigravity shortcut to patch.'
} else {
    Ok "antigravity: $agExe"
}

# --------------------------------------------------------------- launcher ---
Step 'Generating launcher...'
$tmpl = Get-Content $Template -Raw
$rendered = $tmpl.Replace('__NODE_EXE__', $nodeExe)
Set-Content -Path $Launcher -Value $rendered -Encoding ASCII
Ok "wrote $Launcher"

# ------------------------------------------------------------- shortcuts ---
Step 'Patching shortcuts...'
if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir | Out-Null }

$patched = 0
foreach ($s in $shortcutPaths) {
    if (-not (Test-Path $s)) { continue }

    $existing = $shell.CreateShortcut($s)
    if ($existing.TargetPath -like '*launcher.vbs') {
        Ok "already patched, skipping: $(Split-Path $s -Leaf)"
        continue
    }

    # Keep a pristine copy so uninstall can restore the exact original.
    $tag = if ($s -like '*Desktop*') { 'desktop' } else { 'startmenu' }
    Copy-Item $s (Join-Path $BackupDir "Antigravity.lnk.$tag.bak") -Force

    $lnk = $shell.CreateShortcut($s)
    $lnk.TargetPath = $Launcher
    $lnk.WorkingDirectory = $ProjectDir
    if ($agExe) { $lnk.IconLocation = "$agExe,0" }
    $lnk.WindowStyle = 7    # minimised, so the console window does not flash
    $lnk.Description = 'Antigravity (with Chinese localisation)'
    $lnk.Save()

    Ok "patched: $s"
    $patched++
}

if ($patched -eq 0) {
    Warn2 'No Antigravity shortcut was patched.'
    Warn2 "Create one pointing at: $Launcher"
}

# ------------------------------------------------------------------ done ---
Write-Host ''
Write-Host 'Done.' -ForegroundColor Green
Write-Host ''
Write-Host '  Start Antigravity from the shortcut as usual - the UI will come up'
Write-Host '  in Chinese a few seconds after the window appears.'
Write-Host ''
Write-Host '  Backups of the original shortcuts are in:' -NoNewline
Write-Host " backup\" -ForegroundColor DarkGray
Write-Host '  Run scripts\uninstall.ps1 to roll everything back.'
Write-Host ''
Write-Host '  Note: the localisation only applies while the daemon is running.'
Write-Host '  Logs: <project>\src\hans-daemon.log'
Write-Host ''
