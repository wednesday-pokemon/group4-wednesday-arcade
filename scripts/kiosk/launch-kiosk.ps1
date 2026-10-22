<#
.SYNOPSIS
  Opens Nevermore: Deadly Secrets in a locked-down Chrome/Edge window for one of the three event laptops.

.DESCRIPTION
  Per-user, per-run only: nothing is installed, no registry or system setting is changed. Each role gets its own
  browser profile under %LOCALAPPDATA%\RavenIslandKiosk\<role> so station sign-in, LOCAL DEMO records and the
  operator session never mix with the personal browser profile.

  Roles and URLs (see docs/OPERATOR_RUNBOOK.md section 2 and src/app/routing.ts):
    station_a / station_b   kiosk (--kiosk). Without -Live: "/" (mystery LOCAL DEMO).
                            With -Live: $LiveStationPath (only once the live mystery mode has landed).
    dashboard               fullscreen app window. Without -Live: "/?mode=dashboard&demo=1" (mystery LOCAL DEMO board).
                            With -Live: "/?mode=dashboard".
  -Path overrides the URL path for any role (e.g. -Path "/?legacy=1").

  Exit the kiosk with Alt+F4. Exit the dashboard window with F11 then close, or Alt+F4.

.EXAMPLE
  .\launch-kiosk.ps1 -Role station_a                       # LOCAL DEMO kiosk on http://localhost:4173/
  .\launch-kiosk.ps1 -Role station_b -Live                 # live terminal (after deploy + live adapter)
  .\launch-kiosk.ps1 -Role dashboard -Live -BaseUrl https://raven.example.org
  .\launch-kiosk.ps1 -Role station_a -Window               # same profile, normal window (sign-in help, F12 export)
  .\launch-kiosk.ps1 -Role station_a -DryRun               # print the command only
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('station_a', 'station_b', 'dashboard')]
  [string]$Role,

  # Where dist/ is served. Default: $env:RAVEN_BASE_URL, else http://localhost:4173 (scripts\kiosk\serve-dist.cmd).
  [string]$BaseUrl = $(if ($env:RAVEN_BASE_URL) { $env:RAVEN_BASE_URL } else { 'http://localhost:4173' }),

  [switch]$Live,
  [string]$Path,

  [ValidateSet('auto', 'chrome', 'edge')]
  [string]$Browser = 'auto',

  # Normal window with the same profile (no kiosk): station sign-in troubleshooting, DevTools export.
  [switch]$Window,
  # Pin the page zoom to 100 % regardless of Windows display scaling (use only if scaling cannot be set to 100 %).
  [switch]$ForceScale1,
  # Launch even if a window with this profile already seems open (Chromium would ignore the new flags).
  [switch]$Force,
  [switch]$DryRun
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# VERIFY against src/app/routing.ts before the event. On 2026-10-21 this route still opens the LEGACY v2.5 race;
# the mystery live terminal route lands with the live adapter (Phase 5). Change this one line if the route differs.
$LiveStationPath = '/?mode=terminal&station={0}'

function Find-Browser([string]$which) {
  $chrome = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  )
  $edge = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
  )
  $candidates = switch ($which) { 'chrome' { $chrome } 'edge' { $edge } default { $chrome + $edge } }
  foreach ($c in $candidates) { if ($c -and (Test-Path -LiteralPath $c)) { return $c } }
  return $null
}

function Quote([string]$s) { if ($s -match '\s') { return '"' + $s + '"' } return $s }

# ---------------------------------------------------------------- URL
$base = $BaseUrl.TrimEnd('/')
if ($Path) {
  $urlPath = $Path
} elseif ($Role -eq 'dashboard') {
  $urlPath = $(if ($Live) { '/?mode=dashboard' } else { '/?mode=dashboard&demo=1' })
} else {
  $urlPath = $(if ($Live) { [string]::Format($LiveStationPath, $Role) } else { '/' })
}
if (-not $urlPath.StartsWith('/')) { $urlPath = '/' + $urlPath }
$url = $base + $urlPath

try { $origin = ([Uri]$base).GetLeftPart([UriPartial]::Authority) } catch { throw "BaseUrl '$BaseUrl' is not a valid URL." }
$uriHost = ([Uri]$base).Host
$isLocal = @('localhost', '127.0.0.1', '[::1]') -contains $uriHost
$insecure = $base.StartsWith('http://') -and -not $isLocal

# ---------------------------------------------------------------- browser + profile
$exe = Find-Browser $Browser
if (-not $exe) { throw "No Chrome/Edge found for -Browser $Browser. Install Chrome or Edge (current stable)." }
$isEdge = ($exe -like '*msedge.exe')
$version = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion

$profileDir = Join-Path $env:LOCALAPPDATA ('RavenIslandKiosk\' + $Role)
if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $profileDir | Out-Null }

# A second launch against a running profile is handed to the running process and ignores every flag below.
if (-not $Force -and -not $DryRun) {
  $procName = $(if ($isEdge) { 'msedge.exe' } else { 'chrome.exe' })
  $running = @(Get-CimInstance Win32_Process -Filter "Name='$procName'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profileDir) })
  if ($running.Count -gt 0) {
    Write-Warning "A $procName window with profile '$profileDir' is already open. Close it (Alt+F4) and run again, or use -Force."
    exit 1
  }
}

# Suppress the "Restore pages?" bubble after a crash / power loss (kiosk would show it over the game).
$prefs = Join-Path $profileDir 'Default\Preferences'
if (-not $DryRun -and (Test-Path -LiteralPath $prefs)) {
  $text = [IO.File]::ReadAllText($prefs)
  $fixed = $text.Replace('"exit_type":"Crashed"', '"exit_type":"Normal"').Replace('"exited_cleanly":false', '"exited_cleanly":true')
  if ($fixed -ne $text) { [IO.File]::WriteAllText($prefs, $fixed, (New-Object Text.UTF8Encoding($false))) }
}

# ---------------------------------------------------------------- flags
$flags = New-Object System.Collections.Generic.List[string]
$flags.Add('--user-data-dir=' + (Quote $profileDir))
$flags.Add('--no-first-run')
$flags.Add('--no-default-browser-check')
$flags.Add('--disable-pinch')                         # no touchpad pinch-zoom
$flags.Add('--overscroll-history-navigation=0')       # no two-finger swipe back/forward
$flags.Add('--disable-features=Translate,TranslateUI,OverscrollHistoryNavigation')
$flags.Add('--autoplay-policy=no-user-gesture-required')
$flags.Add('--disable-background-timer-throttling')   # dashboard Realtime + sim keep running if occluded
$flags.Add('--disable-renderer-backgrounding')
$flags.Add('--disable-backgrounding-occluded-windows')
$flags.Add('--noerrdialogs')
$flags.Add('--disable-session-crashed-bubble')
$flags.Add('--hide-crash-restore-bubble')
if ($ForceScale1) { $flags.Add('--force-device-scale-factor=1') }
if ($insecure) {
  # Plain-HTTP LAN host (Laptop 1 serving): treat it as a secure context so keyboard lock (Ctrl crouch, Esc inside
  # the game) and crypto.randomUUID work. Requires the dedicated --user-data-dir above.
  $flags.Add('--unsafely-treat-insecure-origin-as-secure=' + $origin)
}

$mode = ''
if ($Window) {
  $flags.Add('--new-window')
  $flags.Add($url)
  $mode = 'normal window'
} elseif ($Role -eq 'dashboard') {
  $flags.Add('--start-fullscreen')
  $flags.Add('--app=' + $url)
  $mode = 'fullscreen app window (F11 leaves fullscreen)'
} else {
  $flags.Add('--kiosk')
  if ($isEdge) { $flags.Add('--edge-kiosk-type=fullscreen') }
  $flags.Add($url)
  $mode = 'kiosk (Alt+F4 exits)'
}

Write-Host ("Role     : {0}" -f $Role)
Write-Host ("URL      : {0}" -f $url)
Write-Host ("Browser  : {0} ({1})" -f $exe, $version)
Write-Host ("Profile  : {0}" -f $profileDir)
Write-Host ("Mode     : {0}" -f $mode)
if ($Live -and $Role -ne 'dashboard') { Write-Host "NOTE     : -Live uses '$LiveStationPath' - verify it is the MYSTERY live terminal (src/app/routing.ts)." }
if (-not $Live -and -not $Path) { Write-Host "NOTE     : LOCAL DEMO (unverified results, nothing reaches the verified leaderboard)." }
if ($insecure) { Write-Host "NOTE     : plain-HTTP LAN host - treated as secure for $origin in this profile only." }

if ($DryRun) {
  Write-Host ''
  Write-Host ('"' + $exe + '" ' + ($flags -join ' '))
  exit 0
}

Start-Process -FilePath $exe -ArgumentList $flags.ToArray() | Out-Null
