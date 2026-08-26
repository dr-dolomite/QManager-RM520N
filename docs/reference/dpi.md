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

**`qmanager_dpi_run --clear` is the authoritative teardown** — it drains the rule (`dpi_remove_rule`, up to 16 `-D` passes) and then stops `qmanager-dpi`. It is the only supported way to remove the rule; do not hand-write an `iptables -D` in a caller.

`scripts/uninstall_rm520n.sh` calls it in **Step 1**, beside the three arm-helper `teardown` calls. The ordering is load-bearing: it must run **before Step 3** removes `/usr/bin/qmanager_dpi_run` and the `/usr/lib/qmanager/dpi_state.sh` it sources, and **before Step 5** removes `$QMANAGER_ROOT/bin` (the tpws binary). The call is guarded on `[ -x "$BIN_DIR/qmanager_dpi_run" ]` and `|| true`, so an install that never had the Traffic Engine is a clean no-op.

> ⚠️ WARNING: skipping this teardown is a **LAN outage, not a leak**. Uninstalling with Traffic Engine enabled leaves a `nat` PREROUTING REDIRECT sending every LAN client's tcp/80 and tcp/443 to port 989 with nothing listening on it — all LAN web traffic breaks until QCMAP next flushes iptables on a re-dial or reboot. `scripts/test/installer-teardown-lockstep.sh` pins this: it discovers every `scripts/usr/bin/qmanager_*` helper exposing a teardown-style verb (`teardown` / `--clear` / `disarm`) and asserts the uninstaller invokes each one, so a future helper that grows a teardown arm and forgets the uninstaller trips the same harness.

> ℹ️ NOTE: `DPI_RULE_SIG` is the literal string `"--to-ports 989"`, **not** interpolated from `$DPI_PORT`. If a future change moves the port or reshapes the rule, `dpi_rule_present()` stops recognising a rule already installed under the old signature — `dpi_apply_rule`'s idempotence check misses, its `-D` drain loop (which matches the *new* spec) removes nothing, and the insert **stacks a second REDIRECT** instead of replacing the first. Change the signature and the port together, and add a one-shot drain for the old spec.

## Verify ("Test bypass")

`qmanager_dpi_verify` runs a two-phase comparison against a **fast.com CDN target**: (1) direct curl download from a freshly fetched Netflix-CDN URL (fast.com's own API) → without-bypass rate; (2) the same URL through a throwaway socks-mode tpws instance → with-bypass rate. **Deliberate deviation from RM551**: the 551 uses the Ookla CLI, but ISPs throttle by host (streaming CDNs capped while Ookla's servers pass), so a speedtest.net comparison reads "not throttled" on the very links the engine fixes — fast.com measures the class of traffic the engine exists for. The with-bypass socks leg uses the engine recipe minus `--oob=tls` (oob breaks the socks path, measured on hardware; split+disorder alone deliver the full effect). The real engine is never touched — no state, no rules, no restore trap beyond killing the socks instance. Result (with/without + improvement factor) is written to `/tmp/qmanager_dpi_verify.json` and polled by the UI. The UI gate is only `binary_installed` — the engine does not need to be running.

## Status contract

`GET /cgi-bin/quecmanager/network/video_optimizer.sh` (with `?section=masquerade` for the masquerade view) returns: `enabled` (config intent), `status` (`running`/`stopped`, plus `restarting`/`error` when systemd permits the follow-up query), `uptime`, `packets_processed`, `domains_loaded`, `binary_installed`, `kernel_module_loaded` (rule present). Full contract in `docs/API-REFERENCE.md`.

## Platform / ISP findings (tested on pilot, AT&T Wireless)

- The pilot ISP throttles **by host/SNI for streaming CDNs**: fast.com (Netflix CDN) reads 2.4 Mbps on the bare path and ~30 Mbps with the tampered handshake — measured from the modem itself, direct vs socks-tpws, same signed CDN URL. Some other destinations (kernel.org, tele2) measured as IP-throttled — the engine defeats SNI-based DPI; it is not a general VPN.
- RM520N kernel lacks `xt_comment` and `xt_owner` (rule identification is by signature, see above).
- tpws hot-reloads the hostlist per-connection; no restart needed on hostlist save.
- **Status reads are privilege-free by design.** Unprivileged `systemctl show` is a per-model lottery: allowed on RM520N, denied outright on sibling builds such as RM502Q-GL, and www-data never has a sudoers rule for systemctl. `dpi_service_status` therefore probes tpws liveness with an anchored pgrep on the binary path (hardcoded fallback, since some builds ship `$DPI_BINARY` empty) and consults systemd only to label degraded states. Uptime derives from `/proc/<pid>/stat` starttime jiffies vs `/proc/uptime`. Validated live on RM520N v0.1.14 + RM502Q-GL fleet.

## Files

- `scripts/usr/lib/qmanager/dpi_state.sh` — helpers (args build, rule ensure/remove, status probes, mode detection)
- `scripts/usr/bin/qmanager_dpi_run` — engine supervisor (`--ensure` / `--start` / `--stop`)
- `scripts/usr/bin/qmanager_dpi_install` — binary provisioning (pin + manifest verification)
- `scripts/usr/bin/qmanager_dpi_verify` — two-phase speed comparison helper
- `scripts/uninstall_rm520n.sh` — Step 1 calls `qmanager_dpi_run --clear` (see Teardown)
- `scripts/test/installer-teardown-lockstep.sh` — harness pinning that call
- `scripts/www/cgi-bin/quecmanager/network/video_optimizer.sh` — CGI (status / save / save_masquerade / verify / install / save_hostlist)
- `app/local-network/traffic-engine/` + `components/local-network/traffic-engine/` — frontend
- `hooks/use-video-optimizer.ts`, `hooks/use-traffic-masquerade.ts`, `hooks/use-cdn-hostlist.ts`
