---
name: stale-env-ssh-password
description: .env MODEM_SSH_PASSWORD may be rejected by the live modem (dropbear "Permission denied (password)") even though device is reachable — device password likely rotated via the password-reset feature
type: reference
---

On 2026-07-24 the live modem at gateway `192.168.225.1:22` (dropbear, host key ed25519 `SHA256:qCyebdQltdK0uRpdJZS9tfdzKc13FcC6zaUNWTqwdz8`) rejected the `.env` `MODEM_SSH_PASSWORD` with `Renci.SshNet.Common.SshAuthenticationException: Permission denied (password)`.

Transport was fine — TCP/22 open, ping OK, KEX (curve25519-sha256) + cipher (chacha20-poly1305) negotiated, server offered `publickey,password`. The `.env` value parsed cleanly (correct length, all printable ASCII, no CR/hidden chars, no quote/Trim mangling). So it is a genuine **auth rejection**, not a transport or parser bug.

**Why:** QManager recently gained a **password-reset feature** (git commit 5f57450 "Added documentation for password reset"). When the device's root/SSH password is changed through that flow, `.env` (gitignored, local-only) is NOT auto-updated and goes stale.

**How to apply:** If Posh-SSH / native ssh returns `Permission denied (password)` while the device is otherwise reachable, do NOT keep retrying or assume the parser is wrong — verify parse once (char codes), then **stop and ask the user to refresh `MODEM_SSH_PASSWORD` in `.env`**. Never echo the value. Confirm the parse quickly by comparing `.Length` and `[int[]][char[]]` codes against the file, then treat a clean-parse rejection as a stale-credential blocker.

Reminder: the PS tool shell does NOT auto-load `.env` — parse it manually each session (see [[posh-ssh-connection-recipe]]).
