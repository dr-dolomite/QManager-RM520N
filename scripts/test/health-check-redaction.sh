#!/bin/bash
# Manual fixture: verify the qmanager_health_check redaction patterns mask
# every secret type, AND that raw secret files are never collected into the
# bundle in the first place. Run from a workstation, not the device.
#
#   bash scripts/test/health-check-redaction.sh
set -eu

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# --- Part 1: redaction ------------------------------------------------------
#
# The bundle stages msmtprc under the basename `msmtprc` regardless of where it
# was collected from. Since the relocation to /etc/qmanager-secrets/msmtprc,
# _collect_configs copies from the new path but MUST keep that basename,
# because _redact_tree matches on `-name 'msmtprc'`. Staging it here under the
# same name is what makes this part cover the relocated path.
cat > "$work/msmtprc" <<'EOF'
host smtp.example.com
user alice@example.com
password supersecret123
EOF

# A device whose migrate_alert_secrets() has not run (or failed) still has the
# secrets inline in these configs, so the redaction must cover them too.
cat > "$work/discord_bot.json" <<'EOF'
{
  "enabled": true,
  "bot_token": "MTIzNDU2Nzg5LmFiY2RlZg.legacyplaintexttoken"
}
EOF

cat > "$work/email_alerts.json" <<'EOF'
{
  "enabled": true,
  "app_password": "abcdefghijklmnop"
}
EOF

cat > "$work/log.log" <<'EOF'
2026-05-04 10:00:00 GET /api?key=tskey-auth-AbCdEfGhIjKlMnOpQrSt /
Cookie: session=abcdef1234567890
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9
EOF

# Run the same sed pipeline used in qmanager_health_check::_redact_tree
find "$work" -type f -print | while read -r f; do
    sed -i \
        -e 's/^\([[:space:]]*password[[:space:]]\).*/\1REDACTED/' \
        -e 's/tskey-[A-Za-z0-9_-]\{20,\}/tskey-REDACTED/g' \
        -e 's/\(Cookie:[[:space:]]\).*/\1REDACTED/I' \
        -e 's/\(Authorization:[[:space:]]\).*/\1REDACTED/I' \
        -e 's/\("bot_token"[[:space:]]*:[[:space:]]*\)"[^"]*"/\1"REDACTED"/g' \
        -e 's/\("app_password"[[:space:]]*:[[:space:]]*\)"[^"]*"/\1"REDACTED"/g' \
        "$f"
done

fail=0
grep -q 'supersecret123'                "$work/msmtprc" && { echo "FAIL: msmtprc password leaked"; fail=1; }
grep -q 'tskey-auth-AbCdEf'             "$work/log.log" && { echo "FAIL: tskey leaked";           fail=1; }
grep -q 'session=abcdef1234567890'      "$work/log.log" && { echo "FAIL: cookie leaked";          fail=1; }
grep -q 'eyJhbGciOiJIUzI1NiJ9'          "$work/log.log" && { echo "FAIL: bearer leaked";          fail=1; }
grep -q 'legacyplaintexttoken'          "$work/discord_bot.json"  && { echo "FAIL: legacy bot_token leaked";    fail=1; }
grep -q 'abcdefghijklmnop'              "$work/email_alerts.json" && { echo "FAIL: legacy app_password leaked"; fail=1; }
grep -q 'password REDACTED'             "$work/msmtprc" || { echo "FAIL: msmtprc not redacted";   fail=1; }
grep -q 'tskey-REDACTED'                "$work/log.log" || { echo "FAIL: tskey not redacted";     fail=1; }
grep -q 'Cookie: REDACTED'              "$work/log.log" || { echo "FAIL: cookie not redacted";    fail=1; }
grep -q 'Authorization: REDACTED'       "$work/log.log" || { echo "FAIL: auth not redacted";      fail=1; }
grep -q '"bot_token": "REDACTED"'       "$work/discord_bot.json"  || { echo "FAIL: bot_token not redacted";    fail=1; }
grep -q '"app_password": "REDACTED"'    "$work/email_alerts.json" || { echo "FAIL: app_password not redacted"; fail=1; }

# --- Part 2: raw secret files must never be COLLECTED -----------------------
#
# /etc/qmanager-secrets/discord_bot_token and email_app_password hold the raw
# value with no surrounding structure — there is no line for the redaction sed
# to match, because the whole file IS the secret. The only correct handling is
# never to collect them. This models a fake secrets dir plus the staged bundle
# and asserts (a) nothing collected them, and (b) the _purge_raw_secrets
# backstop removes them if a future collector ever does.
secrets="$work/etc-qmanager-secrets"
stage="$work/bundle/config"
mkdir -p "$secrets" "$stage"

printf '%s' 'RAWDISCORDTOKENVALUE' > "$secrets/discord_bot_token"
printf '%s' 'RAWEMAILAPPPASSWORD'  > "$secrets/email_app_password"
printf 'host smtp.example.com\npassword rawsmtppass456\n' > "$secrets/msmtprc"

# Model _collect_configs: msmtprc IS collected (under its redaction-matching
# basename); the two raw secret files are not.
[ -f "$secrets/msmtprc" ] && cp "$secrets/msmtprc" "$stage/msmtprc"

# Model _purge_raw_secrets: the backstop over the staged tree.
find "$work/bundle" -type f \( -name 'discord_bot_token' -o -name 'email_app_password' \) \
    -exec rm -f {} + 2>/dev/null || true

# Then redaction, in the order _build_bundle applies it.
find "$work/bundle" -type f -print | while read -r f; do
    sed -i -e 's/^\([[:space:]]*password[[:space:]]\).*/\1REDACTED/' "$f"
done

if grep -rq 'RAWDISCORDTOKENVALUE' "$work/bundle" 2>/dev/null; then
    echo "FAIL: raw discord_bot_token reached the bundle"; fail=1
fi
if grep -rq 'RAWEMAILAPPPASSWORD' "$work/bundle" 2>/dev/null; then
    echo "FAIL: raw email_app_password reached the bundle"; fail=1
fi
if [ -e "$stage/discord_bot_token" ] || [ -e "$stage/email_app_password" ]; then
    echo "FAIL: raw secret file present in staged bundle"; fail=1
fi
if grep -rq 'rawsmtppass456' "$work/bundle" 2>/dev/null; then
    echo "FAIL: relocated msmtprc password leaked (did the bundle basename change?)"; fail=1
fi
grep -q 'password REDACTED' "$stage/msmtprc" || { echo "FAIL: relocated msmtprc not redacted"; fail=1; }

if [ "$fail" = "0" ]; then echo "OK: all redactions applied, no raw secrets collected"; exit 0
else echo "redaction fixture failed"; exit 1; fi
