# Custom DNS

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

> Custom DNS lets the user override which upstream resolver the modem's `dnsmasq` proxy forwards LAN client queries to. The feature edits a sentinel-delimited block at the end of `/etc/data/dnsmasq.conf`, validates the result with `dnsmasq --test`, atomically swaps the file into place, restores its `radio:radio` ownership, and reloads `dnsmasq` via `SIGHUP`. No reboot, no DHCP-lease churn, no live restart of the daemon.

The feature ships on the `dev-rm520` mainline. Earlier `CLAUDE.md` listed Custom DNS in `Removed/Deferred Features` because the legacy RM551E/OpenWRT port wrote `uci set network.lan.dns=...`, which has no analog on the RM520N-GL. The underlying daemon (`dnsmasq`) is the same package; only the configuration mechanism (UCI vs. plain file edits) changed. See the "Why The Original Verdict Was Wrong" section at the bottom.

---

## Quick Reference

| Item | Value |
|------|-------|
| CGI endpoint | `scripts/www/cgi-bin/quecmanager/network/custom_dns.sh` |
| HTTP methods | `GET` (read state), `POST` (`action=save`, `action=clear`) |
| Install path on device | `/www/cgi-bin/quecmanager/network/custom_dns.sh` |
| Config injection target | `/etc/data/dnsmasq.conf` (persistent UBIFS, owner `radio:radio`) |
| Staging file | `/etc/data/qmanager/dnsmasq.conf.new` (in a www-data-owned subdir, same UBI volume as dest) |
| Staging dir | `/etc/data/qmanager/` (mode `0700`, owner `www-data:www-data`, created by installer) |
| Sentinel | `# QMANAGER-CUSTOM-DNS-BEGIN v1` ... `# QMANAGER-CUSTOM-DNS-END v1` |
| Reload | `killall -HUP dnsmasq` (no process restart) |
| Mode gate (XML) | `<DNSMode>` in `/etc/data/mobileap_cfg.xml` must equal `PROXY` |
| Frontend types | `types/custom-dns.ts` |
| Frontend hook | `hooks/use-custom-dns.ts` |
| Frontend route | `app/local-network/custom-dns/page.tsx` (thin re-export) |
| Frontend components | `components/local-network/custom-dns/` — `shapes.ts`, `dns-strip.tsx`, `custom-dns-card.tsx`, `custom-dns.tsx` (shell) |
| i18n root | `customDns.*` (56 leaves × 5 locales) |
| Harness | `scripts/test/local-network-settings-design-language.sh` |
| Sidebar entry | `components/app-sidebar.tsx` (under Local Network) |
| Sudoers fragment | `scripts/etc/sudoers.d/qmanager` (last block, three rules) |
| Max servers | 4 |
| IP support | IPv4 and IPv6 (dnsmasq 2.91 compiled with IPv6) |

---

## Shipped Implementation

### GET response

`GET /cgi-bin/quecmanager/network/custom_dns.sh` returns the full current state in one round trip. The shape mirrors `CustomDnsSettingsResponse` in `types/custom-dns.ts`:

```json
{
  "enabled": true,
  "ignoreCarrier": true,
  "servers": ["1.1.1.1", "1.0.0.1"],
  "dnsMode": "PROXY",
  "available": true,
  "currentUpstream": ["1.1.1.1", "1.0.0.1"],
  "currentSource": "custom",
  "passthroughBypass": false,
  "blockCorrupt": false
}
```

Field semantics:

| Field | Meaning |
|-------|---------|
| `enabled` | True when the sentinel block is present in `dnsmasq.conf` |
| `ignoreCarrier` | True when `no-resolv` is inside the block (dnsmasq ignores `/etc/resolv.conf`) |
| `servers` | User-configured upstreams, parsed from `server=` lines inside the block |
| `dnsMode` | Value of `<DNSMode>` in `mobileap_cfg.xml` (typically `PROXY`) |
| `available` | True when `dnsMode == "PROXY"`; gates all writes |
| `currentUpstream` | The upstreams dnsmasq is forwarding to — from our block when `enabled`, otherwise from `/run/resolv.conf`. **Echoed config, not a measurement, in the `enabled` case** — see below |
| `currentSource` | `"custom"`, `"carrier"`, or `"unknown"` — explains where `currentUpstream` came from |
| `passthroughBypass` | A **stub**. `get_passthrough_bypass` (`:70-75`) returns the literal `"false"` with a TODO. Banned from rendering — see gotchas |
| `blockCorrupt` | True when only one of the two sentinel lines is present. Rendered as a **non-blocking** warning; it also false-positives — see gotchas |

> ⚠️ **`currentUpstream` is echoed configuration, not a probe, whenever `enabled` is true.** `custom_dns.sh:202-205` takes the branch `current_upstream_json="$servers_json"` — i.e. it reports the servers *written into the block*, never what dnsmasq is actually resolving against. If `killall -HUP dnsmasq` failed on the last save, the file on disk and the running daemon disagree and the GET still reports the configured servers. The carrier branch is a real read (`/run/resolv.conf`), so the two halves of this one field have different provenance.

When `/etc/data/dnsmasq.conf` does not exist at all, `build_get_payload` (`:223-227`) short-circuits to a minimal object with `enabled:false`, `available:false`, and an ad-hoc `error:"dnsmasq config file not found"`.

> ℹ️ NOTE: that `error` key is **not** declared on `CustomDnsSettingsResponse` in `types/custom-dns.ts`. It crosses the wire and no typed consumer can see it. The frontend instead treats "settings never arrived" as the read-failure state, which is reachable for every cause and not just this one.

### POST request

Two actions are supported.

`action=save` writes the sentinel block:

```json
{
  "action": "save",
  "enabled": true,
  "ignore_carrier": true,
  "servers": "1.1.1.1,1.0.0.1"
}
```

`servers` is a comma-separated string. The hook (`hooks/use-custom-dns.ts`) joins the array before sending. The CGI splits on commas, trims each entry, validates IPv4/IPv6 syntax, and rejects past `MAX_SERVERS=4`.

`action=clear` removes the block entirely. The CGI internally rewrites this as `save` with `enabled=false`, falling back to carrier DNS:

```json
{ "action": "clear" }
```

> ⚠️ **`action=clear` is destructive on a corrupt block, and it has no UI call site for that reason.** See "`clearSettings` must never be wired" under Gotchas — this is the single most important fact in this file.

Successful POST returns `{ ok: true, applied: <full GET payload> }` so the frontend avoids a follow-up refetch. Failed POST returns `{ ok: false, error: "...", field?: "..." }`.

### `field` is a group name, never a row index

Twelve failure paths return `ok:false`. **Six carry a `field`, and it is only ever one of three values:**

| `field` | Sites |
| ------- | ----- |
| `"enabled"` | `:301` |
| `"ignore_carrier"` | `:310` |
| `"servers"` | `:332`, `:353`, `:361`, `:372` |

The other six (`:319` unavailable, `:379` conf missing, `:400` staging write, `:410` `dnsmasq --test` rejected, `:419` `mv` failed, `:429` HUP failed) carry **no `field` at all**.

Consequence for the UI: even when `dnsmasq` names the offending address in its prose message (`"invalid IP address: 1.1.1.999"`), there is no machine-readable row index. Targeting the individual input would mean string-parsing the message. The frontend therefore renders the message **keyed to the resolver group**, not to a row — accurate about what the backend actually told it.

### Sentinel block format

Written verbatim by the CGI when `enabled=true`:

```ini
# QMANAGER-CUSTOM-DNS-BEGIN v1
no-resolv
server=1.1.1.1
server=1.0.0.1
# QMANAGER-CUSTOM-DNS-END v1
```

`no-resolv` is emitted only when `ignore_carrier=true`. Without it, dnsmasq merges our `server=` lines with whatever it reads from `/etc/resolv.conf` (carrier-assigned).

The `v1` version tag on each sentinel lets a future schema co-exist with an old block during upgrade.

### Apply pipeline

```
strip existing sentinel block from /etc/data/dnsmasq.conf
append new block (if enabled=true)
write candidate to /etc/data/qmanager/dnsmasq.conf.new          (www-data-writable; same UBI volume as dest)
dnsmasq --test --conf-file=/etc/data/qmanager/dnsmasq.conf.new
sudo /bin/mv /etc/data/qmanager/dnsmasq.conf.new /etc/data/dnsmasq.conf   (atomic rename within /dev/ubi2_0)
sudo /bin/chown radio:radio /etc/data/dnsmasq.conf
sudo /usr/bin/killall -HUP dnsmasq
```

The staging file lives inside `/etc/data/qmanager/`, a `www-data`-owned directory mode `0700` created by `install_rm520n.sh`. This is required because `/etc/data/` itself is owned by `radio:radio` mode `0755`, so `www-data` cannot create new files there. The staging dir must be on the same UBI volume (`/dev/ubi2_0`) as the destination so `mv` is a real atomic `rename(2)`, not a cross-filesystem copy+unlink that could leave a torn `dnsmasq.conf` if interrupted.

If `dnsmasq --test` rejects the candidate, the staging file is removed and the live config is untouched. If `mv` succeeds but `chown` fails, the save is allowed to proceed (logged as a warning) — the file still works, but QCMAP's future `sed -i` rewrites of `dhcp-option-force` lines may break if it cannot write the file. If `killall -HUP` fails, the new config is on disk but not live; the response reports this so the user can reboot to apply.

### Sudoers fragment

The CGI runs as `www-data`. Three NOPASSWD entries gate the apply pipeline (`scripts/etc/sudoers.d/qmanager`):

```
www-data ALL=(root) NOPASSWD: /bin/mv /etc/data/qmanager/dnsmasq.conf.new /etc/data/dnsmasq.conf
www-data ALL=(root) NOPASSWD: /bin/chown radio\:radio /etc/data/dnsmasq.conf
www-data ALL=(root) NOPASSWD: /usr/bin/killall -HUP dnsmasq
```

The `chown` rule has its colon backslash-escaped (`radio\:radio`). See "Sudoers colon-escape gotcha" below.

### Frontend (re-authored 2026-08-31)

| Layer | Path |
|-------|------|
| Route | `app/local-network/custom-dns/page.tsx` — thin re-export, no markup |
| Shell | `components/local-network/custom-dns/custom-dns.tsx` |
| Band A | `components/local-network/custom-dns/dns-strip.tsx` |
| Band B | `components/local-network/custom-dns/custom-dns-card.tsx` |
| Geometry | `components/local-network/custom-dns/shapes.ts` |
| Hook | `hooks/use-custom-dns.ts` |
| Types | `types/custom-dns.ts` |

The composition is now **page header + Refresh pill → Band A (live read-only tiles) → Band B (the write card)** — the grammar `/local-network/ethernet` landed on (`2511953`) and `/local-network/traffic-engine` adopted (`0fdfc65`). The route is **lucide**, per the Icon-Boundary Rule.

Before this pass the page opened with the enable switch and buried the live upstream in a `MetaPanel` *below* it. On a product that runs on the modem it is reconfiguring, "which resolver am I actually using right now" is the first question, not the fourth.

> ⚠️ **`shapes.ts` is this family's own module. Restate geometry in it; never import a shape from `components/cellular/` or from a sibling `/local-network/` family.**

**The shell is new, and it had to be.** There was no client shell before — the page header lived in the *server* `page.tsx`, and a server component cannot own a motion cascade, which is why the header snapped in while the rest of `/local-network/` faded. `custom-dns.tsx` is now the cascade root (`staggerContainer` + `initial`/`animate` declared **once**; children are `staggerItem` and must not declare their own, or they detach from the parent clock and render at `hidden` forever).

#### The page's one derived state

The shell computes a single `DnsState` and hands it down resolved. Every child reads it; **no component re-derives it from a payload's shape.**

| State | When | Band chip |
| ----- | ---- | --------- |
| `unavailable` | `available === false` (`<DNSMode>` is not `PROXY`) | `muted` |
| `corrupt` | `blockCorrupt === true` | `warning` |
| `custom` | `currentSource === "custom"` | `success` |
| `carrier` | otherwise | `info` |

Order matters: `unavailable` outranks `corrupt`, because on a device where dnsmasq is bypassed entirely the state of our sentinel block is not the user's problem. Each of the four chips carries its own glyph — `success-container` and `warning-container` measure **1.03:1** apart and are identical under deuteranopia, so the glyph is the channel that actually carries the state.

#### Band A — four tiles

| Tile | Value | Caption |
| ---- | ----- | ------- |
| Upstream 1 | the address in `font-mono`, or `—` | the recognised provider name where known, else "from the attach" / "yours" / an absence reason |
| Upstream 2 | same | same |
| Source | Custom / Carrier / Unknown | names the current `<DNSMode>` |
| Carrier fallback | On / Off | the **inverse** of `ignoreCarrier`, named once in the shell so the double negative never reaches the JSX |

Tile bodies are neutral; colour lives on the 52 px disc. In the `corrupt` state both upstream tiles take a `destructive` disc and a `TriangleAlertIcon`, and their caption switches to "untrusted" — because with a malformed block the parsed `servers` array is not trustworthy as a statement about the file. In the `unavailable` state the grid is replaced by one spanning `NoticeTile` whose copy states the configuration fact rather than apologising for a failure: it is a *designed* outcome on such a device, not a fault, and there is no in-app remedy (see below).

A read that failed and left nothing behind gets its own spanning `NoticeTile`. The write card is **not rendered at all** in that case — a form pre-filled with defaults, sitting under a band that just said it could not read the device, is the interface inventing state. The header's Refresh pill is the way back.

#### Band B — the write card

One peer card holding the enable row, the repeatable resolver list (max 4, IPv4/IPv6 paste handling), and the "ignore carrier DNS" row (`no-resolv`). Every row carries a required consequence sentence that changes with the row's condition.

The card **mounts on the payload** rather than receiving a nullable one, which is what lets it seed every field from the device exactly once, at mount, instead of synchronising from an effect on every poll. The skeleton is the same card with the same rows, so the handoff moves nothing. Draft state is `Partial<Draft>` edits over a memoised baseline — see the same section in [`ttl-mtu.md`](./ttl-mtu.md) for why an effect sync is both a lint error here and a silent data-loss bug.

`formDisabled` is `isSaving || !available` — **and deliberately not `blockCorrupt`**. See below.

#### `refresh` takes an argument, and the type now says so

`useCustomDns`'s `refresh` is `fetchSettings`, implemented as `useCallback(async (silent = false) => …)` but formerly typed `() => void`. That let `onClick={refresh}` compile, handing React's `MouseEvent` to `silent` as a truthy value — so a user-initiated refresh ran with its own loading state suppressed and the button looked inert for the whole request. The signature is now `(silent?: boolean) => Promise<void>`, making the bare form a compile error; `onClick={() => refresh()}` is the only spelling that builds. The harness bans the bare form too.

---

## Architecture Found On The Device

### dnsmasq is alive and authoritative for LAN DNS/DHCP

```
tcp 192.168.225.1:53            LISTEN 31285/dnsmasq
udp 192.168.225.1:53                   31285/dnsmasq
udp 0.0.0.0:67                         31285/dnsmasq
```

Build: `Dnsmasq version 2.91 ... IPv6 GNU-getopt no-RTC no-DBus no-UBus no-i18n no-IDN DHCP DHCPv6 no-Lua TFTP no-conntrack ipset no-nftset auth no-DNSSEC loop-detect inotify dumpfile`.

Process invocation:

```
/usr/bin/dnsmasq --conf-file=/var/run/data/dnsmasq.conf.bridge0 --user=radio --group=radio
```

PPid = 1 (init/systemd). The standalone `dnsmasq.service` unit is `disabled / dead` and uses a different invocation; it is **not** the unit responsible. The real launcher is `QCMAP_ConnectionManager`, which spawns dnsmasq via the systemd template `dnsmasq_service@.service`:

```ini
ExecStart=/usr/bin/dnsmasq --conf-file=/var/run/data/dnsmasq.conf.bridge%i --user=radio --group=radio
ExecReload=killall -HUP dnsmasq
```

### Config layering (the key insight)

```
/var/run/data/dnsmasq.conf.bridge0     <-- runtime, regenerated by QCMAP at boot
        |
        +-- conf-file=/etc/data/dnsmasq.conf      <-- persistent, our injection target
        +-- dhcp-leasefile=/var/run/data/dnsmasq.leases
        +-- addn-hosts=/etc/data/hosts
        +-- pid-file=/var/run/data/dnsmasq.pid
        +-- interface=bridge0
        +-- dhcp-script=/bin/dnsmasq_script.sh
        +-- dhcp-range=bridge0,192.168.225.20,192.168.225.170,255.255.252.0,43200
        +-- dhcp-option-force=6,192.168.225.1     <-- LAN clients are told "modem is your DNS"
        +-- dhcp-option-force=26,1500             <-- MTU
        +-- dhcp-option-force=120,abcd.com        <-- SIP server (Quectel default)
```

QCMAP rewrites *only* the `bridge0` runtime file at boot, plus known specific fields of `/etc/data/dnsmasq.conf` (`dhcp-option-force=6`, `26`, `120`) via targeted `sed` patterns. It does not rewrite arbitrary appended content. The `conf-file=` include means anything we add to `/etc/data/dnsmasq.conf` is parsed by every (re)start.

### Filesystem persistence

```
/dev/ubi2_0 on /etc      type ubifs (rw,...)
/dev/ubi2_0 on /usrdata  type ubifs (rw,...)
```

Same UBIFS volume — `/etc/data/dnsmasq.conf` is as persistent as anything under `/usrdata/qmanager/`. A shadow copy exists at `/usrdata/etc/data/dnsmasq.conf` (factory backup); the running process does not read it.

### Upstream DNS path (modem's own resolver)

```
/etc/resolv.conf  ->  /run/resolv.conf   (tmpfs, ephemeral, rewritten at WAN bringup)
```

Writer: `QCMAP_ConnectionManager`. Implication: we cannot persistently override `/etc/resolv.conf` (QCMAP overwrites it on the next WAN bringup), but we do not need to — we override dnsmasq's upstream via `server=` + optional `no-resolv` instead, which is more correct anyway.

### mobileap_cfg.xml is not a DNS-upstream knob

```xml
<DNSMode>PROXY</DNSMode>
<APDNSProfile>1</APDNSProfile>
<EnableDhcpv4Dns>1</EnableDhcpv4Dns>
```

No `<CustomDNSServer>` field exists in the schema (`/etc/data/mobileap_cfg.xsd`). Editing `dnsmasq.conf` is the correct surface. `<DNSMode>` is read at GET time to gate availability: when it is anything other than `PROXY`, the dnsmasq proxy is bypassed and our edits would have no effect on LAN clients.

> ⚠️ **`<DNSMode>` is READ-ONLY to QManager, and this is load-bearing for the UI.** It is a *gate*, not a setting we own. `custom_dns.sh:58` (`xmlstarlet sel`) and `:60` (a `grep` fallback) are the only two accesses in the tree, and both are reads. Nothing anywhere writes the field. That is why the `unavailable` state offers no remedy and why the page may not link elsewhere to "change DNS mode" — see the matching gotcha above, which the harness pins.

---

## Validation Performed

End-to-end validation on the live RM520N-GL (SSH credentials in `.env`):

| Check | Result |
|-------|--------|
| `GET` initial state — block absent | Returned `enabled:false`, `available:true`, `dnsMode:"PROXY"`, `currentSource:"carrier"`, `currentUpstream` populated from `/run/resolv.conf` |
| `POST action=save` with `1.1.1.1, 1.0.0.1` and `ignoreCarrier=true` | Sentinel block written; `dnsmasq --test` passed; `mv`+`chown`+`HUP` all returned 0 |
| Post-save file inspection | `/etc/data/dnsmasq.conf` owned by `radio:radio` (chown restored); mode `0644` (see gotcha); sentinel block present and well-formed |
| dnsmasq PID after HUP | Same PID before and after — `SIGHUP` re-reads config without restart, DHCP leases preserved |
| DNS resolution after save | `nslookup example.com` from a LAN client resolved cleanly via the new upstreams |
| `POST action=clear` | Sentinel block removed; `dnsmasq --test` passed; `HUP` succeeded; GET reported `enabled:false`, `currentSource:"carrier"` |
| Invalid IP rejection | `POST` with `servers:"1.1.1.999"` returned `{ok:false, error:"invalid IP address: 1.1.1.999", field:"servers"}` without touching disk |
| Empty server list when enabled | Returned `{ok:false, error:"at least one server is required when enabled is true", field:"servers"}` |
| Sudoers parse | `visudo -cf /opt/etc/sudoers.d/qmanager` returned `parsed OK` after the colon-escape fix |

---

## Known Gotchas & Lessons Learned

### Staging dir must be writable by www-data, on the same UBI volume as the destination

`/etc/data/` is owned by `radio:radio` mode `0755`, so `www-data` cannot create files there directly. The first release staged at `/etc/data/dnsmasq.conf.qmanager.new` and granted sudo rules for `mv`/`chown`/`HUP` on that path, but never for the *creation* of the staging file itself. Every CGI invocation through lighttpd hit `EACCES` on the shell redirect (`{ ... } > "$STAGING_FILE"`) and returned `failed to write staging config file`.

The fix introduced a dedicated staging directory `/etc/data/qmanager/` owned by `www-data:www-data` mode `0700`, created idempotently in `install_backend()` via:

```sh
install -d -o www-data -g www-data -m 0700 /etc/data/qmanager
```

This keeps the staging file on the same UBI volume (`/dev/ubi2_0`) as `/etc/data/dnsmasq.conf`, preserving the atomic-rename guarantee that `sudo mv` depends on. Cross-filesystem staging (e.g. `/tmp` tmpfs) would silently downgrade `mv` to copy+unlink and break the atomicity invariant.

### Always validate CGI under the actual www-data privilege context

The above EACCES bug shipped because Phase 5 validation was run as `root` over SSH (`_SKIP_AUTH=1 ... custom_dns.sh`), which created the staging file as root and bypassed the permission gap. `www-data` permission issues on file creation are invisible from a root shell.

Correct validation paths (any of these reproduce the real privilege context):

```sh
# A. Direct invocation under www-data's identity
sudo -u www-data env _SKIP_AUTH=1 REQUEST_METHOD=POST CONTENT_LENGTH=$(...) \
    /usrdata/qmanager/www/cgi-bin/quecmanager/network/custom_dns.sh < payload.json

# B. Real HTTP through lighttpd (requires an authenticated session cookie)
curl -sk -X POST -b /tmp/qmanager.cookie \
    https://192.168.225.1/cgi-bin/quecmanager/network/custom_dns.sh \
    --data-binary @payload.json
```

Path A is fastest for shell-loop debugging and exercises the exact uid/gid/groups that lighttpd's CGI workers run under. Path B additionally exercises lighttpd's environment-stripping and request parsing. For any new CGI endpoint, Phase 5 must include at least Path A — root-shell validation alone is not validation.

### Sudoers colon-escape gotcha

The `chown` rule must be written as:

```
www-data ALL=(root) NOPASSWD: /bin/chown radio\:radio /etc/data/dnsmasq.conf
```

The `:` in the argument `radio:radio` has to be backslash-escaped because sudoers' grammar treats an unescaped `:` as the `user:group` separator inside any token in a rule's command. Writing the literal `radio:radio` makes sudoers parse it as a runas spec, which produces a fatal `sudo: parse error in /opt/etc/sudoers.d/qmanager` at the next sudo invocation — and because sudoers loads alphabetically, this single broken file disables sudo for every other rule in the directory.

This bit us during first install validation. The Phase 1 `installer-safety-auditor` audit approved the unescaped form because the audit does not run `visudo -cf` against the proposed line. Lesson for future installer-touching changes: the audit catches policy errors, but only `visudo -cf` catches grammar errors. The fix is committed.

### File mode is 0644 after save (was 0664 baseline)

The post-save file is mode `0644`, not the original `0664`. Reason: the CGI's umask (`0022`) drops the group-writable bit when it writes the staging file, and `sudo mv` then `sudo chown` does not restore it. This is benign because QCMAP is the owner (`radio:radio`), so its `sed -i` rewrites of `dhcp-option-force` lines still succeed via owner-write rather than group-write. Worth noting in case a future change shifts ownership away from `radio` — at that point the group-writable bit would matter.

### `blockCorrupt` is a NON-BLOCKING warning, and `clearSettings` must never be wired

**This is the most important rule in this file.** `hooks/use-custom-dns.ts` exports `clearSettings`, it works, and a tree-wide grep returns the hook and nothing else. That is deliberate. Do not give it a call site.

The obvious feature — a "Repair / Rebuild the block" button offered exactly when `blockCorrupt` is true — **destroys the configuration it would promise not to touch.** The chain:

1. `custom_dns.sh:280-284` maps `action=clear` onto save-with-`enabled=false`.
2. That path runs `strip_sentinel_block` (`:139-151`), which sets `in_block=1` on the BEGIN marker and clears it **only** on END.
3. `blockCorrupt` is *defined* as one sentinel present without the other (`:132-133`).

So in the one state where the button would be offered — BEGIN present, END missing — `in_block` never returns to 0 and **every remaining line of `/etc/data/dnsmasq.conf` is dropped**: `listen-address`, `dhcp-authoritative`, `conf-dir`.

Nothing downstream catches it. `dnsmasq --test` (`:405`) passes, because the truncated file is syntactically *valid* and merely missing directives. Then `sudo /bin/mv` (`:417`) installs it and `sudo killall -HUP dnsmasq` (`:427`) makes it live — on a device the operator is reaching over that same LAN.

**And `blockCorrupt` false-positives.** `parse_sentinel_block` (`:116-134`) reads with `while IFS= read -r line`, whose body never runs for a final line with no trailing newline. A perfectly healthy file that ends at the END marker therefore returns 2. That is not a hypothetical: `custom_dns.sh:423` chowns the file back to `radio:radio` precisely so QCMAP can keep rewriting it with its own `sed -i`, and a rewriter is exactly the sort of thing that leaves a file without a final newline.

Both facts point the same way, and the shipped design is the intersection of them:

- The corruption notice is a page-level **lucide `Banner`** (`role="degraded"`) in the shell. It informs; it does not block.
- `formDisabled` is `isSaving || !available` — **`blockCorrupt` is not in it**, so a false positive cannot lock anyone out of their own DNS settings.
- No in-app repair is offered. The remedy is to edit `/etc/data/dnsmasq.conf` by hand, or to save a normal configuration, which rewrites the block.
- The harness fails on any `clearSettings` call site under `components/local-network/custom-dns/`.

> ℹ️ NOTE: if a future backend gains a marker-repair verb that is safe by construction — one that parses the file structurally rather than by a one-way in-block flag — **that** verb is what a repair button calls. Not this one.

### `passthroughBypass` is a stub, and rendering it drew a constant

`get_passthrough_bypass` (`custom_dns.sh:70-75`) is:

```sh
get_passthrough_bypass() {
    # TODO: full passthrough-bypass detection needs robust XML parsing of
    # MPDN_rule fields; returning false is the safe default …
    printf "false"
}
```

A robust extraction of the IP Passthrough + per-MPDN-rule DNS state from `mobileap_cfg.xml` was deferred and never done. The field stays on the type for forward compatibility; treat `false` as "no interop concern **detected**", never as "passthrough is definitely off".

**It is banned from rendering**, and the ban immediately paid for itself: `custom-dns-card.tsx:403` already rendered `{passthroughBypass && …}`, so the shipped "IP Passthrough is bypassing dnsmasq" notice was unreachable dead code that had **never once displayed** on any device.

See the open question under [`ip-passthrough.md`](./ip-passthrough.md) for what would actually have to be measured to make this field real.

### Nothing in QManager writes `<DNSMode>` — and the page must not imply otherwise

Reinforcing the read-time gate documented under "mobileap_cfg.xml is not a DNS-upstream knob" below.

A tree-wide grep finds exactly **one** file mentioning `mobileap_cfg` — `custom_dns.sh` — and it only ever **reads** (`:58` `xmlstarlet sel`, `:60` a `grep` fallback). There is no writer anywhere in the codebase.

The approved design proposed a "switch DNS mode on the IP Passthrough page" button for the `unavailable` state. That page has no such control, so the button would have sent the user somewhere with nothing to do. **The link is banned by the harness** (`grep '/local-network/ip-passthrough'` against the Custom DNS sources), and the `unavailable` notice states the configuration fact and offers no in-app remedy, because there is none.

### PID file path divergence

The running dnsmasq writes its PID to `/var/run/data/dnsmasq.pid`, **not** the `/run/dnsmasq.pid` referenced by the disabled `dnsmasq.service` unit. The CGI uses `killall -HUP dnsmasq` (matching `dnsmasq_service@.service`'s `ExecReload`) rather than `kill -HUP $(cat /run/dnsmasq.pid)` for exactly this reason. Do not refactor toward the PID-file form.

---

## Why The Original Verdict Was Wrong

`CLAUDE.md` previously listed Custom DNS under `Removed/Deferred Features` with the reason *"UCI network dependency, no equivalent on RM520N-GL"*. That reasoning conflated *implementation mechanism* with *daemon presence*. The RM551E/OpenWRT port wrote `uci set network.lan.dns=...` and committed the UCI tree, which truly has no analog here — but the underlying DNS server (`dnsmasq`) is the **same package**, configured by file edits instead of UCI calls. The persistent partition layout (`/etc` on UBIFS) makes the file-edit approach as durable as the UCI approach was on OpenWRT.

Direct on-device probing (see "Architecture Found On The Device") established viability before any code was written; the implementation that shipped follows the layering this probing revealed.

---

## Related

- [`ttl-mtu.md`](./ttl-mtu.md), [`ip-passthrough.md`](./ip-passthrough.md) — the two sibling surfaces re-authored in the same 2026-08-31 pass, on the same page grammar
- [`ethernet.md`](./ethernet.md) — the reference implementation for that grammar
- [`dpi.md`](./dpi.md) — the other `/local-network/` family with its own `shapes.ts`
- [`icon-system.md`](./icon-system.md) — why this route is lucide and `TonalBanner` (Material) is unusable here
