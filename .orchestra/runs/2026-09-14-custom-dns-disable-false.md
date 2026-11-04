---
run: custom-dns-disable-false
date: 2026-09-14
lane: Lite
status: complete
base: 7497ffd4
---

# Custom DNS — "enabled must be true or false" on disable

## Request
User-reported: *Use my own resolvers* cannot be switched off; **Save and apply** returns
`enabled must be true or false`. User proposed a `has()`-based jq fix. Validate before patching.
Ship under v0.1.16.

## Recon / diagnosis
`scripts/www/cgi-bin/quecmanager/network/custom_dns.sh:320` read the flag as
`jq -r '.enabled // empty'`. jq's `//` treats `false` as absent, so a boolean `false` yields the
empty string and fails the `true|false` gate at line 327.

`hooks/use-custom-dns.ts:175` sends `enabled: data.enabled` — a real JSON boolean — so every
disable request hit the trap. `action=clear` was unaffected: it rebuilds POST_DATA with the
*string* `"false"`.

`ignore_carrier // "false"` was **not** a live defect (boolean `false` → `"false"`, boolean
`true` → `"true"`), but sits one edit away from the same trap. Changed for symmetry.

Census of `// empty` / `// false` across `scripts/www/cgi-bin/`: no other live instance.
`alerts.sh` uses `// false` (safe). `video_optimizer.sh:247,292` already carries the fix and the
comment explaining it — that idiom was adopted here verbatim rather than the user's variant.

## Decision on the proposed fix
The user's diagnosis is correct. Their expression is also correct, but the repo already has a
shorter established idiom for exactly this trap, proven on-device in `video_optimizer.sh`:
`jq -r 'if has("enabled") then .enabled else empty end'`. Same behaviour for every input the
endpoint can receive (`jq -r` already prints a boolean as `true`/`false`, so `tostring` is
redundant; `null` and absent both fail the gate with the same message either way). Adopted the
existing idiom for consistency.

## Proof — RM520N-GL, serial 61368cd2, jq 1.7.1, run as www-data
Sandbox harness (`/tmp/dnsprobe.sh`) ran the real CGI against a **copy** of
`/etc/data/dnsmasq.conf`, with a minted session cookie (not `_SKIP_AUTH=1`).

```
whoami: www-data  jq: jq-1.7.1
OLD (HEAD):
  toggle OFF     {"ok":false,"error":"enabled must be true or false","field":"enabled"}
NEW (patched):
  toggle OFF     -> past validation, dnsMode gate and `dnsmasq --test`
  toggle ON      -> past validation, dnsMode gate and `dnsmasq --test`
  enabled absent {"ok":false,"error":"enabled must be true or false","field":"enabled"}
  action=clear   -> past validation, dnsMode gate and `dnsmasq --test`
live conf before: 58054b8303f7dc8c6a1c3bf6e39070ea
live conf after : 58054b8303f7dc8c6a1c3bf6e39070ea
```

The patched runs stop at `sudo /bin/mv` with `failed to install config (mv failed)` — a sandbox
artefact, not a defect: `cgi_base.sh:18` prepends `/opt/bin` to PATH, so the real sudo is used,
and `scripts/etc/sudoers.d/qmanager:152` whitelists only the exact live paths. Everything
upstream of the privileged apply — the only code this diff touches — is proven.

**Not done:** a live end-to-end click. It would rewrite `/etc/data/dnsmasq.conf` byte-identically
(the device currently has no sentinel block) and SIGHUP dnsmasq. Left to the user.

## Device state
Three-way md5 clean at open **and** at close: deployed == `git show HEAD:<path>` == working copy
before the edit (`8244bb10db3e6421d0afc8f634463bb1`). Nothing was deployed to the live docroot.
`/tmp/dnsprobe*`, `/tmp/custom_dns.OLD.sh`, `/tmp/custom_dns.NEW.sh` removed.

## Also fixed
Header comment at line 25 named a staging path (`/etc/data/dnsmasq.conf.qmanager.new`) that
neither the `STAGING_FILE` constant nor sudoers uses. Corrected to
`/etc/data/qmanager/dnsmasq.conf.new`.

## Handoff — NEXT ACTION
None. Committed; `RELEASE_NOTES.md` carries the v0.1.16 Fixes bullet. If the user wants hardware
confirmation, deploy and click the toggle.
