# Creates .env for this project by asking for each value.
# Run from this folder:  powershell -ExecutionPolicy Bypass -File setup-env.ps1
# Passwords and keys are typed hidden and only written to .env on this computer.

$ErrorActionPreference = "Stop"

function Ask([string]$label, [string]$default = "") {
    $prompt = if ($default) { "$label [$default]" } else { $label }
    $value = Read-Host $prompt
    if ([string]::IsNullOrWhiteSpace($value)) { $value = $default }
    return $value.Trim()
}

function AskSecret([string]$label) {
    $secure = Read-Host $label -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)).Trim() }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

$envPath = Join-Path $PSScriptRoot ".env"
if (Test-Path $envPath) {
    $answer = Read-Host ".env already exists. Replace it? (y/n)"
    if ($answer -notmatch '^[yY]') { Write-Host "Nothing changed."; exit }
}

Write-Host ""
Write-Host "Supabase" -ForegroundColor Cyan
$supabaseUrl = Ask "Supabase URL" "https://rqvawgtpdjkwdbgftwxz.supabase.co"
$supabaseKey = AskSecret "Supabase service_role key"

Write-Host ""
Write-Host "Akidha PROD (api.akidha.in)" -ForegroundColor Cyan
$prodEmail = Ask "PROD login email"
$prodPass  = AskSecret "PROD password"

Write-Host ""
Write-Host "Akidha STAGE (stageapi.akidha.in)" -ForegroundColor Cyan
$stageEmail = Ask "STAGE login email"
$stagePass  = AskSecret "STAGE password"

Write-Host ""
$mode = (Ask "Use which Akidha now? STAGE or PROD" "STAGE").ToUpper()
if ($mode -ne "PROD") { $mode = "STAGE" }
$dashboardPassword = Ask "Dashboard password" "change-me"

$text = @"
SUPABASE_URL=$supabaseUrl
SUPABASE_SERVICE_KEY=$supabaseKey

# Which Akidha to use: PROD or STAGE. Change this one line to switch.
AKIDHA_ENV=$mode

AKIDHA_BASE_URL_PROD=https://api.akidha.in
AKIDHA_EMAIL_PROD=$prodEmail
AKIDHA_PASSWORD_PROD=$prodPass

AKIDHA_BASE_URL_STAGE=https://stageapi.akidha.in
AKIDHA_EMAIL_STAGE=$stageEmail
AKIDHA_PASSWORD_STAGE=$stagePass

DASHBOARD_PASSWORD=$dashboardPassword
PORT=8888
"@

# UTF-8 without BOM, which is what the server expects.
[IO.File]::WriteAllText($envPath, $text, (New-Object System.Text.UTF8Encoding $false))
Write-Host ""
Write-Host ".env saved ($mode). Now run: npm start" -ForegroundColor Green
