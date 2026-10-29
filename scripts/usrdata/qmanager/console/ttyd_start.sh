#!/bin/sh
# QManager Console — ttyd launcher. Sets a fresh random credential on every
# start; the browser fetches it from the login-gated console_token.sh CGI.

TOKEN_FILE=/tmp/qmanager_console.token
CONSOLE_DIR=/usrdata/qmanager/console

secret=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
[ ${#secret} -eq 64 ] || { echo "qmanager-console: no random source" >&2; exit 1; }
cred="qm:${secret}"

# ttyd compares the client's AuthToken against base64(user:pass).
rm -f "$TOKEN_FILE"
( umask 027; printf '%s' "$cred" | base64 | tr -d '\n' > "$TOKEN_FILE" ) || exit 1
chgrp www-data "$TOKEN_FILE" || exit 1

exec "$CONSOLE_DIR/ttyd" -i 127.0.0.1 -p 8080 -c "$cred" \
    -t 'theme={"foreground":"#e4e4e7","background":"#09090b","cursor":"#e4e4e7"}' \
    -t fontSize=14 --writable "$CONSOLE_DIR/console.sh"
