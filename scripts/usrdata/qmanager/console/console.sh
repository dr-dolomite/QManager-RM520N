#!/bin/bash
# QManager Console — Shell startup for ttyd sessions
# Requires a single-use token from console_token.sh (passed by ttyd -a as $1),
# then sets up PATH for Entware tools and drops into an interactive bash shell.

TOKEN_DIR=/tmp/qmanager_console_tokens
TOKEN_MAX_AGE=30

refuse() {
    printf '\r\n  Console session expired. Reload the page to reconnect.\r\n'
    sleep 1
    exit 1
}

tok=$1
case "$tok" in ""|*[!0-9a-f]*) refuse ;; esac
[ ${#tok} -eq 64 ] || refuse
tok_file="$TOKEN_DIR/$tok"
# Another local account must not be able to pre-create the dir and plant tokens.
[ -d "$TOKEN_DIR" ] && [ ! -L "$TOKEN_DIR" ] || refuse
[ "$(stat -c '%U %a' "$TOKEN_DIR")" = "www-data 700" ] || refuse
# Atomic claim: a concurrent second use of the same token loses the mv.
claimed="$TOKEN_DIR/.claimed.$$"
mv "$tok_file" "$claimed" 2>/dev/null || refuse
if [ ! -f "$claimed" ] || [ -L "$claimed" ] || [ "$(stat -c %U "$claimed")" != "www-data" ]; then
    rm -f "$claimed"
    refuse
fi
IFS= read -r issued < "$claimed"
rm -f "$claimed" || refuse
case "$issued" in ""|*[!0-9]*) refuse ;; esac
age=$(( $(date +%s) - issued ))
[ "$age" -ge 0 ] && [ "$age" -le "$TOKEN_MAX_AGE" ] || refuse

export PATH=/opt/bin:/opt/sbin:/usrdata/root/bin:/usr/bin:/usr/sbin:/bin:/sbin
export HOME=/usrdata/root
export TERM=xterm-256color

cd "$HOME" 2>/dev/null || cd /

printf '\033[1;36m'
printf '  QManager Console\n'
printf '  Type "exit" to close this session.\n'
printf '\033[0m\n'

exec /bin/bash --login
