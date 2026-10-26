# Creates (or re-passwords) the Station C login on the live Supabase project.
# Run from the repo root:  powershell -ExecutionPolicy Bypass -File scripts\kiosk\create-station-c.ps1
# It asks for the service_role key and the new password (both hidden while typing), runs
# supabase/scripts/provision-users.mjs, then clears both from memory. Nothing is saved to disk.
$ErrorActionPreference = 'Stop'

function Read-Secret([string]$prompt) {
  $s = Read-Host -Prompt $prompt -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}

$email = Read-Host -Prompt 'Station C email (same style as A/B, e.g. station-c@yourdomain)'
$env:SUPABASE_URL = 'https://abkohhdjlufhsbqrchpn.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY = Read-Secret 'Paste the service_role key (Supabase > Project Settings > API Keys)'
$env:PROVISION_PASSWORD = Read-Secret 'New Station C password (12+ chars, upper + lower + digit)'
try {
  node supabase/scripts/provision-users.mjs station station_c $email
} finally {
  Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY, Env:PROVISION_PASSWORD -ErrorAction SilentlyContinue
}
