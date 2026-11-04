---
name: authenticated-cgi-probe-and-qcmd-stub
description: How to probe auth-gated CGI endpoints legitimately (HTTPS + live session token) and how to exercise a script's AT-failure branches with zero device footprint via a qcmd shell-function stub
metadata:
  type: reference
---

Two recipes that repeatedly unblock read-only investigations.

## 1. Probing an auth-gated CGI endpoint WITHOUT `_SKIP_AUTH=1`

`_SKIP_AUTH=1` is banned for validation (it masks permission bugs — see the project rule). But most `quecmanager/**` endpoints are session-gated and return 401. The legitimate path:

```sh
TOK=$(ls -1 /tmp/qmanager_sessions/ 2>/dev/null | head -1)
curl -sS -k -b "qm_session=$TOK" "https://127.0.0.1/cgi-bin/quecmanager/<ns>/<ep>.sh"
```

- **Port 80 gives a 301 to https** — a plain `http://127.0.0.1/...` probe returns `HTTP/1.1 301 Moved Permanently` with an empty body and looks like a broken endpoint. Always `-k` + `https://`.
- **Session store is `/tmp/qmanager_sessions/<token>`**, one file per session, contents = `date +%s`, `SESSION_MAX_AGE=3600`. Dir is `drwx------ www-data`, so you need root (SSH) to list it.
- **Cookie names**: `qm_session` (HttpOnly, the real one) and `qm_logged_in` (indicator only, not checked).
- **`qm_validate_session` is side-effect-free for a VALID session** — it only `rm`s the file when already expired, and never refreshes the timestamp. So reusing a live token neither extends nor consumes the user's session. Verify this is still true (`cgi_auth.sh`, the `qm_validate_session` body) before relying on it.
- Running `curl` as root is fine: lighttpd still executes the CGI as `www-data`, which is the thing that matters.
- If no session exists, say so and ask — do not log in (a login writes a session file and burns a rate-limit slot).

**Why:** it is the only way to get a real endpoint response that reflects the `www-data` permission context, which is what Phase 5 validation requires.

## 2. Exercising AT-failure branches with zero device footprint

To see what a script does when `qcmd` fails, **shadow `qcmd` with a shell function** in your own SSH shell. A function beats `/usr/bin/qcmd` on the PATH, so every library call resolves to the stub. Nothing is written, no AT command is sent, no lock is taken, the poller is not perturbed:

```sh
. /usr/lib/qmanager/<lib>.sh 2>/dev/null   # source FIRST
qcmd() { return 1; }                        # real failure mode: rc=1, EMPTY stdout
echo "[$(some_read_fn)]"
qcmd() { printf 'AT+FOO\n\nOK\n'; return 0; }  # rc=0 but no payload line
echo "[$(some_read_fn)]"
```

Two distinct failure shapes worth testing separately — they often take *different* branches:
- **rc=1 + empty stdout** — the genuine `qcmd` failure contract (`ERROR` never reaches stdout).
- **rc=0 + response missing the expected `+XXX:` line** — truncation/interleaving. Several parsers treat this as a valid negative answer rather than an error.

**Gotcha:** busybox `printf` in the stub does not eat `\"` the way you expect — escaped double quotes come through with literal backslashes and corrupt the simulated payload. For a stub that must contain quotes, build the string with a heredoc or single-quoted `cat`, and sanity-check the stub's own output before trusting the result. Prefer comparing against a **real** live read for the success case instead of simulating it.

**How to apply:** use this whenever a report needs to claim "on a failed read this renders as X" and inducing a real failure would require a write or holding the AT mutex. It is strictly better than the `flock`-contention recipe in [[at_mutex_duty_cycle_and_contention_recipe]] when you only need the *branch*, not the *timing*.
