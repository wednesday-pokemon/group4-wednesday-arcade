<#
.SYNOPSIS
  READ-ONLY pre-event check of one event laptop. Changes nothing; prints PASS / WARN / FAIL with the manual fix.

.DESCRIPTION
  Checks the Windows settings from docs/THREE_LAPTOP_RUNBOOK.md: Sticky/Filter/Toggle Keys shortcuts, mouse
  acceleration, display scaling, refresh rate, power (AC, no sleep), notifications, Windows Update pause, browser
  version, page zoom of the kiosk profiles, and reachability of the game URL and (unless -SkipSupabase) the Supabase
  project. Exit code = number of FAIL lines.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\kiosk\check-laptop.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\kiosk\check-laptop.ps1 -BaseUrl http://192.168.1.10:4173
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\kiosk\check-laptop.ps1 -SkipSupabase   # Plan D (no internet)
#>
[CmdletBinding()]
param(
  [string]$BaseUrl = $(if ($env:RAVEN_BASE_URL) { $env:RAVEN_BASE_URL } else { 'http://localhost:4173' }),
  # Public project host (not a secret). Override for a different project.
  [string]$SupabaseHost = 'abkohhdjlufhsbqrchpn.supabase.co',
  [datetime]$EventDay = '2026-10-27',
  # Plan D / LOCAL DEMO: do not open any connection to the Supabase host (the line is reported as SKIP).
  [switch]$SkipSupabase
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Continue'
$script:fails = 0

function Out-Check([string]$level, [string]$what, [string]$detail, [string]$fix) {
  $color = switch ($level) { 'PASS' { 'Green' } 'WARN' { 'Yellow' } default { 'Red' } }
  Write-Host ('[{0}] {1}: {2}' -f $level, $what, $detail) -ForegroundColor $color
  if ($level -ne 'PASS' -and $fix) { Write-Host ('       fix: ' + $fix) }
  if ($level -eq 'FAIL') { $script:fails++ }
}

function Get-RegValue([string]$path, [string]$name) {
  try { return (Get-ItemProperty -LiteralPath $path -Name $name -ErrorAction Stop).$name } catch { return $null }
}

Write-Host ("Raven Island laptop check - {0} - {1}" -f $env:COMPUTERNAME, (Get-Date -Format 'yyyy-MM-dd HH:mm'))
Write-Host ''

# ---- 1. Accessibility shortcuts (5x Shift / hold right Shift 8 s / hold NumLock 5 s open dialogs mid-game)
$sticky = Get-RegValue 'HKCU:\Control Panel\Accessibility\StickyKeys' 'Flags'
if ($null -eq $sticky) { Out-Check 'WARN' 'Sticky Keys' 'setting not found' 'Settings > Accessibility > Keyboard > Sticky keys: Off, and its keyboard shortcut: Off' }
else {
  $f = [int]$sticky
  if ($f -band 1) { Out-Check 'FAIL' 'Sticky Keys' 'Sticky Keys is ON' 'Settings > Accessibility > Keyboard > Sticky keys: Off' }
  elseif ($f -band 4) { Out-Check 'FAIL' 'Sticky Keys shortcut' 'pressing Shift 5x opens the Sticky Keys dialog' 'Settings > Accessibility > Keyboard > Sticky keys > Keyboard shortcut for Sticky keys: Off' }
  else { Out-Check 'PASS' 'Sticky Keys' "off, shortcut off (Flags=$f)" '' }
}
$filter = Get-RegValue 'HKCU:\Control Panel\Accessibility\Keyboard Response' 'Flags'
if ($null -ne $filter) {
  $f = [int]$filter
  if ($f -band 1) { Out-Check 'FAIL' 'Filter Keys' 'Filter Keys is ON (ignores quick key presses)' 'Settings > Accessibility > Keyboard > Filter keys: Off' }
  elseif ($f -band 4) { Out-Check 'FAIL' 'Filter Keys shortcut' 'holding right Shift 8 s opens the Filter Keys dialog' 'Settings > Accessibility > Keyboard > Filter keys > Keyboard shortcut for Filter keys: Off' }
  else { Out-Check 'PASS' 'Filter Keys' "off, shortcut off (Flags=$f)" '' }
}
$toggle = Get-RegValue 'HKCU:\Control Panel\Accessibility\ToggleKeys' 'Flags'
if ($null -ne $toggle) {
  $f = [int]$toggle
  if ($f -band 4) { Out-Check 'WARN' 'Toggle Keys shortcut' 'holding NumLock 5 s opens a dialog' 'Settings > Accessibility > Keyboard > Toggle keys > Keyboard shortcut: Off' }
  else { Out-Check 'PASS' 'Toggle Keys shortcut' "off (Flags=$f)" '' }
}

# ---- 2. Mouse acceleration (makes mouse-look inconsistent)
$speed = Get-RegValue 'HKCU:\Control Panel\Mouse' 'MouseSpeed'
if ("$speed" -eq '0') { Out-Check 'PASS' 'Enhance pointer precision' 'off' '' }
else { Out-Check 'WARN' 'Enhance pointer precision' "on (MouseSpeed=$speed)" 'Control Panel > Mouse > Pointer Options: untick "Enhance pointer precision"' }

# ---- 3. Display scaling + resolution
$dpi = Get-RegValue 'HKCU:\Control Panel\Desktop\WindowMetrics' 'AppliedDPI'
if ($null -eq $dpi) { Out-Check 'WARN' 'Display scaling' 'unknown' 'Settings > System > Display > Scale: 100 %' }
elseif ([int]$dpi -eq 96) { Out-Check 'PASS' 'Display scaling' '100 %' '' }
else { Out-Check 'WARN' 'Display scaling' ('{0} %' -f [math]::Round([int]$dpi / 96 * 100)) 'Settings > System > Display > Scale: 100 % (sign out/in), or launch with -ForceScale1' }
try {
  $vc = @(Get-CimInstance Win32_VideoController -ErrorAction Stop | Where-Object { $_.CurrentHorizontalResolution })
  foreach ($v in $vc) {
    $detail = '{0} - {1}x{2} @ {3} Hz' -f $v.Name, $v.CurrentHorizontalResolution, $v.CurrentVerticalResolution, $v.CurrentRefreshRate
    # The game caps at 60 fps (measured at 60 Hz); 120/144 Hz panels make the GPU draw the HUD/compositor twice as often.
    if ([int]$v.CurrentRefreshRate -gt 61) { Out-Check 'WARN' 'GPU / resolution' $detail 'Settings > System > Display > Advanced display > Choose a refresh rate: 60 Hz' }
    else { Out-Check 'PASS' 'GPU / resolution' $detail '' }
  }
} catch { Out-Check 'WARN' 'GPU / resolution' 'could not read' '' }
# Laptops with two GPUs: Windows decides per app. Listed so the operator can set Chrome/Edge to High performance.
try {
  $allGpu = @(Get-CimInstance Win32_VideoController -ErrorAction Stop | ForEach-Object { $_.Name })
  if ($allGpu.Count -gt 1) { Out-Check 'WARN' 'Two GPUs' ($allGpu -join ' + ') 'Settings > System > Display > Graphics > Chrome/Edge: High performance (then chrome://gpu shows the fast GPU)' }
} catch { }

# ---- 4. Power: on AC, no sleep, display stays on
try {
  $bat = @(Get-CimInstance Win32_Battery -ErrorAction Stop)
  if ($bat.Count -eq 0) { Out-Check 'PASS' 'Power source' 'no battery (desktop/AC)' '' }
  elseif ($bat[0].BatteryStatus -eq 2) { Out-Check 'PASS' 'Power source' ('on AC, battery {0} %' -f $bat[0].EstimatedChargeRemaining) '' }
  else { Out-Check 'FAIL' 'Power source' ('ON BATTERY ({0} %)' -f $bat[0].EstimatedChargeRemaining) 'Plug in the charger (battery saver throttles the GPU)' }
} catch { Out-Check 'WARN' 'Power source' 'could not read' 'Make sure the charger is plugged in' }

function Get-AcIndex([string]$sub, [string]$setting) {
  $out = (& (Join-Path $env:SystemRoot 'System32\powercfg.exe') /query SCHEME_CURRENT $sub $setting 2>$null) -join "`n"
  $m = [regex]::Matches($out, '0x[0-9a-fA-F]{8}')
  if ($m.Count -lt 2) { return $null }
  return [Convert]::ToInt32($m[$m.Count - 2].Value, 16)  # last two values = current AC, current DC
}
$sleepAc = Get-AcIndex 'SUB_SLEEP' 'STANDBYIDLE'
$screenAc = Get-AcIndex 'SUB_VIDEO' 'VIDEOIDLE'
if ($sleepAc -eq 0) { Out-Check 'PASS' 'Sleep when plugged in' 'never' '' }
else { Out-Check 'FAIL' 'Sleep when plugged in' $(if ($null -eq $sleepAc) { 'unknown' } else { "after $([int]($sleepAc/60)) min" }) 'Settings > System > Power > Screen and sleep: "When plugged in, put my device to sleep after" = Never' }
if ($screenAc -eq 0) { Out-Check 'PASS' 'Screen off when plugged in' 'never' '' }
else { Out-Check 'WARN' 'Screen off when plugged in' $(if ($null -eq $screenAc) { 'unknown' } else { "after $([int]($screenAc/60)) min" }) 'Settings > System > Power > Screen and sleep: "When plugged in, turn off my screen after" = Never' }

# ---- 5. Notifications
$toast = Get-RegValue 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PushNotifications' 'ToastEnabled'
if ("$toast" -eq '0') { Out-Check 'PASS' 'Notifications' 'off' '' }
else { Out-Check 'WARN' 'Notifications' 'on' 'Settings > System > Notifications: Off (or Do not disturb: On)' }

# ---- 6. Windows Update paused past the event
$pause = Get-RegValue 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings' 'PauseUpdatesExpiryTime'
$until = $null
if ($pause) { try { $until = [datetime]::Parse($pause, [Globalization.CultureInfo]::InvariantCulture) } catch { $until = $null } }
if ($until -and $until -gt $EventDay.AddDays(1)) { Out-Check 'PASS' 'Windows Update' ('paused until {0:yyyy-MM-dd}' -f $until) '' }
else { Out-Check 'WARN' 'Windows Update' $(if ($until) { 'paused only until {0:yyyy-MM-dd}' -f $until } else { 'not paused' }) 'Settings > Windows Update > Pause updates (1-5 weeks), after installing pending updates and restarting' }

# ---- 7. Browser
$browsers = @(
  @{ n = 'Chrome'; p = (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe') },
  @{ n = 'Chrome'; p = (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe') },
  @{ n = 'Chrome'; p = (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe') },
  @{ n = 'Edge'; p = (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe') }
)
$found = $false
foreach ($b in $browsers) {
  if (Test-Path -LiteralPath $b.p) {
    $found = $true
    $ver = (Get-Item -LiteralPath $b.p).VersionInfo.ProductVersion
    $major = 0; [void][int]::TryParse(($ver -split '\.')[0], [ref]$major)
    if ($major -ge 120) { Out-Check 'PASS' $b.n "$ver" '' } else { Out-Check 'FAIL' $b.n "$ver (too old)" 'Update the browser, then record the version in the runbook' }
  }
}
if (-not $found) { Out-Check 'FAIL' 'Browser' 'no Chrome/Edge found' 'Install Chrome (or use Edge)' }

# ---- 7b. Page zoom in the kiosk profiles (launch-kiosk.ps1 profiles). Ctrl+wheel / Ctrl+= by a visitor persists per host.
$kioskRoot = Join-Path $env:LOCALAPPDATA 'RavenIslandKiosk'
if (-not (Test-Path -LiteralPath $kioskRoot)) { Write-Host '[INFO] Browser zoom: no kiosk profile yet (launch the role once, then re-run this check)' -ForegroundColor DarkGray }
foreach ($role in @('station_a', 'station_b', 'station_c', 'dashboard')) {
  $prefs = Join-Path $kioskRoot ($role + '\Default\Preferences')
  if (-not (Test-Path -LiteralPath $prefs)) { continue }
  $text = ''
  try { $text = [IO.File]::ReadAllText($prefs) } catch { continue }
  $levels = @([regex]::Matches($text, '"(?:default_)?zoom_level":\{?(?:"[^"]*":)?(-?[0-9.]+)') | ForEach-Object { [double]$_.Groups[1].Value } | Where-Object { [math]::Abs($_) -gt 0.001 })
  if ($levels.Count -gt 0) { Out-Check 'WARN' "Browser zoom ($role)" 'not 100 % in this kiosk profile' "Launch with -Window, press Ctrl+0 on the game page, close; or delete $kioskRoot\$role (also deletes its LOCAL DEMO records - export first)" }
  else { Out-Check 'PASS' "Browser zoom ($role)" '100 %' '' }
}

# ---- 8. Reachability
try {
  $r = Invoke-WebRequest -Uri $BaseUrl -UseBasicParsing -TimeoutSec 5
  Out-Check 'PASS' 'Game URL' ("$BaseUrl -> HTTP {0}" -f $r.StatusCode) ''
} catch { Out-Check 'FAIL' 'Game URL' "$BaseUrl not reachable" 'Start scripts\kiosk\serve-dist.cmd (or check the host / Wi-Fi / firewall)' }

function Test-Tcp([string]$h, [int]$port) {
  $c = New-Object Net.Sockets.TcpClient
  try { $ok = $c.ConnectAsync($h, $port).Wait(4000); return ($ok -and $c.Connected) } catch { return $false } finally { $c.Close() }
}
if ($SkipSupabase) { Write-Host '[SKIP] Supabase: not contacted (-SkipSupabase; Plan D needs no internet)' -ForegroundColor DarkGray }
elseif (Test-Tcp $SupabaseHost 443) { Out-Check 'PASS' 'Supabase' "${SupabaseHost}:443 reachable" '' }
else { Out-Check 'WARN' 'Supabase' "${SupabaseHost}:443 NOT reachable" 'Live mode needs internet. Check Wi-Fi / captive portal / hotspot. LOCAL DEMO still works.' }

Write-Host ''
Write-Host 'Manual checks this script cannot see: Shift x5 opens nothing; hold right Shift 9 s opens nothing; volume ~60 %;'
Write-Host 'Do not disturb on; Graphics setting for chrome.exe/msedge.exe = High performance (Settings > System > Display >'
Write-Host 'Graphics); chrome://gpu says "WebGL: Hardware accelerated"; the game page is at 100 % zoom (Ctrl+0).'
Write-Host ("FAIL count: {0}" -f $script:fails)
exit $script:fails
