# Custom DNS

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** verified 2026-09-04 — full save + clear cycle on hardware, see
> [Validation Performed](#validation-performed) and [`platform-matrix.md`](./platform-matrix.md)

> Custom DNS lets the user override which upstream resolver the modem's `dnsmasq` proxy forwards LAN client queries to. The CGI stages a candidate with a sentinel-delimited block and pre-checks it with `dnsmasq --test`; the root helper `qmanager_dns_apply` then takes only that block, rebuilds `/etc/data/dnsmasq.conf` from the live file, re-runs `dnsmasq --test`, swaps it in atomically as `radio:radio 0644`, and reloads `dnsmasq` via `SIGHUP`. No reboot, no DHCP-lease churn, no live restart of the daemon.

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
| Apply helper | `/usr/bin/qmanager_dns_apply apply` (root, via `sudo -n`; source `scripts/usr/bin/qmanager_dns_apply`) |
| Reload | `killall -HUP dnsmasq`, run by the helper (no process restart) |
| Mode gate (XML) | `<DNSMode>` in `/etc/data/mobileap_cfg.xml` must read `PROXY` — **or be absent from the file entirely**, which is the SDX55 case. See [the tri-state](#dnsmode-is-a-tri-state--and-absent-means-available) |
| Frontend types | `types/custom-dns.ts` |
| Frontend hook | `hooks/use-custom-dns.ts` |
| Frontend route | `app/local-network/custom-dns/page.tsx` (thin re-export) |
| Frontend components | `components/local-network/custom-dns/` — `custom-dns.tsx` (shell), `resolver-card.tsx`, `servers-card.tsx`, `draft.ts`, `dns-providers.ts`, `shapes.ts` |
| i18n root | `local-network:dns.*` (46 leaves in `public/locales/<lang>/local-network.json`) |
| Sidebar entry | `components/app-sidebar.tsx` (under Local Network) |
| Sudoers fragment | `scripts/etc/sudoers.d/qmanager` (last block, one rule: `/usr/bin/qmanager_dns_apply`) |
| Max servers | 4 |
| IP support | IPv4 and IPv6 on both devices — measured, not assumed: `dnsmasq --version` prints `IPv6` in the compile-flag line on the RM520N-GL (2.91) and on the RG501Q-EU (2.79, whose full flag line reads `IPv6 GNU-getopt no-DBus no-i18n no-IDN DHCP DHCPv6 no-Lua TFTP no-conntrack ipset auth no-DNSSEC loop-detect inotify`) |

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
| `dnsMode` | **Tri-state**, not a plain value read: the `<DNSMode>` text verbatim (`PROXY` on SDX65), `ABSENT` when the element is not in the file at all (SDX55), `UNKNOWN` when it cannot be read. See below |
| `available` | True for `PROXY` **and** for `ABSENT`, false for everything else; gates all writes. `dns_mode_available` (`custom_dns.sh:82-87`) is the single place that comparison happens — the GET builder (`:220`) and the POST gate (`:346`) both call it |
| `currentUpstream` | The upstreams dnsmasq is forwarding to — from our block when `enabled`, otherwise from the first of `/run/resolv.conf`, `/etc/resolv.conf` that carries a `nameserver` line. **Echoed config, not a measurement, in the `enabled` case** — see below |
| `currentSource` | `"custom"`, `"carrier"`, or `"unknown"` — explains where `currentUpstream` came from |
| `passthroughBypass` | A **stub**. `get_passthrough_bypass` (`:93-98`) returns the literal `"false"` with a TODO. Banned from rendering — see gotchas |
| `blockCorrupt` | True when only one of the two sentinel lines is present. Rendered as a **non-blocking** warning; it also false-positives — see gotchas |

> ⚠️ **`currentUpstream` is echoed configuration, not a probe, whenever `enabled` is true.** `custom_dns.sh:216-219` takes the branch `current_upstream_json="$servers_json"` — i.e. it reports the servers *written into the block*, never what dnsmasq is actually resolving against. If `killall -HUP dnsmasq` failed on the last save, the file on disk and the running daemon disagree and the GET still reports the configured servers. The carrier branch is a real read (of a `resolv.conf`), so the two halves of this one field have different provenance.

The carrier branch walks `/run/resolv.conf` then `/etc/resolv.conf` and takes the **first candidate that actually yields a `nameserver` line** (`:225-236`); a file that exists but parses to an empty list does not stop the walk. The fallback exists because `/run/resolv.conf` is absent on the SDX55 — see [Upstream DNS path](#upstream-dns-path-modems-own-resolver) below.

When `/etc/data/dnsmasq.conf` does not exist at all, `build_get_payload` (`:243-247`) short-circuits to a minimal object with `enabled:false`, `available:false`, and an ad-hoc `error:"dnsmasq config file not found"`.

> ℹ️ NOTE: that `error` key is **not** declared on `CustomDnsSettingsResponse` in `types/custom-dns.ts`. It crosses the wire and no typed consumer can see it. The frontend instead treats "settings never arrived" as the read-failure state, which is reachable for every cause and not just this one.

### `dnsMode` is a tri-state — and `ABSENT` means available

**Short version: the gate is asking "is dnsmasq the thing LAN clients resolve through on this device?", and there are three honest answers, not two.** The SDX55 firmware has no DNS-mode selector at all — `<DNSMode>` is simply not in its `mobileap_cfg.xml` — so on that device the question does not exist rather than being unanswerable. Reading a missing element as "unknown" is what made the whole feature report `available:false` on the RG501Q-EU.

`get_dns_mode` (`custom_dns.sh:51-78`) resolves to exactly one of:

| `/etc/data/mobileap_cfg.xml` | `dnsMode` | `available` |
|------------------------------|-----------|-------------|
| Missing, or not readable | `UNKNOWN` | **false** — fail closed |
| `<DNSMode>` present with a non-empty value | that value, verbatim | true only when it is `PROXY` |
| `<DNSMode>` present but empty, or self-closing `<DNSMode/>` | `UNKNOWN` | **false** — fail closed |
| Clean no-match on `<DNSMode>` **and** the `<DHCPCfg>` container found | `ABSENT` | **true** |
| Clean no-match on `<DNSMode>` but no `<DHCPCfg>` container | `UNKNOWN` | **false** — fail closed |
| The presence `grep` errored (any status other than 0 or 1) | `UNKNOWN` | **false** — fail closed |

`dns_mode_available` (`:82-87`) is the only place `PROXY`/`ABSENT` is compared, and both callers go through it — the GET payload builder and the POST write gate cannot drift apart.

**The `ABSENT` branch needs two facts, not one.** `ABSENT` opens the write gate, so the code reaches it only when both conditions hold (`:58-69`); anything else falls through to `UNKNOWN`.

1. **The presence `grep` exited exactly `1`.** BusyBox `grep` exits `1` on a clean no-match but `2` on an error, and the old `if ! grep …` form collapsed both into "absent". An error tells us nothing about whether the element is there — it says we failed to look. The status is therefore captured into `rc` immediately after the call and tested numerically, because `!` throws the distinction away.
2. **`<DHCPCfg>` is in the file.** "The element is not here" is only evidence of anything if we can see we are reading a real parsed mobileap config. `<DHCPCfg>` is the container that holds `<DNSMode>` on SDX6X and exists on SDX55 too (where it carries only `StartIP`, `EndIP` and `LeaseTime`) — verified on both live devices. Seeing the container and not the child is what establishes "this firmware ships no DNS-mode selector". Without it, a truncated or half-rewritten file would produce a no-match, open the gate, and have the page accept writes on the strength of a file we could not read. The container `grep` gets the same discipline: only a clean `0` counts as found. (`<DHCPCfg` cannot collide with the closing `</DHCPCfg>` — different byte sequence — so a plain fixed-string match is enough.)

> ⚠️ **Known limitation: both presence and value tests are line-scoped.** A `<DNSMode>` tag split across two lines (`<DNSMode` newline `>PROXY</DNSMode>`) reads as no-match, and with `<DHCPCfg>` present it would resolve to `ABSENT` — silently ignoring a real value. Confirmed latent on BusyBox 1.29.3 (RG501Q-EU) and 1.31.1 (RM520N-GL). It is latent rather than live because neither shipped firmware formats its XML that way, and the value-extraction `grep` at `:74` has been line-scoped in exactly the same way since first ship. Left alone deliberately; if a future firmware ever wraps tags, fix both greps together — do not widen `dns_mode_available`.

**Why absent means available.** On the RG501Q-EU the file has **zero** `DNSMode` hits: its `<DHCPCfg>` carries only `StartIP`, `EndIP` and `LeaseTime`, where the SDX6X file adds `MTU`, `DNSMode`, `IPv4PrimaryAddress` and `IPv4SecondaryAddress`. That firmware ships no way to turn the proxy off, so proxy is its only mode and there is nothing for the gate to guard against. Recorded per-device in [`platform-matrix.md`](./platform-matrix.md).

> ⚠️ **The presence test is a `grep`, deliberately, and the `xmlstarlet` branch below it is decoration.** `command -v xmlstarlet` returns nothing on **both** live devices (see `platform-matrix.md`'s toolchain table), so `:58`'s `grep -qE '<DNSMode([[:space:]]|>|/>)'`, `:63`'s `<DHCPCfg` container check and `:74`'s `grep -oE` fallback are the only lines that have ever executed on hardware. Never move the presence decision into the `xmlstarlet` branch: on these devices it would be a decision made by a command that is not installed.

Frontend consequence: `ABSENT` is `available`, so the page renders it exactly like `PROXY` and never shows the mode name. Only an unavailable read names it, in the Resolver card's condition title (`dns.unavailable_title`, "DNS mode is {{mode}}, not PROXY"). An empty or `UNKNOWN` mode (unreadable file) never interpolates: it gets its own copy, `dns.unavailable_title_unknown` / `dns.unavailable_desc_unknown`.

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

Thirteen failure paths return `ok:false`. **Six carry a `field`, and it is only ever one of three values:**

| `field` | Sites |
| ------- | ----- |
| `"enabled"` | `:332` |
| `"ignore_carrier"` | `:341` |
| `"servers"` | `:363`, `:384`, `:392`, `:403` |

The other seven carry **no `field` at all**: `:350` unavailable, `:410` conf missing, `:431` staging write, `:441` the CGI's own `dnsmasq --test` rejected the candidate, and three from the apply helper's exit code — `:455` reload failed (exit 8), `:460` the helper's `dnsmasq --test` rejected the rebuilt file (exit 5), `:466` any other helper failure (`"failed to install config: <reason>"`).

Consequence for the UI: even when `dnsmasq` names the offending address in its prose message (`"invalid IP address: 1.1.1.999"`), there is no machine-readable row index. Targeting the individual input would mean string-parsing the message. The frontend therefore shows a fixed translated line in the Resolver card's foot status (`dns.save_failed_servers` when `field` is `servers`, else `dns.toast_error_apply`), never the backend text and not on a row, and the failure toast stays one fixed sentence (`dns.toast_error_apply`).

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
# CGI (www-data)
strip existing sentinel block from /etc/data/dnsmasq.conf
append new block (if enabled=true)
write candidate to /etc/data/qmanager/dnsmasq.conf.new          (www-data-writable staging)
dnsmasq --test --conf-file=/etc/data/qmanager/dnsmasq.conf.new  (pre-check, gives the user dnsmasq's own message)
sudo -n /usr/bin/qmanager_dns_apply apply
rm -f /etc/data/qmanager/dnsmasq.conf.new                       (always, whatever the helper returned)

# qmanager_dns_apply (root)
copy the staged file into a private mktemp -d dir (0700), at most 256 KiB
extract ONLY the sentinel block from the copy; ignore every other line
rebuild from root's own /etc/data/dnsmasq.conf, old block stripped, new block appended
dnsmasq --test --conf-file=<rebuilt copy>
mktemp in /etc/data, chown radio:radio, chmod 0644, mv -f over /etc/data/dnsmasq.conf
killall -HUP dnsmasq
```

**The helper trusts nothing in the staged file except the block.** `www-data` owns the staging file, so the old grants (raw `mv` of that file over the live config, plus `chown` and `killall`) let `www-data` decide every byte of a root-installed `dnsmasq` config. The helper closes that: the staged file only supplies a block it re-validates, and the rest of the config always comes from the live file root already trusts.

The block grammar the helper accepts is exactly what the CGI writes:

| Line | Rule |
|------|------|
| `# QMANAGER-CUSTOM-DNS-BEGIN v1` / `# QMANAGER-CUSTOM-DNS-END v1` | At most one pair, in order. BEGIN without END is rejected. No block at all means "remove ours" (the `enabled=false` / `clear` case). |
| `no-resolv` | Optional, at most once |
| `server=<ip>` | 1 to 4 lines when a block is present. IPv4 is four decimal octets 0–255, **no leading zeros** (`inet_aton` reads `010` as octal 8). IPv6 is the hex/colon/dot charset with at least two colons, at most 45 characters; `dnsmasq --test` is the final judge |
| anything else inside the block | Rejected (exit 4) |

Helper exit codes, which `custom_dns.sh` maps onto the response:

| Exit | Meaning | CGI response |
|------|---------|--------------|
| `0` | Installed and reloaded | success payload |
| `1` | Not run as root, or `mktemp` failed | `failed to install config: <reason>` |
| `2` | Usage — the only accepted argv is `apply` | `failed to install config: <reason>` |
| `3` | Staged file unusable: missing, not a regular file, a symlink (file or `/etc/data/qmanager` itself), unreadable, or over 256 KiB | `failed to install config: <reason>` |
| `4` | Block rejected by the grammar above | `failed to install config: <reason>` |
| `5` | `dnsmasq --test` rejected the rebuilt file; live config untouched | `dnsmasq rejected this configuration: <dnsmasq output>` |
| `6` | Building, writing, `chown`/`chmod`, or the final `mv` failed; live config untouched | `failed to install config: <reason>` |
| `7` | `/etc/data/dnsmasq.conf` missing or a symlink | `failed to install config: <reason>` |
| `8` | Config installed but `killall -HUP dnsmasq` failed | `config saved but dnsmasq reload failed; try rebooting` |

The reason on stderr is always fixed helper text (or, for exit 5, `dnsmasq`'s own output) — never bytes from the staged file.

The staging file lives inside `/etc/data/qmanager/`, a `www-data`-owned directory mode `0700` created by `install_rm520n.sh`. This is required because `/etc/data/` itself is owned by `radio:radio` mode `0755`, so `www-data` cannot create new files there. Atomicity no longer depends on the staging location: the helper writes its own temp file with `mktemp` inside `/etc/data/` and renames it over the destination, so the final `mv` is always a same-directory `rename(2)`.

> ⚠️ WARNING: **The helper's old-block strip is deliberately not the CGI's.** `strip_sentinel_block` in the CGI drops everything after a BEGIN that has no END. The helper's strip, after a BEGIN, drops only the lines that fit the block grammar (`no-resolv`, `server=*`) and resumes keeping lines at the first one that does not. A half-written block therefore cannot remove the rest of the live file. Keep the two separate; do not "share" the CGI version with the helper.

> ⚠️ WARNING: **The CGI's `dnsmasq --test` and the helper's are not the same check.** The CGI tests the staged file it built; the helper tests the file it rebuilt from the live config. Both run. If you change how the CGI builds the candidate, the change only matters inside the block — everything outside it is discarded by the helper.

### Sudoers fragment

The CGI runs as `www-data`. One NOPASSWD entry gates the apply pipeline (`scripts/etc/sudoers.d/qmanager`):

```
www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_dns_apply
```

The helper owns every path, the ownership change and the HUP, so no raw `mv`, `chown` or `killall` is granted. The old three-line form and its colon-escape gotcha are described below for history.

### Frontend (rebuilt 2026-11-01)

| Layer | Path |
|-------|------|
| Route | `app/local-network/custom-dns/page.tsx` — thin re-export, no markup |
| Shell | `components/local-network/custom-dns/custom-dns.tsx` — the read, the one draft, validity, the submit handler |
| Resolver card | `components/local-network/custom-dns/resolver-card.tsx` — owns the `<form>` and the page's only `CardFoot` |
| Server cards | `components/local-network/custom-dns/servers-card.tsx` — one instance per family, IPv4 and IPv6 |
| Draft logic | `components/local-network/custom-dns/draft.ts` — `baselineFrom`, `presetFill`, `providerFor`, `serversOf`, `isValidAddress`, `MAX_SERVERS`, `BASE_SLOTS` |
| Presets | `components/local-network/custom-dns/dns-providers.ts` — `DNS_PROVIDERS`, `matchProvider`, `CUSTOM_PROVIDER_ID` |
| Geometry | `components/local-network/custom-dns/shapes.ts` |
| Hook / types | `hooks/use-custom-dns.ts`, `types/custom-dns.ts` |

The page was rebuilt to the RM551E resolver + servers layout: **page header → Resolver card → IPv4 and IPv6 server cards side by side** (`FAMILY_GRID`, two columns from `@5xl/main`). The route is **lucide**, per the Icon-Boundary Rule. Retired in that rebuild: `dns-strip.tsx` (the four-tile live band), `custom-dns-card.tsx` (the single write card with a repeatable list), the `DnsState` chip, and the header Refresh pill.

> ⚠️ **`shapes.ts` is this family's own module. Restate geometry in it; never import a shape from `components/cellular/` or from a sibling `/local-network/` family.**

`custom-dns.tsx` is the motion cascade root (`staggerContainer` + `initial`/`animate` declared **once**; children are `staggerItem` and must not declare their own, or they detach from the parent clock and render at `hidden` forever).

#### Page status

The shell derives one `status` and hands it down: `pending` (no payload yet, loading or not yet failed), `failed` (no payload and a read error), `unavailable` (`available === false` — note `ABSENT` is **not** here), `ready`.

- `failed` and `unavailable` render a condition block inside the Resolver card, with a re-read action, and the two server cards are **not rendered**. A form pre-filled with blanks under "could not read the device" would be the interface inventing state.
- `unavailable` states the configuration fact and offers no in-app remedy, because there is none (see [Nothing in QManager writes `<DNSMode>`](#nothing-in-qmanager-writes-dnsmode--and-the-page-must-not-imply-otherwise)).
- `blockCorrupt` adds a page-level lucide `Banner` (`role="degraded"`) above the Resolver card. It never changes `status`.

#### The Resolver card

Four rows, then the foot:

| Row | Control | Wire field |
|-----|---------|------------|
| Custom DNS | On / Off `SegmentedField` | `enabled` |
| Provider | `Select`: Cloudflare, Google, Quad9, AdGuard, ControlD, Custom | none — fills the address fields |
| Never fall back to carrier DNS | On / Off `SegmentedField` | `ignore_carrier` (`no-resolv`), read directly, not inverted |
| Answering now | read-only list of `currentUpstream`, sub-line from `currentSource` | read only |

Provider and the fallback row are held (dimmed, disabled) while Custom DNS is off.

> ⚠️ **"Answering now" is `currentUpstream`, so it inherits that field's limit.** With custom DNS on, the CGI echoes the configured servers rather than measuring what dnsmasq resolves against (see [GET response](#get-response)). The sub-line says "as applied on the modem", which is as far as the data goes.

The foot is the page's only commit point: status on the left (the translated failure line until the next save, else the reason Apply is blocked), then Discard and `SaveButton` (Apply). The foot sits outside the `<form>` so `mt-auto` reaches the card edge; the Apply button joins the form through `form=`.

#### One draft across three cards

The IPv4 and IPv6 cards have no foot. Their `Input`s carry `form={formId}`, the Resolver card's form id, so Enter in an address field submits the same form and one Apply commits all three cards in one POST.

The shell holds only the user's **edits** over a baseline derived from the read (`baselineFrom`), never an effect-synced copy — see [`ttl-mtu.md`](./ttl-mtu.md) for why an effect sync is both a lint error here and a silent data-loss bug. A successful save stores the applied payload, which re-bases the page, and the edits are cleared.

- **An Off baseline is blank.** With custom DNS off, `currentUpstream` carries the carrier's servers; they never seed the address fields, so the page never presents the carrier's resolvers as a custom choice.
- **Turning On with no address fills the first preset** (Cloudflare).
- **Choosing a preset** fills two IPv4 and two IPv6 addresses. **Editing an address** recomputes the picker with `providerFor`, so it never names a preset the list no longer matches. A non-empty third IPv4 slot or any IPv6 slot past the second always reads Custom.
- **Off sends `servers: []`.** The backend strips the block and ignores the list; the address fields keep their values, held, until Custom DNS is on again.

#### Slots and the 4-server cap

`BASE_SLOTS` = 2 per family. A saved list with more addresses in one family gets that many slots for it (labelled Primary, Secondary, Tertiary, then "Server N"). There is no add or remove control.

`serversOf` sends **IPv4 slots first, then IPv6**, trimmed, empties dropped — that is the order dnsmasq tries them. The wire format is unchanged: one comma-separated `servers` string, validated server-side against `MAX_SERVERS=4`.

Apply is blocked, with the reason in the foot, when custom DNS is on and any address fails `isValidAddress`, when no address is filled, or when more than `MAX_SERVERS` (4) are filled. A full preset is exactly 4, so the cap is reached only from a saved list that already used a third slot in one family and then fills a blank in the other. Enter can still submit a blocked form; the handler refuses it with an error toast.

`canApply` is `ready && isDirty && blockedKey === null && !isSaving` — **and deliberately not `blockCorrupt`**. See below.

#### `refresh` takes an argument, and the type now says so

`useCustomDns`'s `refresh` is `fetchSettings`, implemented as `useCallback(async (silent = false) => …)` but formerly typed `() => void`. That let `onClick={refresh}` compile, handing React's `MouseEvent` to `silent` as a truthy value — so a user-initiated refresh ran with its own loading state suppressed and the button looked inert for the whole request. The signature is now `(silent?: boolean) => Promise<void>`, making the bare form a compile error; `onRetry={() => refresh()}` is the spelling the shell uses. On this surface the compiler is the enforcement — see [`ttl-mtu.md`](./ttl-mtu.md) for the three sibling hooks where it is not.

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
        +-- dhcp-range=bridge0,192.168.225.20,192.168.225.170,255.255.255.0,43200   <-- from mobileap_cfg.xml (/24 after QManager's normalize)
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

**That layout is RM520N-GL-only.** The SDX55 has **no `/run/resolv.conf`** — only a real `/etc/resolv.conf`. This is why the GET's carrier branch walks both paths in order and takes the first that yields a `nameserver` line, rather than reading the `/run` copy directly. On the RM520N-GL both files are present with identical contents, so the walk stops at the first candidate and the behaviour there is unchanged.

### mobileap_cfg.xml is not a DNS-upstream knob

```xml
<DNSMode>PROXY</DNSMode>
<APDNSProfile>1</APDNSProfile>
<EnableDhcpv4Dns>1</EnableDhcpv4Dns>
```

No `<CustomDNSServer>` field exists in the schema (`/etc/data/mobileap_cfg.xsd`). Editing `dnsmasq.conf` is the correct surface. `<DNSMode>` is read at GET time to gate availability: when it names a mode other than `PROXY`, the dnsmasq proxy is bypassed and our edits would have no effect on LAN clients. That block quoted above is the **SDX65** file; the SDX55 has no `<DNSMode>` element to read, which is the `ABSENT` case described under the GET response.

> ⚠️ **`<DNSMode>` is READ-ONLY to QManager, and this is load-bearing for the UI.** It is a *gate*, not a setting we own. The accesses are all inside `get_dns_mode` — `custom_dns.sh:52` (existence and readability), `:58` (the presence `grep`), `:63` (the `<DHCPCfg` container check), `:72` (`xmlstarlet sel`) and `:74` (the `grep` fallback) — and every one of them is a read. Nothing anywhere writes the field. That is why the `unavailable` state offers no remedy and why the page may not link elsewhere to "change DNS mode" — see the matching gotcha above, which nothing but review upholds.

---

## Validation Performed

> ⚠️ WARNING: **Every run below predates `qmanager_dns_apply`.** They exercised the old `sudo mv` + `chown` + `killall` pipeline. The helper path (2026-10) has not yet been through a recorded save + clear cycle on either device; until it has, treat the rows below as evidence for the CGI and dnsmasq behavior, not for the apply step.

### RM520N-GL (SDX65) — 2026-08, first ship

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

### RG501Q-EU (SDX55) — 2026-09-04, the `ABSENT` change

Both devices ran the patched CGI from `/tmp`; the installed copy under the docroot was left untouched. Identity proven from `/proc/cmdline` — serial `b7e3d6f1`, BusyBox 1.29.3, dnsmasq 2.79.

| Check | Result |
|-------|--------|
| `GET` **before** the change | `dnsMode:"UNKNOWN"`, `available:false`, `currentUpstream:[]`, `currentSource:"unknown"` — the feature was inert on this device |
| `GET` **after** the change | `dnsMode:"ABSENT"`, `available:true`, `currentUpstream:["10.151.151.44","10.151.151.48"]`, `currentSource:"carrier"` |
| `POST action=save` — `1.1.1.1,1.0.0.1`, `ignore_carrier=true` | `ok:true`; sentinel block landed at line 307 of `/etc/data/dnsmasq.conf`; file came back `radio:radio` |
| dnsmasq PIDs across `killall -HUP` | Unchanged — a reload, not a restart. Name resolution through `192.168.120.1` kept working |
| `POST action=clear` | `ok:true`; `diff` against the pre-test copy of `/etc/data/dnsmasq.conf` was clean — restored byte-identically |
| Apply pipeline prerequisites | All present unmodified: the sudoers fragment at `/opt/etc/sudoers.d/qmanager` (this device has **no `/etc/sudoers.d`** at all), the staging dir `/etc/data/qmanager` at `0700 www-data`, and `dnsmasq --test` passing on 2.79 |

> ⚠️ **What this run did *not* prove: which upstream actually answered a query.** The `SIGHUP` was observed to leave dnsmasq's PIDs intact and to leave resolution working — that is a liveness check, not a measurement of upstream switching. Nobody captured a query against `1.1.1.1` versus the carrier resolvers. This is the same limit the `currentUpstream` warning above describes, and the run does not lift it.

### RM520N-GL (SDX65) — 2026-09-04, no regression

Same patched script, serial `61368cd2`. The `GET` payload after the change is **byte-identical** to the one before it: `dnsMode:"PROXY"`, `available:true`, the same two carrier resolvers, `currentSource:"carrier"`. The `PROXY` path and the `/run/resolv.conf` read are untouched by the tri-state.

---

## Known Gotchas & Lessons Learned

### Staging dir must be writable by www-data, on the same UBI volume as the destination

`/etc/data/` is owned by `radio:radio` mode `0755`, so `www-data` cannot create files there directly. The first release staged at `/etc/data/dnsmasq.conf.qmanager.new` and granted sudo rules for `mv`/`chown`/`HUP` on that path, but never for the *creation* of the staging file itself. Every CGI invocation through lighttpd hit `EACCES` on the shell redirect (`{ ... } > "$STAGING_FILE"`) and returned `failed to write staging config file`.

The fix introduced a dedicated staging directory `/etc/data/qmanager/` owned by `www-data:www-data` mode `0700`, created idempotently in `install_backend()` via:

```sh
install -d -o www-data -g www-data -m 0700 /etc/data/qmanager
```

At the time this kept the staging file on the same UBI volume (`/dev/ubi2_0`) as `/etc/data/dnsmasq.conf`, which the old `sudo mv` needed for an atomic rename. Since `qmanager_dns_apply`, the staged file is only *read*; the helper renames its own `mktemp` file inside `/etc/data/`, so atomicity no longer rides on where the staging dir sits. The dir is still needed because `www-data` still cannot create files in `/etc/data/`.

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

> ℹ️ NOTE: the `chown` grant below no longer exists — `qmanager_dns_apply` replaced it. The lesson still applies to any sudoers line with arguments: `:`, `=`, `,` and `\` must be backslash-escaped (the Tailscale lines escape `=` for the same reason), and only `visudo -cf` catches the mistake.

The `chown` rule had to be written as:

```
www-data ALL=(root) NOPASSWD: /bin/chown radio\:radio /etc/data/dnsmasq.conf
```

The `:` in the argument `radio:radio` has to be backslash-escaped because sudoers' grammar treats an unescaped `:` as the `user:group` separator inside any token in a rule's command. Writing the literal `radio:radio` makes sudoers parse it as a runas spec, which produces a fatal `sudo: parse error in /opt/etc/sudoers.d/qmanager` at the next sudo invocation — and because sudoers loads alphabetically, this single broken file disables sudo for every other rule in the directory.

This bit us during first install validation. The Phase 1 `installer-safety-auditor` audit approved the unescaped form because the audit does not run `visudo -cf` against the proposed line. Lesson for future installer-touching changes: the audit catches policy errors, but only `visudo -cf` catches grammar errors. The fix is committed.

### File mode is 0644 after save (was 0664 baseline)

The post-save file is mode `0644`, not the original `0664`. `qmanager_dns_apply` sets it explicitly (`chmod 0644` on its temp file before the rename); the old pipeline reached the same mode by accident, through the CGI's `0022` umask on the staging file. This is benign because QCMAP is the owner (`radio:radio`), so its `sed -i` rewrites of `dhcp-option-force` lines still succeed via owner-write rather than group-write. Worth noting in case a future change shifts ownership away from `radio` — at that point the group-writable bit would matter.

### `blockCorrupt` is a NON-BLOCKING warning, and `clearSettings` must never be wired

**This is the most important rule in this file.** `hooks/use-custom-dns.ts` exports `clearSettings`, it works, and a tree-wide grep returns the hook and nothing else. That is deliberate. Do not give it a call site.

The obvious feature — a "Repair / Rebuild the block" button offered exactly when `blockCorrupt` is true — **destroys the configuration it would promise not to touch.** The chain:

1. `custom_dns.sh:308-312` maps `action=clear` onto save-with-`enabled=false`.
2. That path runs `strip_sentinel_block` (`:161-173`), which sets `in_block=1` on the BEGIN marker and clears it **only** on END.
3. `blockCorrupt` is *defined* as one sentinel present without the other (`:154-155`).

So in the one state where the button would be offered — BEGIN present, END missing — `in_block` never returns to 0 and **every remaining line of the staged candidate is dropped**: `listen-address`, `dhcp-authoritative`, `conf-dir`. The CGI's `dnsmasq --test` (`:436`) passes, because the truncated file is syntactically *valid* and merely missing directives.

Before `qmanager_dns_apply`, that truncated file was what got installed and reloaded. **The helper now stops it at the apply step** (`:447`): it ignores everything in the staged file outside the block and rebuilds from the live config with a strip that only drops block-grammar lines after an unmatched BEGIN (see [Apply pipeline](#apply-pipeline)). So the truncation stays in the throwaway staging file. The rule below still stands: it was set for this failure and for the false positive that follows, and lifting it is a product decision that has not been taken.

**And `blockCorrupt` false-positives.** `parse_sentinel_block` (`:133-157`) reads with `while IFS= read -r line`, whose body never runs for a final line with no trailing newline. A perfectly healthy file that ends at the END marker therefore returns 2. That is not a hypothetical: the file is kept `radio:radio` precisely so QCMAP can keep rewriting it with its own `sed -i`, and a rewriter is exactly the sort of thing that leaves a file without a final newline.

Both facts point the same way, and the shipped design is the intersection of them:

- The corruption notice is a page-level **lucide `Banner`** (`role="degraded"`) in the shell. It informs; it does not block.
- `canApply` and the held state of the fields (`custom-dns.tsx`) depend on `status`, `isDirty`, the draft's validity and `isSaving` — **`blockCorrupt` is in none of them**, so a false positive cannot lock anyone out of their own DNS settings.
- No in-app repair is offered. The remedy is to edit `/etc/data/dnsmasq.conf` by hand, or to save a normal configuration, which rewrites the block.
- **No `clearSettings` call site may exist under `components/local-network/custom-dns/`** — and nothing enforces that automatically. It is a review rule a human upholds. Before the helper, the cost of missing it was the truncated `/etc/data/dnsmasq.conf` above, on a device reached over that LAN; the helper now prevents that outcome, but the rule has not been revisited.

> ℹ️ NOTE: if a future backend gains a marker-repair verb that is safe by construction — one that parses the file structurally rather than by a one-way in-block flag — **that** verb is what a repair button calls. Not this one.

### `passthroughBypass` is a stub, and rendering it drew a constant

`get_passthrough_bypass` (`custom_dns.sh:93-98`) is:

```sh
get_passthrough_bypass() {
    # TODO: full passthrough-bypass detection needs robust XML parsing of
    # MPDN_rule fields; returning false is the safe default …
    printf "false"
}
```

A robust extraction of the IP Passthrough + per-MPDN-rule DNS state from `mobileap_cfg.xml` was deferred and never done. The field stays on the type for forward compatibility; treat `false` as "no interop concern **detected**", never as "passthrough is definitely off".

**It is banned from rendering**, and the ban immediately paid for itself: the retired `custom-dns-card.tsx` already rendered `{passthroughBypass && …}`, so the shipped "IP Passthrough is bypassing dnsmasq" notice was unreachable dead code that had **never once displayed** on any device.

**The stub's blast radius grew with the `ABSENT` change.** Extending `available:true` to every SDX55-class device means the stub is now the only bypass signal on a whole new class of hardware whose passthrough behaviour nobody has measured — previously it was one under-measured field on one known device. Nothing false reaches the user today, because the field is still banned from rendering; the ban is what is holding this, not the field's correctness — and the ban is a review rule, not a check that will stop anyone. Anyone lifting it is now signing for two device classes, not one.

See the open question under [`ip-passthrough.md`](./ip-passthrough.md) for what would actually have to be measured to make this field real.

### Nothing in QManager writes `<DNSMode>` — and the page must not imply otherwise

Reinforcing the read-time gate documented under "mobileap_cfg.xml is not a DNS-upstream knob" below.

A tree-wide grep finds exactly **one** file mentioning `mobileap_cfg` — `custom_dns.sh` — and it only ever **reads** (`:58` the presence `grep`, `:63` the `<DHCPCfg` container check, `:72` `xmlstarlet sel`, `:74` a `grep` fallback). There is no writer anywhere in the codebase.

The approved design proposed a "switch DNS mode on the IP Passthrough page" button for the `unavailable` state. That page has no such control, so the button would have sent the user somewhere with nothing to do. **The link is banned** — no `/local-network/ip-passthrough` reference may appear in the Custom DNS sources. Nothing enforces that automatically; a reviewer checks it, and `grep '/local-network/ip-passthrough' components/local-network/custom-dns/` is the check. The `unavailable` notice states the configuration fact and offers no in-app remedy, because there is none.

### The `ABSENT` gate fails OPEN — and that is the only case where it may

**Short version: `available` is a safety gate, and safety gates should fail closed. This one opens for exactly one input — a `<DNSMode>` element proven not to exist — and stays closed for every genuine "cannot tell".**

The distinction the code is drawing, and which any future edit must preserve:

- **"The question does not exist on this device."** No `<DNSMode>` element in a file we read successfully. There is no selector in that firmware, proxy is its only mode, and refusing to write would be refusing on the basis of a setting that isn't there. → `ABSENT`, `available:true`.
- **"I cannot tell."** File missing, file unreadable, element present but empty. Any of these could hide a device where dnsmasq is genuinely bypassed and our `server=` lines would do nothing at all. → `UNKNOWN`, `available:false`.

Collapsing those two into one state is the mistake in both directions. Reading `ABSENT` as unknown is what left the RG501Q-EU with a permanently dead page; reading `UNKNOWN` as absent would let the page write a config that silently has no effect and then report success.

> ⚠️ **The `ABSENT` verdict is only as good as the presence test.** It is a `grep` for `<DNSMode` followed by whitespace, `>` or `/>` (`:58`) — deliberately not an XML parse, because no XML tool is installed on either device. Two of the ways that test could be wrong are now guarded: a `grep` *error* no longer reads as absence, and absence is only believed when the `<DHCPCfg>` container is in view. The line-scoping hole is not guarded — see the known limitation under [the tri-state](#dnsmode-is-a-tri-state--and-absent-means-available). If a future `mobileap_cfg.xml` spells the element differently, tighten the test — do not widen `dns_mode_available`.

### PID file path divergence

The running dnsmasq writes its PID to `/var/run/data/dnsmasq.pid`, **not** the `/run/dnsmasq.pid` referenced by the disabled `dnsmasq.service` unit. The apply helper `qmanager_dns_apply` uses `killall -HUP dnsmasq` (matching `dnsmasq_service@.service`'s `ExecReload`) rather than `kill -HUP $(cat /run/dnsmasq.pid)` for exactly this reason. Do not refactor toward the PID-file form.

---

## Why The Original Verdict Was Wrong

`CLAUDE.md` previously listed Custom DNS under `Removed/Deferred Features` with the reason *"UCI network dependency, no equivalent on RM520N-GL"*. That reasoning conflated *implementation mechanism* with *daemon presence*. The RM551E/OpenWRT port wrote `uci set network.lan.dns=...` and committed the UCI tree, which truly has no analog here — but the underlying DNS server (`dnsmasq`) is the **same package**, configured by file edits instead of UCI calls. The persistent partition layout (`/etc` on UBIFS) makes the file-edit approach as durable as the UCI approach was on OpenWRT.

Direct on-device probing (see "Architecture Found On The Device") established viability before any code was written; the implementation that shipped follows the layering this probing revealed.

---

## Related

- [`ttl-mtu.md`](./ttl-mtu.md) — the derived-draft pattern this page's shell follows
- [`ip-passthrough.md`](./ip-passthrough.md) — the open question behind `passthroughBypass`
- [`dpi.md`](./dpi.md) — the other `/local-network/` page rebuilt to the RM551E layout on 2026-11-01, with its own `shapes.ts`
- [`icon-system.md`](./icon-system.md) — why this route is lucide and `TonalBanner` (Material) is unusable here
