---
name: cgi-env-authorization-and-no-path
description: lighttpd DOES export HTTP_AUTHORIZATION (and any X-* header) to CGI on RM520N-GL, but curl STRIPS Authorization across the config's http-to-https 301; CGI also gets NO PATH at all
metadata:
  type: reference
---

Measured 2026-09-07 on RM520N-GL (serial `61368cd2`, lighttpd/1.4.82 (ssl)) with a throwaway `_SKIP_AUTH=1` CGI that dumped `env | sort`, curled from the device and from a LAN host.

**1. `HTTP_AUTHORIZATION` is exported.** `curl -H 'Authorization: Bearer testtoken123'` produced `HTTP_AUTHORIZATION=Bearer testtoken123` verbatim. Arbitrary custom headers arrive too (`X-QM-Token:` -> `HTTP_X_QM_TOKEN=`). The config loads no `mod_auth`, so nothing consumes the header. A bearer-token CGI API is viable with no lighttpd change.

**2. The trap: curl DROPS `Authorization` when following the config's http->https 301.** `$HTTP["scheme"] == "http" { url.redirect = ... }` means every plain-HTTP request 301s. With `curl -L`, `HTTP_X_QM_TOKEN` survived the hop but `HTTP_AUTHORIZATION` was **absent** — curl treats a scheme change as cross-origin and strips credential headers. So `curl -L http://<modem>/...` with a bearer token silently arrives UNAUTHENTICATED and looks like a broken server.

**Why:** this is invisible in any test that uses `https://` directly, which is the natural way to probe. The failure mode is a 401 with a token the user swears is correct.

**How to apply:** when designing or debugging any header-authenticated endpoint here, always probe over `https://` with `-k` (self-signed cert), and treat a missing `HTTP_AUTHORIZATION` as "the client followed a redirect" before suspecting lighttpd. Document `https://` in any user-facing curl example. A custom `X-…` header is redirect-durable where `Authorization` is not.

**3. CGI gets NO `PATH` variable at all** — not a minimal one, literally absent (`env | grep -c '^PATH='` = 0). `cgi_base.sh`'s `export PATH="/opt/bin:...:/sbin:$PATH"` therefore ends in a **trailing colon**, i.e. an empty element, which POSIX reads as the current directory. CWD for a CGI is its own script directory (`PWD=/usrdata/qmanager/www/cgi-bin/quecmanager`), which is `755 root:root`, so it is not exploitable today — but it is one `chmod` away from being so.

Other measured CGI env facts: runs as `uid=33(www-data) gid=20(dialout)`; `REMOTE_ADDR` is the real client IP (loopback call -> `127.0.0.1`, LAN call -> the client's LAN address), so per-IP gating is feasible; over TLS `HTTPS=on`, `REQUEST_SCHEME=https`, `SERVER_PORT=443`, plus `SSL_CIPHER` / `SSL_PROTOCOL`; there is no `mod_extforward`, so no `X-Forwarded-For` handling exists.
