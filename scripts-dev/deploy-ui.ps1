#!/usr/bin/env pwsh
# Deploys the built `out/` static export to a live modem, swapping it in
# for the live docroot while preserving cgi-bin. See memory
# "reference_deploying_web_assets_to_device" for the verified recipe this
# follows (scp -O tarball, cp -a cgi-bin across, prune cgi-bin from the
# chmod normalization, atomic rename swap).
#
# Target device is chosen with -rm520 / -rg501 (bun forwards `--rm520` the
# same way — PowerShell 7 treats a leading `--` as `-` for named params).
param(
    [switch]$rm520,
    [switch]$rg501
)
$ErrorActionPreference = "Stop"

if ($rm520 -and $rg501) {
    throw "Pass only one of -rm520 / -rg501"
}
if (-not $rm520 -and -not $rg501) {
    # No flag given — default to the RM520N-GL (the reference target).
    $rm520 = $true
}
$target = if ($rm520) { "RM520N-GL" } else { "RG501Q-EU" }
$envPrefix = if ($rm520) { "RM520N" } else { "RG501Q" }

$RootDir = Split-Path -Parent $PSScriptRoot
$OutDir = Join-Path $RootDir "out"
$EnvFile = Join-Path $RootDir ".env"

if (-not (Test-Path $OutDir)) {
    throw "'out/' not found — run 'bun run build' first"
}
if (-not (Test-Path $EnvFile)) {
    throw ".env not found at repo root — need ${envPrefix}_IP / ${envPrefix}_SSH_USER / ${envPrefix}_SSH_PASSWORD"
}

# --- Load .env (simple KEY=VALUE parser, ignores comments/blank lines) ------
$envVars = @{}
foreach ($line in Get-Content $EnvFile) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $parts = $line -split '=', 2
    $key = $parts[0].Trim()
    $val = $parts[1].Trim()
    $envVars[$key] = $val
}

$modemIp = $envVars["${envPrefix}_IP"]
$modemUser = $envVars["${envPrefix}_SSH_USER"]
$modemPass = $envVars["${envPrefix}_SSH_PASSWORD"]
if ($rm520) {
    # Bare MODEM_* triad is a long-standing alias for the RM520N-GL only.
    if (-not $modemIp) { $modemIp = $envVars["MODEM_IP"] }
    if (-not $modemUser) { $modemUser = $envVars["MODEM_SSH_USER"] }
    if (-not $modemPass) { $modemPass = $envVars["MODEM_SSH_PASSWORD"] }
}

if (-not $modemIp -or -not $modemUser -or -not $modemPass) {
    throw "Missing ${envPrefix}_IP/${envPrefix}_SSH_USER/${envPrefix}_SSH_PASSWORD in .env"
}

Write-Host "[deploy-ui] Target: $target ($modemIp)" -ForegroundColor Cyan

if (-not (Get-Module -ListAvailable Posh-SSH)) {
    throw "Posh-SSH PowerShell module is required. Install with: Install-Module Posh-SSH -Scope CurrentUser"
}
Import-Module Posh-SSH

Write-Host "[deploy-ui] Packing out/ ..." -ForegroundColor Green
$archive = Join-Path $RootDir "qmanager-build\ui-deploy.tar.gz"
New-Item -ItemType Directory -Force -Path (Split-Path $archive) | Out-Null
if (Test-Path $archive) { Remove-Item $archive -Force }
Push-Location $OutDir
try {
    tar -czf $archive .
} finally {
    Pop-Location
}
if (-not (Test-Path $archive)) { throw "Failed to create $archive" }
$sizeMb = [math]::Round((Get-Item $archive).Length / 1MB, 2)
Write-Host "[deploy-ui] Archive: $archive ($sizeMb MB)" -ForegroundColor Green

$securePass = ConvertTo-SecureString $modemPass -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($modemUser, $securePass)

Write-Host "[deploy-ui] Connecting to $modemIp ..." -ForegroundColor Green
$session = New-SSHSession -ComputerName $modemIp -Credential $cred -AcceptKey -Force

try {
    Write-Host "[deploy-ui] Uploading archive ..." -ForegroundColor Green
    Set-SCPItem -ComputerName $modemIp -Credential $cred -AcceptKey -Path $archive -Destination "/tmp"

    $remoteExtractScript = @'
set -eu
WWW_ROOT="/usrdata/qmanager/www"
NEW="/usrdata/qmanager/www.new"
PREV="/usrdata/qmanager/www.prev"
ARCHIVE="/tmp/ui-deploy.tar.gz"

rm -rf "$NEW"
mkdir -p "$NEW"
tar -xzf "$ARCHIVE" -C "$NEW"
rm -f "$ARCHIVE"

# Carry the live cgi-bin across untouched (a next export contains none).
if [ -d "$WWW_ROOT/cgi-bin" ]; then
    cp -a "$WWW_ROOT/cgi-bin" "$NEW/cgi-bin"
fi

# Normalize modes on everything EXCEPT cgi-bin — a blanket chmod there
# strips the exec bit from every CGI script and cp -a already carried the
# live modes across correctly.
find "$NEW" -path "$NEW/cgi-bin" -prune -o -type f -exec chmod 0644 {} +
find "$NEW" -path "$NEW/cgi-bin" -prune -o -type d -exec chmod 0755 {} +

# Preflight: cgi-bin must still be executable before we swap it live.
if [ -d "$NEW/cgi-bin" ] && [ -f "$NEW/cgi-bin/quecmanager/auth/check.sh" ]; then
    [ -x "$NEW/cgi-bin/quecmanager/auth/check.sh" ] || { echo "REFUSING SWAP: auth/check.sh lost its exec bit" >&2; exit 1; }
fi

rm -rf "$PREV"
[ -d "$WWW_ROOT" ] && mv "$WWW_ROOT" "$PREV"
mv "$NEW" "$WWW_ROOT"
echo "DEPLOY_OK"
'@

    Write-Host "[deploy-ui] Extracting and swapping on device ..." -ForegroundColor Green
    $result = Invoke-SSHCommand -SSHSession $session -Command $remoteExtractScript -TimeOut 120
    Write-Host $result.Output
    if ($result.Error) { Write-Host $result.Error -ForegroundColor Yellow }
    if ($result.ExitStatus -ne 0 -or ($result.Output -notmatch "DEPLOY_OK")) {
        throw "Remote deploy failed (exit $($result.ExitStatus))"
    }
    Write-Host "[deploy-ui] Deployed successfully. Rollback on device: mv /usrdata/qmanager/www.prev /usrdata/qmanager/www" -ForegroundColor Green
}
finally {
    Remove-SSHSession -SSHSession $session | Out-Null
}
