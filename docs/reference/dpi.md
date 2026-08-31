# Traffic Engine (DPI bypass) — Video Optimizer & Traffic Masquerade

The Traffic Engine re-ports the RM551-era "Video Optimizer / Traffic Masquerade" DPI bypass to the RM520N-GL using **zapret's `tpws`** (the transparent-proxy mode) instead of the RM551's `nfqws` (netfilter queue mode). The RM551 implementation was removed in the dev-rm520 branch (nftables/fw4 dependency, ARM32 nfqws unvalidated); tpws runs as a plain userspace proxy on vanilla Linux, so the RM520's iptables REDIRECT is enough.

## Mental model

ISPs that throttle by site name inspect the **SNI** (the plaintext site name at the start of every TLS connection, in the "ClientHello"). The engine sits between your LAN and the ISP: the firewall redirects all LAN port-80/443 traffic to `tpws`, which re-splits the ClientHello so the SNI lands in a later TCP segment, and applies packet-level tampering (disorder, out-of-band padding). The DPI box can no longer tell which site you opened, so it treats the connection as normal. No TLS is broken or decrypted — `tpws` is a transparent TCP proxy that forwards the untouched payload.

## Architecture

- One `tpws` instance on the modem, bound to `bridge0`, port **989** (`DPI_PORT`).
- One iptables rule (installed/removed by `dpi_ensure_rule` / `dpi_remove_rule`):
  `-t nat PREROUTING -i bridge0 -p tcp -m multiport --dports 80,443 -j REDIRECT --to-ports 989`
  - **No `-m comment`**: the RM520N kernel ships **without `xt_comment`**, so the rule is identified by its `--to-ports 989` signature (`DPI_RULE_SIG`) in the `-S` listing, and its packet counter via `grep "redir ports 989"` in `iptables -L -v -x`.
- Units:
  - `qmanager-dpi.service` — runs `/usr/bin/qmanager_dpi_run` with the args built by `dpi_build_args()` (from `dpi_state.sh`). The unit is **not** enabled; starting is config-gated: the 60s `qmanager-dpi-ensure.timer` (monotonic `OnBootSec`, passes the 1970-clock fire guard) runs `qmanager_dpi_run --ensure`, which starts the engine only if `video_optimizer.enabled=1` or `traffic_masquerade.enabled=1`, and stops/removes the rule when both are off.
- Binary: `/usrdata/qmanager/bin/tpws` — **root-owned** (`/usrdata/qmanager/www`, where the CGI writes, is www-data-owned; the binary lives in the root-owned `/usrdata/qmanager/bin` so a web compromise cannot swap the engine binary — the CGI only ever executes it via the root helper).

## Modes

| Mode | Config keys | Effect |
|------|-------------|--------|
| Video Optimizer | `video_optimizer.enabled`, `video_optimizer.strategy` | Desync only connections whose SNI matches the hostlist (`/etc/qmanager/video_domains.txt`, subdomains match automatically). `strategy` is reserved (`full`/`targeted`); current tpws builds have exactly one recipe, so it is stored but does not change the recipe. |
| Traffic Masquerade | `traffic_masquerade.enabled`, `traffic_masquerade.sni_domain` | The **same** recipe applied to every 80/443 connection (no hostlist). |

The two modes are **mutually exclusive** (CGI-enforced; enabling one disables the other). `sni_domain` is accepted and stored for API-contract compatibility with the RM551, but is **inert** — tpws has no fake-ClientHello mode (that is nfqws-only), so masquerade instead means "split everything."

## The recipe (why it is what it is)

```
--filter-l7=tls,http --split-pos=1,midsld,sniext+1 --disorder=tls --oob=tls
```

- This is exactly the recipe Titan (an RM551E running the same official tpws v72.13 build 24/7, config at `/data/opt/lettucepi/zapret.sh`) runs, plus `--filter-l7=tls,http` (Titan also uses it; it scopes the engine to TLS/HTTP handshakes only).
- **`--tlsrec=sniext+1` was dropped** after on-device A/B on this platform: it re-splits past SNI extraction and was observed to break established HTTPS transfers to a hostlist target (tele2 test server). Titan runs without it for the same reason.
- **`--hostlist-auto-reload` is not used**: the flag does not exist in v72.13, but v72.13 re-stats and reloads the hostlist on every connection check by default (proven in `hostlist.c`, confirmed live: "Loaded 4 hosts" on reload). A CGI hostlist save applies immediately without restarting the engine.

## Provisioning (install)

`qmanager_dpi_install` downloads from GitHub releases:

1. Fetch `zapret-<tag>` release assets; tag pinned to `DPI_DEFAULT_TAG="v72.13"`.
2. Asset names carry no arch tags — the ARM build lives inside the tarball. Prefer `zapret-<tag>-openwrt-embedded.tar.gz`, fall back to `zapret-<tag>.tar.gz`; both contain `binaries/linux-arm/tpws`.
3. **Two-layer verification**: the release's own `sha256sum.txt` manifest must contain `zapret-<tag>/binaries/linux-arm/tpws` with a sha256 matching the downloaded binary, **and** the binary must match the embedded pin `DPI_PINNED_SHA256` (hash of the official v72.13 linux-arm build). The pin is the identity anchor; the manifest is the freshness check.
4. Installs to `/usrdata/qmanager/bin/tpws` (root-owned), `chmod 755`.

## Teardown (uninstall)

**Nothing owns the REDIRECT rule but `dpi_state.sh`.** `qmanager-dpi.service` owns the tpws *process*; `qmanager-dpi-ensure.timer` only *re-asserts* the rule every 60s. Neither removes it — stopping or disabling the units leaves the rule installed. The rule outlives the engine by design (QCMAP flushes iptables on every re-dial, which is exactly why the timer keeps re-inserting it), so removal has to be an explicit act.

**`qmanager_dpi_run --clear` is the authoritative teardown** — it drains **every rule the lib owns**, each via a bounded 16-pass `-D` loop, and then stops `qmanager-dpi`. It is the only supported way to remove them; do not hand-write an `iptables -D` in a caller.

| Drain | Rule | Owner |
| --- | --- | --- |
| `dpi_remove_rule` | `nat PREROUTING` REDIRECT `--to-ports $DPI_PORT` | the engine |
| `dpi_remove_force_tcp_rule` | `filter FORWARD` REJECT `--reject-with icmp-port-unreachable` | the standalone Force-TCP toggle |
| `dpi_purge_legacy_dscp_rule` | `mangle POSTROUTING` DSCP `--set-dscp 0x2e` | upgrade migration (legacy builds) |

**`--clear` is whole-product teardown, not engine teardown**, and the distinction is the whole reason it is safe to drain the two QUIC rules here. It is invoked from exactly **one** site in the tree — `uninstall_rm520n.sh` — so by the time it runs, the intent is "QManager is going away" and no config gate is wanted. The Traffic Engine's own UI uninstall does **not** reach this verb (see below), so an engine-only uninstall still leaves a live user's Force-TCP toggle alone.

**There is no exception, as of 2026-08-30.** `_dpi_uninstall_run` in `qmanager_dpi_install` — the UI-driven `uninstall` verb — calls `dpi_remove_rule` like everyone else, so both uninstall paths run the *same code* rather than two copies kept in sync.

> ⚠️ **The two paths converge on the FUNCTION, not on the VERB — and that seam is load-bearing.** `_dpi_uninstall_run` calls `dpi_remove_rule` **directly**; it must never be "tidied up" into a call to `qmanager_dpi_run --clear`. That refactor would read as harmless deduplication and would silently start draining the standalone QUIC rules on an **engine-only** uninstall, killing a live user's Force-TCP toggle. `scripts/test/dpi-uninstall-path-symmetry.sh` section [5] fails if anything closes the seam.

> **How it got here (F19), and the rule to keep.** `_dpi_uninstall_run` used to hand-write its own two `-D` calls, because it also drained a `nat OUTPUT` rule (`-p tcp --dport 443 -j REDIRECT`) that `dpi_state.sh` does not manage. `dpi_remove_rule` only touches `PREROUTING`, so the two uninstall paths drained different chains: `uninstall_rm520n.sh` → `qmanager_dpi_run --clear` never cleared OUTPUT at all.
>
> The OUTPUT drain was **deleted** rather than promoted into the lib. The decisive fact is that nothing in the tree, and nothing in git history, has ever *inserted* that rule: the `-D` arrived already orphaned in `71db6b9`, the same commit that first wrote `_dpi_uninstall_run`. It was speculative from birth, not a migration for previously-shipped device state — so no real device can be carrying the rule it drained. Promoting it would have put a drain in the shared lib for a rule `dpi_apply_rule` never inserts.
>
> - ⚠️ **If a modem-originated OUTPUT redirect is ever needed again, add it to `dpi_apply_rule` AND `dpi_remove_rule` in the lib — never re-inline it in the installer.** `scripts/test/dpi-uninstall-path-symmetry.sh` pins both halves: section [1] goes red the moment anything inserts a `nat OUTPUT` rule (which is what makes the delete legitimate), section [2] compares the table/chain set the two uninstall paths actually drain, under a stubbed `iptables`.
> - **The port is read from `$DPI_PORT`, never restated.** `qmanager_dpi_install` sources `platform.sh` and `dpi_state.sh`, so `run_iptables` and the constant are both in scope. The old inlined drains hardcoded `--to-ports 989` until 2026-08-30 — the same defect as F16 below, and worse here, because a teardown that matches nothing leaves every LAN client redirected to a dead port. Pinned behaviourally by `scripts/test/dpi-rule-signature-port.sh` section [3], which now runs the teardown through a `DPI_PORT`-patched copy of the lib end-to-end.
> - **The drain also got stronger.** The old inlined `-D` fired once; `dpi_remove_rule` loops up to 16 passes, so stacked duplicate rules (what a drifted `DPI_PORT` produces) now clear on the UI path too.

`scripts/uninstall_rm520n.sh` calls it in **Step 1**, beside the three arm-helper `teardown` calls. The ordering is load-bearing: it must run **before Step 3** removes `/usr/bin/qmanager_dpi_run` and the `/usr/lib/qmanager/dpi_state.sh` it sources, and **before Step 5** removes `$QMANAGER_ROOT/bin` (the tpws binary). The call is guarded on `[ -x "$BIN_DIR/qmanager_dpi_run" ]` and `|| true`, so an install that never had the Traffic Engine is a clean no-op.

> ⚠️ WARNING: skipping this teardown is a **LAN outage, not a leak** — in two different ways. Uninstalling with Traffic Engine enabled leaves a `nat` PREROUTING REDIRECT sending every LAN client's tcp/80 and tcp/443 to port 989 with nothing listening on it. Uninstalling with **Force-TCP** on leaves a `filter FORWARD` REJECT killing every LAN client's QUIC (UDP/443). Either breaks LAN traffic until QCMAP next flushes iptables on a re-dial or reboot — and "QCMAP will flush it eventually" is explicitly *not* an acceptable teardown mechanism here (`uninstall_rm520n.sh` says so in its own comment). `scripts/test/installer-teardown-lockstep.sh` pins this: it discovers every `scripts/usr/bin/qmanager_*` helper exposing a teardown-style verb (`teardown` / `--clear` / `disarm`) and asserts the uninstaller invokes each one, so a future helper that grows a teardown arm and forgets the uninstaller trips the same harness.

> ℹ️ NOTE: `DPI_RULE_SIG` is `"--to-ports $DPI_PORT"` — interpolated, since `e0374dc` (tracker F16). It was a bare literal before that, which meant a future port change would leave `dpi_rule_present()` grepping for the *old* signature: `dpi_apply_rule`'s idempotence check misses, its `-D` drain loop (which matches the *new* spec) removes nothing, and the insert **stacks a second REDIRECT** instead of replacing the first. Moving the port is now a one-line change, but it is still not free — **a device already running the old rule needs a one-shot drain for the old spec**, because nothing on either side of the change matches it any more.

## QUIC handling (Force-TCP, standalone)

The engine is **TCP-only**: `tpws` desyncs TLS/HTTP handshakes, and the transparent REDIRECT rule matches `-p tcp --dports 80,443`. QUIC (UDP 443) passes through untouched, so deprecated builds added an iptables DSCP-marking rule (`--set-dscp 0x2e`, "prioritize" QUIC) alongside the engine. That coupling is **removed**: QUIC is now handled solely by a standalone **Force-TCP** toggle.

- **Config key:** `quic.force_tcp` (0/1) — independent of `video_optimizer` / `traffic_masquerade`.
- **Rule** (idempotent; identified by its `--reject-with icmp-port-unreachable` signature — no `xt_comment` on this kernel):
  `-t filter FORWARD -i bridge0 -p udp --dport 443 -j REJECT --reject-with icmp-port-unreachable`
  REJECTing QUIC makes QUIC-first apps (YouTube, Discord, Instagram) fall back to HTTPS over TCP, where the engine's bypass applies. A LAN-side **REJECT** (not DROP) lets clients fail back on the first packet; DROP would make them wait out QUIC retransmit/PTO timers — a dead-feeling second or two per new host.
- **Independent of the engine, with exactly one exception:** binary install/uninstall and mode enable/disable never touch this rule — but **whole-product uninstall does** (`qmanager_dpi_run --clear`, see Teardown). Removing QManager must not leave a rule behind that only QManager could remove. `qmanager_dpi_run --ensure` reconciles it against `quic.force_tcp` on every 60s pass **outside** the engine's enabled-gate (the timer is unconditionally armed and QCMAP flushes iptables on each re-dial, so the rule self-heals even with the engine off or uninstalled).
- **Upgrade migration:** the same ensure pass drains any leftover `--set-dscp 0x2e` rule (`dpi_purge_legacy_dscp_rule`) from builds that bundled QUIC marking with the engine. `--clear` drains it too, so uninstalling does not strand it on a device that never got an ensure pass in between.
- **CGI:** `POST {"action":"save_force_tcp","enabled":bool}` applies/removes the rule immediately — no binary check, no mode mutex, no service interaction. GET status adds `force_tcp` (config intent) and `force_tcp_active` (rule present) to both section views.
- **UI:** a standalone tile at the very bottom of the Traffic Engine page (below onboarding and the Test bypass card), rendered in every page state — including before the engine is installed. It talks through its own `use-force-tcp` hook with zero coupling to the engine hooks.
- **Why drop DSCP rather than keep both?** Marking QUIC only asks the carrier's QoS to prioritize it — it could never route QUIC into tpws's protection (tpws is TCP-only). Keeping an automatic mark would silently re-couple QUIC behavior to the engine and hide that QUIC is otherwise unmanaged. QUIC is now either explicit passthrough (default) or Force-TCP; the tile's copy warns that on a network where QUIC already runs at full speed, forcing TCP can stream slower.

## Verify ("Test bypass")

`qmanager_dpi_verify` runs the fast.com comparison plus a reference phase: **(0)** a reference sample of the raw connection over speedtest.net (Ookla's JS server API — a `random2000x2000.jpg` burst from the top server), falling back to Cloudflare's documented speed endpoint (`__down?bytes=25000000`) when Ookla is unreachable; **(1)** direct curl download from a freshly fetched Netflix-CDN URL (fast.com's own API) → without-bypass rate; **(2)** the same URL through a throwaway socks-mode tpws instance → with-bypass rate. The reference is the "3rd opinion": it measures the class of traffic ISPs usually do **not** throttle (Ookla/Cloudflare), so a low fast.com beside a healthy reference means real CDN throttling, while a slow reference means the line itself is slow. The throttled verdicts consult it — a slow-but-real connection no longer reads as "throttled" — and if both reference sources are down the verdicts fall back to the old absolute-speed rule, so a broken reference can never falsify a result. **Deliberate deviation from RM551**: the 551 uses the Ookla CLI as its *whole* test, but ISPs throttle by host (streaming CDNs capped while Ookla's servers pass) — fast.com is the traffic class the engine fixes, and Ookla is the baseline, not the signal. The with-bypass socks leg uses the engine recipe minus `--oob=tls` (oob breaks the socks path, measured on hardware; split+disorder alone deliver the full effect). The real engine is never touched — no state, no rules, no restore trap beyond killing the socks instance. Result (without/with/reference + improvement factor, `reference.source` = `speedtest`|`cloudflare`) is written to `/tmp/qmanager_dpi_verify.json` and polled by the UI. The UI gate is only `binary_installed` — the engine does not need to be running.

## Status contract

`GET /cgi-bin/quecmanager/network/video_optimizer.sh` (with `?section=masquerade` for the masquerade view) returns: `enabled` (config intent), `status` (`running`/`stopped`, plus `restarting`/`error` when systemd permits the follow-up query), `uptime`, `packets_processed`, `domains_loaded`, `binary_installed`, `kernel_module_loaded` (rule present), `force_tcp`, `force_tcp_active`. Full contract in `docs/API-REFERENCE.md`.

## Platform / ISP findings (tested on pilot, AT&T Wireless)

- The pilot ISP throttles **by host/SNI for streaming CDNs**: fast.com (Netflix CDN) reads 2.4 Mbps on the bare path and ~30 Mbps with the tampered handshake — measured from the modem itself, direct vs socks-tpws, same signed CDN URL. Some other destinations (kernel.org, tele2) measured as IP-throttled — the engine defeats SNI-based DPI; it is not a general VPN.
- RM520N kernel lacks `xt_comment` and `xt_owner` (rule identification is by signature, see above).
- tpws hot-reloads the hostlist per-connection; no restart needed on hostlist save.
- **Status reads are privilege-free by design.** Unprivileged `systemctl show` is a per-model lottery: allowed on RM520N, denied outright on sibling builds such as RM502Q-GL, and www-data never has a sudoers rule for systemctl. `dpi_service_status` therefore probes tpws liveness with an anchored pgrep on the binary path (hardcoded fallback, since some builds ship `$DPI_BINARY` empty) and consults systemd only to label degraded states. Uptime derives from `/proc/<pid>/stat` starttime jiffies vs `/proc/uptime`. Validated live on RM520N v0.1.14 + RM502Q-GL fleet.

## Files

- `scripts/usr/lib/qmanager/dpi_state.sh` — helpers (args build, rule ensure/remove, status probes, mode detection)
- `scripts/usr/bin/qmanager_dpi_run` — engine supervisor (`--ensure` / `--start` / `--stop`)
- `scripts/usr/bin/qmanager_dpi_install` — binary provisioning (pin + manifest verification)
- `scripts/usr/bin/qmanager_dpi_verify` — speed comparison helper (fast.com + speedtest.net/Cloudflare reference)
- `scripts/uninstall_rm520n.sh` — Step 1 calls `qmanager_dpi_run --clear` (see Teardown)
- `scripts/test/installer-teardown-lockstep.sh` — harness pinning that call
- `scripts/test/dpi-rule-signature-port.sh` — harness pinning `DPI_RULE_SIG` and the `_dpi_uninstall_run` teardown to `$DPI_PORT`
- `scripts/test/dpi-uninstall-path-symmetry.sh` — harness pinning the uninstall paths: sections [1]–[3] that the UI and full-device paths drain the same chains (F19), section [4] that `--clear` drains **all three** rules the lib owns (F21, behavioural — the branch is awk-extracted and run against a stubbed `run_iptables`, asserting rule *signatures* not chain names), section [5] that the UI path does **not** route through `--clear`
- `scripts/www/cgi-bin/quecmanager/network/video_optimizer.sh` — CGI (status / save / save_masquerade / save_force_tcp / verify / install / save_hostlist)
- `app/local-network/traffic-engine/` + `components/local-network/traffic-engine/` — frontend
- `hooks/use-video-optimizer.ts`, `hooks/use-traffic-masquerade.ts`, `hooks/use-force-tcp.ts`, `hooks/use-cdn-hostlist.ts`
