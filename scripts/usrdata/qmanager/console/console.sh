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
[ -f "$tok_file" ] && [ ! -L "$tok_file" ] || refuse
IFS= read -r issued < "$tok_file"
rm -f "$tok_file"
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
