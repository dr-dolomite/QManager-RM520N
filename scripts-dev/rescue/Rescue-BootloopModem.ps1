<#
.SYNOPSIS
    Break a reboot loop on an RM520N-GL by winning the SSH race once, then
    removing the device's ability to reboot at all.

.DESCRIPTION
    A modem in a reboot loop is only reachable for a few seconds per cycle.
    Racing that window repeatedly to "do the fix" is a losing game, so this
    script does the smallest possible thing on first contact:

        it takes the `reboot` binary away and masks reboot.target.

    After that the device cannot reboot itself, the loop stops, and you have
    unlimited time to diagnose and repair calmly. Everything else this script
    does happens AFTER the loop is already broken.

    The displaced `reboot` is replaced by a stub that logs WHO called it and
    exits 0. That log is the point: it names the process that has been
    rebooting your modem. If the log stays empty while the device is up, the
    reboots were never userspace calls at all (kernel panic, hardware
    watchdog, or a modem-side subsystem restart) and this whole class of fix
    is aimed at the wrong layer.

    Every change is reversible with -Restore.

.PARAMETER ModemIP
    Modem address. Falls back to MODEM_IP in the .env file.

.PARAMETER User
    SSH user. Falls back to MODEM_SSH_USER.

.PARAMETER Password
    SSH password. Falls back to MODEM_SSH_PASSWORD.

.PARAMETER EnvFile
    Path to a .env holding MODEM_IP / MODEM_SSH_USER / MODEM_SSH_PASSWORD.

.PARAMETER DiagOnly
    Change nothing. Win the race, dump diagnostics, disconnect. Use this if
    you want to see what's happening before intervening. NOTE: with the loop
    still running you may only get partial output before the device drops.

.PARAMETER Restore
    Undo everything: put `reboot` back, unmask reboot.target, restore any
    stubbed QManager workers. Prints the blocked-reboot log first.

.PARAMETER MaxMinutes
    Give up after this many minutes of hammering. Default 30.

.PARAMETER PortTimeoutMs
    Per-attempt TCP connect timeout. Default 400ms. Lower = more attempts
    per second; too low and you miss a slow-but-open port.

.EXAMPLE
    # Normal rescue. START THIS FIRST, THEN POWER ON THE MODEM.
    .\Rescue-BootloopModem.ps1

.EXAMPLE
    .\Rescue-BootloopModem.ps1 -ModemIP 192.168.225.1 -User root -Password secret

.EXAMPLE
    # After the device is repaired, give it back the ability to reboot:
    .\Rescue-BootloopModem.ps1 -Restore

.NOTES
    Requires the Posh-SSH module:  Install-Module Posh-SSH -Scope CurrentUser
    Target: RM520N-GL (BusyBox sh, systemd 244). Uses no bash-isms.
#>

[CmdletBinding()]
param(
    [string]$ModemIP,
    [string]$User,
    [string]$Password,
    [string]$EnvFile = "$PSScriptRoot\..\..\.env",
    [switch]$DiagOnly,
    [switch]$Restore,
    [int]$MaxMinutes = 30,
    [int]$PortTimeoutMs = 400,
    [int]$Port = 22
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Console helpers
# ---------------------------------------------------------------------------
$script:LogPath = Join-Path $PSScriptRoot ("rescue-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $ts = Get-Date -Format 'HH:mm:ss.fff'
    $line = "[$ts] [$Level] $Message"
    switch ($Level) {
        'OK'    { Write-Host $line -ForegroundColor Green }
        'WARN'  { Write-Host $line -ForegroundColor Yellow }
        'ERR'   { Write-Host $line -ForegroundColor Red }
        'HIT'   { Write-Host $line -ForegroundColor Cyan }
        default { Write-Host $line }
    }
    Add-Content -Path $script:LogPath -Value $line -ErrorAction SilentlyContinue
}

function Write-Banner {
    param([string]$Text)
    Write-Host ""
    Write-Host ("=" * 72) -ForegroundColor DarkCyan
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host ("=" * 72) -ForegroundColor DarkCyan
}

# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------
function Resolve-Credentials {
    if (-not $ModemIP -or -not $User -or -not $Password) {
        if (Test-Path $EnvFile) {
            $cfg = @{}
            Get-Content $EnvFile | ForEach-Object {
                if ($_ -match '^\s*([A-Za-z_]+)\s*=\s*(.*)$') {
                    $cfg[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
                }
            }
            if (-not $ModemIP)  { $script:ModemIP  = $cfg['MODEM_IP'] }
            if (-not $User)     { $script:User     = $cfg['MODEM_SSH_USER'] }
            if (-not $Password) { $script:Password = $cfg['MODEM_SSH_PASSWORD'] }
        }
    }
    if (-not $script:ModemIP)  { throw "No modem IP. Pass -ModemIP or set MODEM_IP in $EnvFile" }
    if (-not $script:User)     { throw "No SSH user. Pass -User or set MODEM_SSH_USER in $EnvFile" }
    if (-not $script:Password) { throw "No SSH password. Pass -Password or set MODEM_SSH_PASSWORD in $EnvFile" }
}

# ---------------------------------------------------------------------------
# Fast port probe. Much cheaper than attempting a full SSH handshake against
# a closed port, which is what lets us poll aggressively.
# ---------------------------------------------------------------------------
function Test-PortOpen {
    param([string]$ComputerName, [int]$TcpPort, [int]$TimeoutMs)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $ar = $client.BeginConnect($ComputerName, $TcpPort, $null, $null)
        if ($ar.AsyncWaitHandle.WaitOne($TimeoutMs, $false) -and $client.Connected) {
            $client.EndConnect($ar) | Out-Null
            return $true
        }
        return $false
    } catch {
        return $false
    } finally {
        try { $client.Close() } catch {}
        try { $client.Dispose() } catch {}
    }
}

# ---------------------------------------------------------------------------
# PAYLOADS
#
# Single-quoted here-strings: PowerShell does NOT touch $ or backticks, so
# what is written here is exactly what the device's shell receives.
# ---------------------------------------------------------------------------

# STAGE A — THE ONLY TIME-CRITICAL STEP.
# Kept deliberately small. Once this lands, the loop is broken and nothing
# else is a race. Idempotent: safe to run again on a later cycle if an
# earlier attempt was cut off mid-way.
$PAYLOAD_STAGE_A = @'
mkdir -p /etc/qmrescue 2>/dev/null
date >> /etc/qmrescue/contacts.log 2>/dev/null
# Masking comes FIRST and matters most. On RM520N /sbin/reboot is a symlink to
# /bin/systemctl, so `reboot` is really `systemctl reboot` -> start
# reboot.target. Masking the target (and the service behind it) blocks BOTH
# `reboot` and a direct `systemctl reboot`, which a binary stub alone cannot.
systemctl mask reboot.target systemd-reboot.service 2>/dev/null
R=$(command -v reboot 2>/dev/null)
[ -z "$R" ] && R=/sbin/reboot
if [ ! -f /etc/qmrescue/reboot.saved ] && [ -e "$R" ]; then
    printf '%s\n' "$R" > /etc/qmrescue/reboot.path
    # On this platform reboot is a symlink to /bin/systemctl. Record the link
    # target rather than copying a multi-megabyte binary — this has to be fast.
    if [ -L "$R" ]; then
        printf 'symlink %s\n' "$(readlink "$R")" > /etc/qmrescue/reboot.saved
    else
        cp -p "$R" /etc/qmrescue/reboot.bin 2>/dev/null
        printf 'binary\n' > /etc/qmrescue/reboot.saved
    fi
    cat > /tmp/.qmrb <<'RBEOF'
#!/bin/sh
# QMANAGER RESCUE STUB — userspace reboot is blocked.
# Restore with: Rescue-BootloopModem.ps1 -Restore
{
    echo "=== BLOCKED REBOOT at $(date) uptime=$(cut -d. -f1 /proc/uptime)s ==="
    echo "  caller pid=$PPID cmd=$(tr '\0' ' ' < /proc/$PPID/cmdline 2>/dev/null)"
    gp=$(awk '{print $4}' /proc/$PPID/stat 2>/dev/null)
    echo "  parent pid=$gp cmd=$(tr '\0' ' ' < /proc/$gp/cmdline 2>/dev/null)"
    ggp=$(awk '{print $4}' /proc/$gp/stat 2>/dev/null)
    echo "  gparent pid=$ggp cmd=$(tr '\0' ' ' < /proc/$ggp/cmdline 2>/dev/null)"
} >> /etc/qmrescue/blocked_reboots.log 2>/dev/null
exit 0
RBEOF
    chmod 0755 /tmp/.qmrb
    mv /tmp/.qmrb "$R"
fi
sync
echo "STAGE_A_OK blocked=$R masked=$(systemctl is-enabled reboot.target 2>&1) uptime=$(cut -d. -f1 /proc/uptime)"
'@

# STAGE B — disarm every QManager schedule and neuter reboot-capable workers.
# Runs only after the loop is already broken, so it can be thorough.
$PAYLOAD_STAGE_B = @'
mkdir -p /etc/qmrescue/backup 2>/dev/null
for u in qmanager-scheduled-reboot qmanager-auto-update \
         qmanager-tower-schedule-apply qmanager-tower-schedule-clear \
         qmanager-scenario-schedule qm-issue9-probe; do
    systemctl stop "$u.timer" 2>/dev/null
    systemctl stop "$u.service" 2>/dev/null
    rm -f "/lib/systemd/system/timers.target.wants/$u.timer" 2>/dev/null
done
for w in qmanager_scheduled_reboot qmanager_auto_update qmanager_update \
         qmanager_watchcat; do
    if [ -f "/usr/bin/$w" ] && [ ! -f "/etc/qmrescue/backup/$w" ]; then
        cp -p "/usr/bin/$w" "/etc/qmrescue/backup/$w" 2>/dev/null
        printf '#!/bin/sh\n# QMANAGER RESCUE STUB\nexit 0\n' > "/usr/bin/$w"
        chmod 0755 "/usr/bin/$w"
        echo "  stubbed /usr/bin/$w"
    fi
done
systemctl daemon-reload 2>/dev/null
sync
echo "--- armed timers now ---"
ls -l /lib/systemd/system/timers.target.wants/ 2>&1
echo "STAGE_B_OK"
'@

# STAGE C — diagnostics. This is what actually tells us the cause.
$PAYLOAD_STAGE_C = @'
echo "########## UPTIME / CLOCK ##########"
date; uptime; cat /proc/uptime
echo "hwclock: $(hwclock -r 2>&1)"
echo
echo "########## WHO HAS BEEN CALLING REBOOT ##########"
if [ -s /etc/qmrescue/blocked_reboots.log ]; then
    tail -40 /etc/qmrescue/blocked_reboots.log
else
    echo "(empty — no userspace process has called reboot since the block)"
fi
echo
echo "########## ARMED TIMERS ##########"
ls -l /lib/systemd/system/timers.target.wants/ 2>&1
systemctl list-timers --all --no-pager 2>&1 | head -12
echo
echo "########## QMANAGER SCHEDULE / WATCHDOG CONFIG ##########"
grep -i 'sched_reboot\|watchdog\|watchcat\|auto_update' /etc/qmanager/qmanager.conf 2>/dev/null || echo "(no matches / no config)"
echo
echo "########## FAILED UNITS ##########"
systemctl --failed --no-pager 2>&1 | head -20
echo
echo "########## HARDWARE WATCHDOG ##########"
ls -l /dev/watchdog* 2>&1
cat /sys/class/watchdog/watchdog0/state 2>/dev/null
cat /sys/class/watchdog/watchdog0/timeout 2>/dev/null
echo
echo "########## KERNEL TAIL (panic / reset clues) ##########"
dmesg 2>/dev/null | tail -40
echo
echo "########## PREVIOUS BOOT LOG: reboot/panic/watchdog lines ##########"
grep -i 'reboot\|shutdown\|panic\|watchdog\|SSR\|subsystem restart\|modem_restart' /var/log/messages.0 2>/dev/null | tail -30
echo
echo "########## THIS BOOT LOG: same ##########"
grep -i 'reboot\|shutdown\|panic\|watchdog\|SSR\|subsystem restart\|modem_restart' /var/log/messages 2>/dev/null | tail -30
echo "STAGE_C_OK"
'@

# RESTORE — put the device back the way it was.
$PAYLOAD_RESTORE = @'
echo "########## BLOCKED REBOOT LOG (read this before it goes away) ##########"
cat /etc/qmrescue/blocked_reboots.log 2>/dev/null || echo "(none)"
echo
R=$(cat /etc/qmrescue/reboot.path 2>/dev/null)
[ -z "$R" ] && R=/sbin/reboot
kind=$(awk '{print $1}' /etc/qmrescue/reboot.saved 2>/dev/null)
if [ "$kind" = "symlink" ]; then
    tgt=$(awk '{print $2}' /etc/qmrescue/reboot.saved)
    rm -f "$R"
    ln -s "$tgt" "$R"
    echo "restored $R -> $tgt"
elif [ "$kind" = "binary" ] && [ -f /etc/qmrescue/reboot.bin ]; then
    cp -p /etc/qmrescue/reboot.bin "$R" 2>/dev/null || cp /etc/qmrescue/reboot.bin "$R"
    chmod 0755 "$R"
    echo "restored $R (binary)"
else
    echo "WARNING: nothing saved at /etc/qmrescue/reboot.saved"
    echo "         if reboot is broken, run this on the device:"
    echo "             ln -sf /bin/systemctl $R"
fi
systemctl unmask reboot.target systemd-reboot.service 2>/dev/null && echo "unmasked reboot.target + systemd-reboot.service"
systemctl daemon-reload 2>/dev/null
for w in qmanager_scheduled_reboot qmanager_auto_update qmanager_update qmanager_watchcat; do
    if [ -f "/etc/qmrescue/backup/$w" ]; then
        cp -p "/etc/qmrescue/backup/$w" "/usr/bin/$w"
        chmod 0755 "/usr/bin/$w"
        echo "restored /usr/bin/$w"
    fi
done
systemctl daemon-reload 2>/dev/null
sync
echo "RESTORE_OK — schedules remain DISARMED on purpose; re-enable them in the UI."
'@

# ---------------------------------------------------------------------------
# The hammer: poll the port hard, and the instant it opens, connect and fire.
# ---------------------------------------------------------------------------
function Invoke-Hammer {
    param([string]$FirstPayload, [string]$FirstLabel)

    $sec  = ConvertTo-SecureString $script:Password -AsPlainText -Force
    $cred = New-Object System.Management.Automation.PSCredential($script:User, $sec)

    $deadline = (Get-Date).AddMinutes($MaxMinutes)
    $attempts = 0
    $lastDot  = Get-Date

    Write-Log "Hammering $($script:ModemIP):$Port  (timeout ${PortTimeoutMs}ms/attempt, giving up in $MaxMinutes min)"
    Write-Log "Waiting for the port to open. Power-cycle the modem now if it isn't already looping." 'WARN'

    while ((Get-Date) -lt $deadline) {
        $attempts++

        if (-not (Test-PortOpen -ComputerName $script:ModemIP -TcpPort $Port -TimeoutMs $PortTimeoutMs)) {
            if (((Get-Date) - $lastDot).TotalSeconds -ge 5) {
                Write-Host "." -NoNewline -ForegroundColor DarkGray
                $lastDot = Get-Date
            }
            continue
        }

        Write-Host ""
        Write-Log "PORT OPEN after $attempts attempts — connecting" 'HIT'

        $session = $null
        try {
            $session = New-SSHSession -ComputerName $script:ModemIP -Credential $cred `
                                      -AcceptKey -ConnectionTimeout 6 -ErrorAction Stop
        } catch {
            Write-Log "handshake lost ($($_.Exception.Message)) — retrying" 'WARN'
            continue
        }

        Write-Log "SSH UP — firing $FirstLabel" 'HIT'
        try {
            $r = Invoke-SSHCommand -SessionId $session.SessionId -Command $FirstPayload -TimeOut 30
            $out = ($r.Output -join "`n")
            if ($r.Error) { $out += "`n" + ($r.Error -join "`n") }
            Write-Host $out
            Add-Content -Path $script:LogPath -Value $out -ErrorAction SilentlyContinue
            return $session
        } catch {
            Write-Log "died mid-payload ($($_.Exception.Message)) — will retry next cycle" 'WARN'
            try { Remove-SSHSession -SessionId $session.SessionId | Out-Null } catch {}
            continue
        }
    }

    Write-Log "Gave up after $MaxMinutes minutes / $attempts attempts." 'ERR'
    return $null
}

function Invoke-Stage {
    param($Session, [string]$Payload, [string]$Label, [int]$Timeout = 90)
    Write-Banner $Label
    try {
        $r = Invoke-SSHCommand -SessionId $Session.SessionId -Command $Payload -TimeOut $Timeout
        $out = ($r.Output -join "`n")
        if ($r.Error) { $out += "`n--- stderr ---`n" + ($r.Error -join "`n") }
        Write-Host $out
        Add-Content -Path $script:LogPath -Value "`n=== $Label ===`n$out" -ErrorAction SilentlyContinue
        return $true
    } catch {
        Write-Log "$Label failed: $($_.Exception.Message)" 'ERR'
        return $false
    }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
try {
    Import-Module Posh-SSH -ErrorAction Stop
} catch {
    Write-Host "Posh-SSH is required. Install it with:" -ForegroundColor Red
    Write-Host "    Install-Module Posh-SSH -Scope CurrentUser" -ForegroundColor Yellow
    exit 2
}

Resolve-Credentials

Write-Banner "RM520N-GL BOOTLOOP RESCUE"
Write-Log "target   : $($script:ModemIP):$Port as $($script:User)"
Write-Log "transcript: $script:LogPath"

if ($Restore) {
    Write-Log "MODE: RESTORE — giving the device back its reboot capability" 'WARN'
    $session = Invoke-Hammer -FirstPayload $PAYLOAD_RESTORE -FirstLabel "RESTORE"
    if ($session) {
        Remove-SSHSession -SessionId $session.SessionId | Out-Null
        Write-Log "Restore complete." 'OK'
    }
    exit 0
}

if ($DiagOnly) {
    Write-Log "MODE: DIAGNOSTICS ONLY — nothing will be changed" 'WARN'
    Write-Log "The loop is still running, so output may be cut short." 'WARN'
    $session = Invoke-Hammer -FirstPayload $PAYLOAD_STAGE_C -FirstLabel "DIAGNOSTICS"
    if ($session) { Remove-SSHSession -SessionId $session.SessionId | Out-Null }
    exit 0
}

# --- Normal rescue --------------------------------------------------------
Write-Log "MODE: RESCUE" 'WARN'
Write-Host ""
Write-Host "  Stage A takes the 'reboot' binary away and masks reboot.target." -ForegroundColor Yellow
Write-Host "  That is the whole trick: after it lands, the device physically" -ForegroundColor Yellow
Write-Host "  cannot reboot itself and the loop stops. Everything after that" -ForegroundColor Yellow
Write-Host "  is unhurried. Undo it later with -Restore." -ForegroundColor Yellow
Write-Host ""

$session = Invoke-Hammer -FirstPayload $PAYLOAD_STAGE_A -FirstLabel "STAGE A (break the loop)"

if (-not $session) {
    Write-Log "Never got in. Things to try:" 'ERR'
    Write-Log "  * confirm the IP is right and your PC is on the modem's network" 'ERR'
    Write-Log "  * raise -PortTimeoutMs to 800 if the network is slow" 'ERR'
    Write-Log "  * run with -MaxMinutes 60 and power-cycle the modem again" 'ERR'
    exit 1
}

Write-Log "STAGE A LANDED — the loop should now be broken." 'OK'

# Confirm the loop is actually broken by watching uptime climb.
Write-Banner "VERIFY: is the device staying up?"
$prev = -1
$stable = 0
for ($i = 1; $i -le 6; $i++) {
    Start-Sleep -Seconds 10
    try {
        $r  = Invoke-SSHCommand -SessionId $session.SessionId -Command "cut -d. -f1 /proc/uptime" -TimeOut 15
        $up = [int](($r.Output -join "").Trim())
        if ($up -gt $prev) { $stable++; Write-Log "uptime = ${up}s (climbing)" 'OK' }
        else { Write-Log "uptime = ${up}s (RESET — still looping!)" 'ERR'; $stable = 0 }
        $prev = $up
    } catch {
        Write-Log "connection lost — device likely rebooted again" 'ERR'
        Write-Log "Re-run the script; Stage A is idempotent and will retry." 'WARN'
        exit 1
    }
}

if ($stable -ge 5) {
    Write-Log "LOOP BROKEN — device has been up continuously through the check." 'OK'
} else {
    Write-Log "Device still unstable. Diagnostics below are especially important." 'WARN'
}

Invoke-Stage -Session $session -Payload $PAYLOAD_STAGE_B -Label "STAGE B: disarm QManager schedules" | Out-Null
Invoke-Stage -Session $session -Payload $PAYLOAD_STAGE_C -Label "STAGE C: diagnostics" -Timeout 120 | Out-Null

Write-Banner "DONE"
Write-Host @"
  The device can no longer reboot itself. It is safe to leave it powered on.

  READ THIS FIRST in the diagnostics above:
     "WHO HAS BEEN CALLING REBOOT"

     * Names a process  -> that process is your culprit. It is now harmless
                           (reboot is a no-op), so you can fix it calmly.
     * Stays EMPTY      -> nothing in userspace is calling reboot. The resets
                           are coming from below: kernel panic, the hardware
                           watchdog (/dev/watchdog), or a modem-side subsystem
                           restart. QManager is not the cause and masking it
                           was never going to help.

  Leave it running a few minutes, then re-run with -DiagOnly to see whether
  the log has filled in.

  When the device is healthy again, hand back reboot with:
      .\Rescue-BootloopModem.ps1 -Restore

  Transcript saved to:
      $script:LogPath
"@ -ForegroundColor Cyan

Remove-SSHSession -SessionId $session.SessionId | Out-Null
