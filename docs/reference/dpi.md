# Traffic Engine (DPI bypass) — Video Optimizer & Full Bypass

The Traffic Engine re-ports the RM551-era "Video Optimizer / Traffic Masquerade" DPI bypass to the RM520N-GL using **zapret's `tpws`** (the transparent-proxy mode) instead of the RM551's `nfqws` (netfilter queue mode). The RM551 implementation was removed in the dev-rm520 branch (nftables/fw4 dependency, ARM32 nfqws unvalidated); tpws runs as a plain userspace proxy on vanilla Linux, so the RM520's iptables REDIRECT is enough.

## Quick Reference

| Item | Value |
| --- | --- |
| Route | `/local-network/traffic-engine` (`?mode=video` or `?mode=full_bypass` scrolls to and highlights that mode card) |
| CGI | `scripts/www/cgi-bin/quecmanager/network/video_optimizer.sh` (GET `?section=full_bypass`, `?section=hostlist`, `?action=verify_status`, `?action=install_status`; POST `save`, `save_full_bypass`, `save_force_tcp`, `save_hostlist`, `restore_hostlist`, `verify`, `install`, `uninstall`) |
| Engine | `/usrdata/qmanager/bin/tpws`, `qmanager-dpi.service`, `qmanager-dpi-ensure.timer` |
| Hostlist | `/etc/qmanager/video_domains.txt` (factory copy seeded by `qmanager_setup`) |
| Frontend | `components/local-network/traffic-engine/**`, hooks `use-video-optimizer`, `use-full-bypass`, `use-force-tcp`, `use-cdn-hostlist` |
| i18n | `local-network:traffic_engine.*` |

> ℹ️ **"Traffic Masquerade" is the retired name for Full Bypass (renamed 2026-09-01).** Read [The rename](#the-rename-traffic-masquerade--full-bypass) before touching anything that still spells it the old way — one CGI alias and one uninstall drain still do, deliberately.

## Mental model

ISPs that throttle by site name inspect the **SNI** (the plaintext site name at the start of every TLS connection, in the "ClientHello"). The engine sits between your LAN and the ISP: the firewall redirects all LAN port-80/443 traffic to `tpws`, which re-splits the ClientHello so the SNI lands in a later TCP segment, and sends those segments out of order. The DPI box can no longer tell which site you opened, so it treats the connection as normal. No TLS is broken or decrypted — `tpws` is a transparent TCP proxy that forwards the untouched payload.

## Architecture

- One `tpws` instance on the modem, bound to the **LAN address** of `bridge0` (`DPI_LAN_IF`), port **989** (`DPI_PORT`). `dpi_bind_addr()` reads that address from `ip -4 addr show` and prints **empty** when the interface has none yet; empty argv means "cannot start", never a wildcard fallback.
  - > ⚠️ WARNING: the bind address is a **security boundary, not a preference**. Port 989 is matched by **no rule in any chain** — `QMANAGER_FW` (`qmanager_firewall`) covers only 80/443 and SSH on `rmnet+` — so the earlier `DPI_BIND_ADDR="0.0.0.0"` made tpws an open transparent proxy reachable from the carrier side. The LAN bind is the only thing closing that exposure; do not reintroduce a wildcard bind, and do not assume a firewall rule is behind it.
- One iptables rule (inserted by `dpi_apply_rule`, drained by `dpi_remove_rule`):
  `-t nat PREROUTING -i bridge0 -p tcp -m multiport --dports 80,443 -m addrtype ! --dst-type LOCAL -j REDIRECT --to-ports 989`
  - **No `-m comment`**: the RM520N kernel ships **without `xt_comment`**, so the rule is identified by its `--to-ports 989` signature (`DPI_RULE_SIG`) in the `-S` listing, and its packet counter via `grep "redir ports 989"` in `iptables -L -v -x`.
  - **`-m addrtype ! --dst-type LOCAL`** keeps LAN traffic aimed at the modem's *own* address out of the engine — QManager's own UI included.
  - Both spec strings live in constants (`_DPI_RULE_MATCH`, `_DPI_RULE_MATCH_LEGACY`) rather than being restated at the four call sites, because a `-D` drain must match the insert **byte-for-byte, match-module order included**. See [Rule liveness](#rule-liveness-the-rule-cannot-outlive-the-engine) for why the legacy spec still has a drain.
  - > ⚠️ WARNING: **these rule specs exist twice, and must change together.** When the lib runs as `www-data` (the `video_optimizer.sh` CGI), `run_iptables` does not call iptables — it forwards its argv to the root helper `/usr/bin/qmanager_fw_apply`, which accepts only an exact list of rule shapes. That helper carries its own copies, `DPI_MATCH` and `DPI_MATCH_LEGACY`, plus the literal port `989`, the force-TCP `REJECT` rule and the legacy `DSCP` purge. Change a match string, the port or a rule in `dpi_state.sh` without changing `qmanager_fw_apply`, and every `www-data` call with the new shape is refused (`refused: shape`, exit 2). Root callers (`qmanager_dpi_run` under systemd, `qmanager_dpi_install` via sudo, the uninstaller) run iptables directly and keep working, so the break shows up only from the UI.
- Units:
  - `qmanager-dpi.service` — runs `/usr/bin/qmanager_dpi_run` with the args built by `dpi_build_args()` (from `dpi_state.sh`). The unit is **not** enabled; starting is config-gated inside the runner (`run` exits 0 when no mode is enabled, so the unit goes cleanly inactive rather than failed). The 60s `qmanager-dpi-ensure.timer` (monotonic `OnBootSec=60` + `OnUnitActiveSec=60`, no `OnCalendar`, so it passes the 1970-clock fire guard) runs `qmanager_dpi_run --ensure`. `--ensure`'s engine branch is **gated on `dpi_is_enabled`** — with both modes off it touches neither the rule nor the unit; the rule is drained by the unit's own `ExecStopPost` instead ([Rule liveness](#rule-liveness-the-rule-cannot-outlive-the-engine)).
  - `ExecStartPost=/usr/bin/qmanager_dpi_run --rule-up` / `ExecStopPost=… --rule-down` — the rule's lifecycle. Both always exit 0.
  - `install_rm520n.sh` > `start_services()` starts `qmanager-dpi` post-install only when a mode is enabled — it checks **`video_optimizer.enabled` and then `full_bypass.enabled`**. Gating on the first key alone meant a Full Bypass device's engine never came back after an install or OTA.
- Binary: `/usrdata/qmanager/bin/tpws` — **root-owned** (`/usrdata/qmanager/www`, where the CGI writes, is www-data-owned; the binary lives in the root-owned `/usrdata/qmanager/bin` so a web compromise cannot swap the engine binary — the CGI only ever executes it via the root helper).

## Modes

| Mode | Config keys | Effect |
|------|-------------|--------|
| Video Optimizer | `video_optimizer.enabled`, `video_optimizer.strategy` | Desync only connections whose SNI matches the hostlist (`/etc/qmanager/video_domains.txt`, subdomains match automatically). `strategy` is reserved (`full`/`targeted`); current tpws builds have exactly one recipe, so it is stored but does not change the recipe. |
| Full Bypass | `full_bypass.enabled`, `full_bypass.sni_domain` | The **same** recipe applied to every 80/443 connection (no hostlist). |

The two modes are **mutually exclusive** (CGI-enforced; enabling one disables the other), and they differ in **scope, not technique** — which is the whole content of the distinction, and the reason for the name. `sni_domain` is accepted and stored for API-contract compatibility with the RM551, but is **inert**: tpws has no fake-ClientHello mode (that is nfqws-only), so there is nothing to put a spoofed name into. The UI sends the fixed value `speedtest.net` (`FULL_BYPASS_SNI` in `traffic-engine.tsx`) with every Full Bypass write and never shows the field.

### The RM551E "masquerade" mode is not ported, and the kernel is not why

The RM551E v0.1.34 page has a third technique, masquerade: nfqws sends a fake TLS ClientHello carrying a spoofed SNI. It is **excluded** from the RM520N page.

The kernel does not block it. Probed read-only on RM520N-GL (serial `61368cd2`, kernel 5.4.210) on 2026-11-01: `CONFIG_NETFILTER_XT_TARGET_NFQUEUE=y`, `CONFIG_NETFILTER_NETLINK_QUEUE=y`, `/proc/net/netfilter/nfnetlink_queue` exists, and `NFQUEUE` is listed in `/proc/net/ip_tables_targets`. What is missing is userland: no `nfqws` binary on the device (only `tpws`), no installer or pin for one, no NFQUEUE rule in `dpi_state.sh` or the `qmanager_fw_apply` allow-list, and no backend action (the CGI's `save_masquerade` is an alias for `save_full_bypass`, see [The rename](#the-rename-traffic-masquerade--full-bypass)). Porting it is a backend project, not a UI one. Not probed on RG501Q-EU.

> ⚠️ WARNING: kernel support is necessary, not sufficient. `dpi_state.sh`'s header records that nfqws reinjection is broken on Qualcomm rmnet rawip, which is why the port chose tpws. No measurement of that claim is on record; a masquerade port has to test reinjection on `rmnet_data*` before anything else.

### The rename: Traffic Masquerade → Full Bypass

**Full Bypass was called "Traffic Masquerade" until 2026-09-01**, and the old name was inherited rather than chosen. On the RM551E it was accurate: nfqws rewrote the outgoing ClientHello's SNI to a spoofed identity (`sni_domain`, default `speedtest.net`), so real traffic genuinely pretended to be a different site, and the field named the disguise.

None of that survived the port. tpws has no fake-SNI capability at all — it splits and reorders the connection's **real** ClientHello so DPI cannot parse it. So on this platform the mode never impersonated anything; it meant "run the anti-DPI recipe unscoped". The name promised a target, a disguise identity and something to configure, and there was none of it. `sni_domain` is carried for contract parity and is otherwise dead, which made the surface worse rather than better: the one field that looked like the answer was the one field that did nothing.

The historical explanation above is why the divergence from RM551 exists, and it stays relevant under the new name — it is what `sni_domain` is still doing in the contract.

**What moved, and what did not:**

| Layer | Retired | Current |
| --- | --- | --- |
| Config section | `traffic_masquerade` | `full_bypass` (same `enabled` / `sni_domain` keys) |
| CGI GET | `?section=masquerade` | `?section=full_bypass` |
| CGI POST | `save_masquerade` | `save_full_bypass` |
| `dpi_active_mode()` prints | `masquerade` | `full_bypass` |
| `DpiMode` member | `"masquerade"` | `"full_bypass"` |
| Type | `MasqueradeStatus` | `FullBypassStatus` |
| Hook | `hooks/use-traffic-masquerade.ts` (`useTrafficMasquerade`) | `hooks/use-full-bypass.ts` (`useFullBypass`) |
| i18n | `trafficEngine.mode.masquerade{,_hint}`, `.toast_masquerade` (namespace `common`) | `local-network:traffic_engine.mode_full_bypass`, `.toast_full_bypass_enabled` |

> ⚠️ **The persisted config section is renamed, and `config.sh` has no migration primitive.** `qm_config_init` only *seeds* an empty file — it returns early the moment `$QM_CONFIG` is non-empty. Every already-deployed device therefore keeps its `traffic_masquerade` section, and a renamed reader would find nothing, fall back to its default, and switch the mode **off** on a user who had it on: no error, no log line, nothing observable. `migrate_traffic_masquerade_to_full_bypass()` in `install_rm520n.sh` (called from `install_backend()`, right after `migrate_watchcat_fail_threshold`) copies both keys across and retires the old section. It is idempotent, runs on every install and OTA, and takes `|| true` on every write because `install_backend` runs under `set -e`. This was pinned behaviourally by the now-deleted `scripts/test/full-bypass-config-migration.sh` (`scripts/test/` was removed 2026-09-03) — verify the migration on-device: check for a stray `traffic_masquerade` section after an OTA from an older build.
>
> Retiring the section needed a new primitive: `qm_config_delete` is **key**-scoped, so using it would have left `"traffic_masquerade": {}` behind on every device. `qm_config_delete_section` in `config.sh` mirrors its gated-`mv` pattern.

**Two sites still spell it the old way, deliberately:**

1. **The CGI accepts `?section=masquerade` and `action=save_masquerade` as deprecated aliases, for one release.** An OTA replaces the CGI and the JS bundle together, so a *device* is never half-updated — but a browser tab left open across the OTA still holds the old bundle, and its next write would return `unknown_action`. Remove the aliases once no supported upgrade path can still be serving the old bundle (there is no harness left to update alongside them — `scripts/test/` was deleted 2026-09-03).
2. **`_dpi_uninstall_run`'s config cleanup drains both names** (`del(.video_optimizer, .full_bypass, .traffic_masquerade)`). It is a teardown that can run on a device which has not taken the installer migration — a UI uninstall needs no OTA — and `del()` on an absent key is free. Every **read** site was renamed outright; only this drain is bilingual.

Historical prose in `dpi_state.sh`'s header still says "Traffic Masquerade", because it describes the RM551E feature. Renaming it would make the comment false rather than current.

The 2026-11-01 rebuild moved every Traffic Engine string from `common` into the `local-network` namespace, and the old `trafficEngine.targets.*` subtree is gone. When a Full Bypass string is re-translated, check each locale's copy for that locale's own word for the retired mode by hand: a key swap without a real re-translation is the failure mode to look for.

## The recipe (why it is what it is)

```
--filter-l7=tls,http --split-pos=1,midsld,sniext+1 --disorder=tls
```

- Plus `--port=989 --bind-addr=<bridge0 IPv4>`, and `--hostlist=/etc/qmanager/video_domains.txt` in Video Optimizer mode only. Full Bypass is the same recipe with the hostlist flag absent — that one flag is also what `_dpi_reconcile_argv` compares to detect a running engine in the wrong mode.
- This is the recipe Titan (an RM551E running the same official tpws v72.13 build 24/7, config at `/data/opt/lettucepi/zapret.sh`) runs, plus `--filter-l7=tls,http` (Titan also uses it; it scopes the engine to TLS/HTTP handshakes only).
- **`--oob=tls` was dropped from the live recipe in `3b9cdf7`.** On this network it kills matched connections outright — the browser reports "could not reach our servers" on hostlist targets while unmatched domains keep working. `qmanager_dpi_verify`'s socks leg had always excluded it, so the live engine and the verify leg now run the **same** argv (Titan/RM551E reportedly tolerates `--oob`; the RM520N + T-Mobile path does not).
- **`--tlsrec=sniext+1` was dropped** after on-device A/B on this platform: it re-splits past SNI extraction and was observed to break established HTTPS transfers to a hostlist target (tele2 test server). Titan runs without it for the same reason.
- **`--hostlist-auto-reload` is not used**: the flag does not exist in v72.13, but v72.13 re-stats and reloads the hostlist on every connection check by default (proven in `hostlist.c`, confirmed live: "Loaded 4 hosts" on reload). A CGI hostlist save applies immediately without restarting the engine.

## Provisioning (install)

`qmanager_dpi_install` downloads from GitHub releases:

1. Fetch `zapret-<tag>` release assets; tag pinned to `DPI_DEFAULT_TAG="v72.13"`.
2. Asset names carry no arch tags — the ARM build lives inside the tarball. Prefer `zapret-<tag>-openwrt-embedded.tar.gz`, fall back to `zapret-<tag>.tar.gz`; both contain `binaries/linux-arm/tpws`.
3. **Two-layer verification**: the release's own `sha256sum.txt` manifest must contain `zapret-<tag>/binaries/linux-arm/tpws` with a sha256 matching the downloaded binary, **and** the binary must match the embedded pin `DPI_PINNED_SHA256` (hash of the official v72.13 linux-arm build). The pin is the identity anchor; the manifest is the freshness check.
4. Installs to `/usrdata/qmanager/bin/tpws` (root-owned), `chmod 755`.

## Rule liveness: the rule cannot outlive the engine

**The REDIRECT rule's lifetime is bound to the tpws PROCESS, not to config intent.** This reverses the earlier contract, under which the rule was installed at `run` time and removed only by an explicit teardown. A dead or never-started engine left the rule in place, and every LAN client's tcp/80 and tcp/443 was redirected at a port with nothing listening on it — including traffic to the modem's own UI, so the user lost both the internet and the QManager page they would have used to turn it off.

The rule now has exactly three writers:

| Hook | Verb | When |
| --- | --- | --- |
| `ExecStartPost` | `qmanager_dpi_run --rule-up` | after tpws starts — waits up to 10s for a proven listener, then inserts |
| `ExecStopPost` | `qmanager_dpi_run --rule-down` | every stop: clean stop, crash, and the attempt that trips `StartLimitBurst` |
| `qmanager-dpi-ensure.timer` | `qmanager_dpi_run --ensure` | every 60s — re-asserts over a **proven-live** listener only (the QCMAP re-dial self-heal) |

`dpi_apply_rule` is **gone from the `run` verb**. `run` also now fails (exit 1) when `dpi_build_args` is empty, which means `bridge0` has no address yet.

> ⚠️ **`--rule-up` and `--rule-down` ALWAYS exit 0, and that is deliberate.** Under `Type=simple`, `ExecStartPost` runs on the **disabled** path too, where no listener will ever appear; a non-zero exit there fails the unit and burns `StartLimitBurst`, so five disable/enable cycles would lock the engine out for the full `StartLimitIntervalSec` hour. It also must not fail on a transient xtables-lock loss during a QCMAP re-dial, which would kill an otherwise healthy engine. If `--rule-up` times out waiting for the bind, it drains the rule and still exits 0.

### The listener probe is tri-state

`dpi_listener_present` returns **0 listening / 1 absent / 2 UNKNOWN**. Unknown is deliberately *not* absent: a caller that treated an unreadable procfs as "dead" would drain a working rule and restart a healthy engine.

- **It reads `/proc/net/tcp`, not `netstat`.** `netstat` exists only at `/opt/bin/netstat`, and `/opt` is an Entware mount that appears ~30s into boot — the probe has to work before that. `/proc/net/tcp` always carries a header row, so **zero lines read is a failure (2), never an empty table**.
- **tpws's transparent-mode listener reports state `8A`, not `0A`.** Measured on RM520N-GL: every ordinary listener (`:22`, `:53`, `:80`, `:443`) reports `0A`, and only tpws reports `8A` (`0x80 | TCP_LISTEN`). `/opt/bin/netstat` cannot name that state either and prints `(null)` in its State column for that row. **Matching `0A` alone reads a healthy engine as dead** — the probe accepts both.
- A wildcard (`00000000`) local address still counts as present: mid-OTA the pre-fix argv may still be running, and draining the rule under it would be a needless outage.

### What each caller does with the three states

- **`--ensure`**, when a mode is enabled: *listening* → assert the rule (this is still the QCMAP re-dial self-heal) plus the `_dpi_reconcile_argv` drift check; *absent* → **drain the rule first**, then attempt `svc_start`, so the LAN is never pointed at a dead port while the restart is in flight; *unknown* → change nothing.
- **`dpi_service_status`** now requires a **listener**, not just a `pgrep`. A live process is not a working engine, and reporting `running` off the `pgrep` alone is what let a dead-on-the-wire engine read as healthy while the LAN was blackholed. An **unknown** probe keeps the old answer, so a procfs hiccup never flashes a false `error`.

> ℹ️ NOTE: **`--ensure` deliberately does NOT call `reset-failed`.** A 60s reset would void the unit's one-hour backoff and hold `NRestarts` at 0 — which, with journald masked to `/dev/null` on this platform, is the only fault signal there is. Recovery from a latched start limit is a **human** act and lives on the CGI enable path instead: `svc_reset_failed qmanager-dpi` then `svc_restart qmanager-dpi`, whose rc is now checked and returns `engine_start_failed` rather than an unconditional success. `svc_reset_failed` lives in `platform.sh`; as `www-data` it runs `sudo -n /usr/bin/qmanager_svc reset-failed qmanager-dpi`. The `qmanager_svc` helper accepts `reset-failed` only for `qmanager-[a-z0-9-]+` units, so `tailscaled` cannot be reset this way.

> ⚠️ **Both CGI enable paths use `svc_restart`, never `svc_start`.** `start` is a no-op on an already-active unit, so a **mode switch** kept serving the previous mode's argv and Full Bypass silently never applied. Same fix in `save` and `save_full_bypass`.

### The legacy drain lives inside the primitive, and must stay there

The pre-2026-09-10 spec (`_DPI_RULE_MATCH_LEGACY`, without the `addrtype` exclusion) is drained by `_dpi_purge_legacy_rule`, which is called from **inside `dpi_remove_rule`** *and* from the **top of `dpi_apply_rule`, before its idempotence check**. Both placements are load-bearing:

- `DPI_RULE_SIG` (`--to-ports $DPI_PORT`) matches the old and the new spec alike, so without an exact-spec legacy drain **ahead of** the check, `dpi_apply_rule` sees a pre-migration rule as "already present" and the `addrtype` exclusion never lands on an OTA'd device.
- The CGI's disable path (`video_optimizer.sh`) and `_dpi_uninstall_run` call `dpi_remove_rule` **directly**. A drain placed in the callers instead of the primitive would miss them and leave the old REDIRECT live with the engine reported off — a LAN outage, not a leak.

## Teardown (uninstall)

**Nothing owns the REDIRECT rule but `dpi_state.sh`.** `qmanager-dpi.service` owns the tpws *process* and, through `ExecStopPost`, the rule's removal; `qmanager-dpi-ensure.timer` only *re-asserts* it over a live listener every 60s. Neither the timer nor a `disable` removes it, and the rule survives a QCMAP iptables flush by re-insertion — so whole-product removal still has to be an explicit act.

**`qmanager_dpi_run --clear` is the authoritative teardown** — it drains **every rule the lib owns**, each via a bounded 16-pass `-D` loop, and then stops `qmanager-dpi`. It is the only supported way to remove them; do not hand-write an `iptables -D` in a caller.

| Drain | Rule | Owner |
| --- | --- | --- |
| `dpi_remove_rule` | `nat PREROUTING` REDIRECT `--to-ports $DPI_PORT` | the engine |
| `dpi_remove_force_tcp_rule` | `filter FORWARD` REJECT `--reject-with icmp-port-unreachable` | the standalone Force-TCP toggle |
| `dpi_purge_legacy_dscp_rule` | `mangle POSTROUTING` DSCP `--set-dscp 0x2e` | upgrade migration (legacy builds) |

**`--clear` is whole-product teardown, not engine teardown**, and the distinction is the whole reason it is safe to drain the two QUIC rules here. It is invoked from exactly **one** site in the tree — `uninstall_rm520n.sh` — so by the time it runs, the intent is "QManager is going away" and no config gate is wanted. The Traffic Engine's own UI uninstall does **not** reach this verb (see below), so an engine-only uninstall still leaves a live user's Force-TCP toggle alone.

**There is no exception, as of 2026-08-30.** `_dpi_uninstall_run` in `qmanager_dpi_install` — the UI-driven `uninstall` verb — calls `dpi_remove_rule` like everyone else, so both uninstall paths run the *same code* rather than two copies kept in sync.

> ⚠️ **The two paths converge on the FUNCTION, not on the VERB — and that seam is load-bearing.** `_dpi_uninstall_run` calls `dpi_remove_rule` **directly**; it must never be "tidied up" into a call to `qmanager_dpi_run --clear`. That refactor would read as harmless deduplication and would silently start draining the standalone QUIC rules on an **engine-only** uninstall, killing a live user's Force-TCP toggle. This used to be caught by section [5] of the now-deleted `scripts/test/dpi-uninstall-path-symmetry.sh` (`scripts/test/` was removed 2026-09-03); there is no harness left to catch a regression here, so review any touch to `_dpi_uninstall_run` against this note by hand.

> **How it got here (F19), and the rule to keep.** `_dpi_uninstall_run` used to hand-write its own two `-D` calls, because it also drained a `nat OUTPUT` rule (`-p tcp --dport 443 -j REDIRECT`) that `dpi_state.sh` does not manage. `dpi_remove_rule` only touches `PREROUTING`, so the two uninstall paths drained different chains: `uninstall_rm520n.sh` → `qmanager_dpi_run --clear` never cleared OUTPUT at all.
>
> The OUTPUT drain was **deleted** rather than promoted into the lib. The decisive fact is that nothing in the tree, and nothing in git history, has ever *inserted* that rule: the `-D` arrived already orphaned in `71db6b9`, the same commit that first wrote `_dpi_uninstall_run`. It was speculative from birth, not a migration for previously-shipped device state — so no real device can be carrying the rule it drained. Promoting it would have put a drain in the shared lib for a rule `dpi_apply_rule` never inserts.
>
> - ⚠️ **If a modem-originated OUTPUT redirect is ever needed again, add it to `dpi_apply_rule` AND `dpi_remove_rule` in the lib — never re-inline it in the installer.** The now-deleted `scripts/test/dpi-uninstall-path-symmetry.sh` (`scripts/test/` was removed 2026-09-03) used to pin both halves: a `nat OUTPUT` insert appearing anywhere, and the table/chain set the two uninstall paths actually drain. There is no harness left to catch either regression — verify by hand against a stubbed or real `iptables` if this area is touched again.
> - **The port is read from `$DPI_PORT`, never restated** — inside the lib and its root callers. The one deliberate exception is the `www-data` firewall helper `qmanager_fw_apply`, which must hardcode `989` to stay an allow-list (see [Architecture](#architecture)). `qmanager_dpi_install` sources `platform.sh` and `dpi_state.sh`, so `run_iptables` and the constant are both in scope. The old inlined drains hardcoded `--to-ports 989` until 2026-08-30 — the same defect as F16 below, and worse here, because a teardown that matches nothing leaves every LAN client redirected to a dead port. This was pinned behaviourally by section [3] of the now-deleted `scripts/test/dpi-rule-signature-port.sh` (`scripts/test/` was removed 2026-09-03), which ran the teardown through a `DPI_PORT`-patched copy of the lib end-to-end. Re-verify by hand on-device if `$DPI_PORT` ever changes.
> - **The drain also got stronger.** The old inlined `-D` fired once; `dpi_remove_rule` loops up to 16 passes, so stacked duplicate rules (what a drifted `DPI_PORT` produces) now clear on the UI path too.

`scripts/uninstall_rm520n.sh` calls it in **Step 1**, beside the three arm-helper `teardown` calls. The ordering is load-bearing: it must run **before Step 3** removes `/usr/bin/qmanager_dpi_run` and the `/usr/lib/qmanager/dpi_state.sh` it sources, and **before Step 5** removes `$QMANAGER_ROOT/bin` (the tpws binary). The call is guarded on `[ -x "$BIN_DIR/qmanager_dpi_run" ]` and `|| true`, so an install that never had the Traffic Engine is a clean no-op.

> ⚠️ WARNING: skipping this teardown is a **LAN outage, not a leak** — in two different ways. Uninstalling with Traffic Engine enabled leaves a `nat` PREROUTING REDIRECT sending every LAN client's tcp/80 and tcp/443 to port 989 with nothing listening on it. Uninstalling with **Force-TCP** on leaves a `filter FORWARD` REJECT killing every LAN client's QUIC (UDP/443). Either breaks LAN traffic until QCMAP next flushes iptables on a re-dial or reboot — and "QCMAP will flush it eventually" is explicitly *not* an acceptable teardown mechanism here (`uninstall_rm520n.sh` says so in its own comment). The now-deleted `scripts/test/installer-teardown-lockstep.sh` (`scripts/test/` was removed 2026-09-03) used to pin this: it discovered every `scripts/usr/bin/qmanager_*` helper exposing a teardown-style verb (`teardown` / `--clear` / `disarm`) and asserted the uninstaller invoked each one. There is no harness left to catch a future helper that grows a teardown arm and forgets the uninstaller — check `uninstall_rm520n.sh` by hand against the helper list when one is added.

> ℹ️ NOTE: `DPI_RULE_SIG` is `"--to-ports $DPI_PORT"` — interpolated, since `e0374dc` (tracker F16). It was a bare literal before that, which meant a future port change would leave `dpi_rule_present()` grepping for the *old* signature: `dpi_apply_rule`'s idempotence check misses, its `-D` drain loop (which matches the *new* spec) removes nothing, and the insert **stacks a second REDIRECT** instead of replacing the first. Moving the port is now a one-line change, but it is still not free — **a device already running the old rule needs a one-shot drain for the old spec**, because nothing on either side of the change matches it any more.

## QUIC handling (Force-TCP, standalone)

The engine is **TCP-only**: `tpws` desyncs TLS/HTTP handshakes, and the transparent REDIRECT rule matches `-p tcp --dports 80,443`. QUIC (UDP 443) passes through untouched, so deprecated builds added an iptables DSCP-marking rule (`--set-dscp 0x2e`, "prioritize" QUIC) alongside the engine. That coupling is **removed**: QUIC is now handled solely by a standalone **Force-TCP** toggle.

- **Config key:** `quic.force_tcp` (0/1) — independent of `video_optimizer` / `full_bypass`.
- **Rule** (idempotent; identified by its `--reject-with icmp-port-unreachable` signature — no `xt_comment` on this kernel):
  `-t filter FORWARD -i bridge0 -p udp --dport 443 -j REJECT --reject-with icmp-port-unreachable`
  REJECTing QUIC makes QUIC-first apps (YouTube, Discord, Instagram) fall back to HTTPS over TCP, where the engine's bypass applies. A LAN-side **REJECT** (not DROP) lets clients fail back on the first packet; DROP would make them wait out QUIC retransmit/PTO timers — a dead-feeling second or two per new host.
- **Independent of the engine, with exactly one exception:** binary install/uninstall and mode enable/disable never touch this rule — but **whole-product uninstall does** (`qmanager_dpi_run --clear`, see Teardown). Removing QManager must not leave a rule behind that only QManager could remove. `qmanager_dpi_run --ensure` reconciles it against `quic.force_tcp` on every 60s pass **outside** the engine's enabled-gate (the timer is unconditionally armed and QCMAP flushes iptables on each re-dial, so the rule self-heals even with the engine off or uninstalled).
- **Upgrade migration:** the same ensure pass drains any leftover `--set-dscp 0x2e` rule (`dpi_purge_legacy_dscp_rule`) from builds that bundled QUIC marking with the engine. `--clear` drains it too, so uninstalling does not strand it on a device that never got an ensure pass in between.
- **CGI:** `POST {"action":"save_force_tcp","enabled":bool}` applies/removes the rule immediately — no binary check, no mode mutex, no service interaction. GET status adds `force_tcp` (config intent) and `force_tcp_active` (rule present) to both section views.
- **UI:** `force-tcp-card.tsx`, its own card beside the Bypass benefit test in the last pair, rendered in every page state — loading, read failure, not installed, and ready. It talks through its own `use-force-tcp` hook with zero coupling to the engine hooks, and toasts its own result.
- **Why drop DSCP rather than keep both?** Marking QUIC only asks the carrier's QoS to prioritize it — it could never route QUIC into tpws's protection (tpws is TCP-only). Keeping an automatic mark would silently re-couple QUIC behavior to the engine and hide that QUIC is otherwise unmanaged. QUIC is now either explicit passthrough (default) or Force-TCP; the tile's copy warns that on a network where QUIC already runs at full speed, forcing TCP can stream slower.

## Verify ("Bypass benefit test")

> ⚠️ **The verify card measures the TECHNIQUE, not the engine — it cannot detect a dead engine.** Renamed from "Test bypass" on 2026-09-10 for exactly this reason. Every leg runs from the modem itself through a throwaway **socks-mode** tpws on `127.0.0.1:19890`: it never crosses `-i bridge0`, so it never touches the REDIRECT rule, the running `qmanager-dpi` unit, or its argv. `curl` reaches it with `--socks5-hostname`, which hands tpws the hostname explicitly — so **no real ClientHello SNI extraction is exercised either**. A passing result therefore says "the bypass technique helps on this connection"; it says nothing about whether the installed engine is listening, running the right mode's argv, or blackholing the LAN. A user trusting a passing test while their LAN was dead is what made the whole liveness hotpatch necessary. Engine health is read from the Engine card ([Status contract](#status-contract)), and every result carries a scope line (`local-network:traffic_engine.verify_scope`) saying so.

`qmanager_dpi_verify` runs the fast.com comparison plus a reference phase: **(0)** a reference sample of the raw connection over speedtest.net (Ookla's JS server API — a `random2000x2000.jpg` burst from the top server), falling back to Cloudflare's documented speed endpoint (`__down?bytes=25000000`) when Ookla is unreachable; **(1)** direct curl download from a freshly fetched Netflix-CDN URL (fast.com's own API) → without-bypass rate; **(2)** the same URL through a throwaway socks-mode tpws instance → with-bypass rate. The reference is the "3rd opinion": it measures the class of traffic ISPs usually do **not** throttle (Ookla/Cloudflare), so a low fast.com beside a healthy reference means real CDN throttling, while a slow reference means the line itself is slow. The throttled verdicts consult it — a slow-but-real connection no longer reads as "throttled" — and if both reference sources are down the verdicts fall back to the old absolute-speed rule, so a broken reference can never falsify a result. **Deliberate deviation from RM551**: the 551 uses the Ookla CLI as its *whole* test, but ISPs throttle by host (streaming CDNs capped while Ookla's servers pass) — fast.com is the traffic class the engine fixes, and Ookla is the baseline, not the signal. The with-bypass socks leg (`DPI_SOCKS_ARGS`) and the live engine now run the **same** tampering recipe: `--oob=tls` was excluded here from the start because it breaks the socks path, and was dropped from the live engine in `3b9cdf7` for breaking real connections — so this is no longer a deviation to keep in mind. The real engine is never touched — no state, no rules, no restore trap beyond killing the socks instance. Result (without/with/reference + improvement factor, `reference.source` = `speedtest`|`cloudflare`) is written to `/tmp/qmanager_dpi_verify.json` and polled by the UI. The UI gate is only `binary_installed` — the engine does not need to be running.

## Status contract

`GET /cgi-bin/quecmanager/network/video_optimizer.sh` (with `?section=full_bypass` for the Full Bypass view) returns: `enabled` (config intent), `status` (`running`/`stopped`, plus `restarting`/`error` when systemd permits the follow-up query), `uptime`, `packets_processed`, `domains_loaded`, `binary_installed`, `kernel_module_loaded` (rule present), `force_tcp`, `force_tcp_active`. Full contract in `docs/API-REFERENCE.md`.

`status` is **`running` only with a proven listener**: `dpi_service_status` anchors a `pgrep` on `$DPI_BINARY` and then calls `dpi_listener_present` — absent (1) reports `error`, unknown (2) keeps `running`. With no process at all it falls back to `systemctl show -p ActiveState` for the degraded labels (`activating` → `restarting`, `failed` → `error`, else `stopped`). See [The listener probe is tri-state](#the-listener-probe-is-tri-state) for the `8A` state and why the probe reads `/proc/net/tcp` rather than `netstat`. The `save`/`save_full_bypass` enable path can also return `engine_start_failed` when the restart is refused.

`kernel_module_loaded` is a legacy name from the nfqws era. On this platform it means **the REDIRECT rule is present** (`dpi_rule_present`), and the UI reads it that way (`ruleOk` in `traffic-engine.tsx`).

## Platform / ISP findings (tested on pilot, AT&T Wireless)

- The pilot ISP throttles **by host/SNI for streaming CDNs**: fast.com (Netflix CDN) reads 2.4 Mbps on the bare path and ~30 Mbps with the tampered handshake — measured from the modem itself, direct vs socks-tpws, same signed CDN URL. Some other destinations (kernel.org, tele2) measured as IP-throttled — the engine defeats SNI-based DPI; it is not a general VPN.
- RM520N kernel lacks `xt_comment` and `xt_owner` (rule identification is by signature, see above).
- **NFQUEUE drops every queued packet on RM520N-GL (kernel 5.4.210), so RM551E's nfqws Masquerade is parked.** Measured 2026-11-01 on 61368cd2 with zapret v72.13 `linux-arm/nfqws` (static, sha256 `a6281e65…3058`). The rule installs (the kernel has NFQUEUE, `u32` and `mark`, but no `connbytes`), and nfqws binds queue 200. But every matched packet is lost before delivery: the `nfnetlink_queue` sequence number stays 0, `nfqws --debug=1` logs no packet, and HTTPS hangs. This is the same in mangle `POSTROUTING -o rmnet+` and in `OUTPUT`. `--queue-bypass` does not help, because it covers only "no listener bound". Forwarded LAN traffic fails the same way (re-measured 2026-11-03 with a GL.iNet GLx2000 behind `bridge0`, rule scoped to one client and one destination): the SYN hits the rule, the queue sequence stays 0, and TCP and ICMP both lose 100%, in mangle `FORWARD` and `PREROUTING` and in filter `FORWARD`. During a following raw `PREROUTING` NFQUEUE phase the modem rebooted with no crash record; the cause is unproven, so do not retry NFQUEUE on a device someone relies on. The unmerged backend (mode, CGI, `qmanager_fw_apply` token shape, pinned installer) is on branch `claude/te-masquerade-nfqws` (802e78c0) if a later kernel or firmware changes this. One thing to know before retrying: iptables-legacy prints "No chain/target/match by that name" for `-C` against an absent NFQUEUE rule, which is not a missing kernel target.
- tpws hot-reloads the hostlist per-connection; no restart needed on hostlist save.
- **Status reads are privilege-free by design.** Unprivileged `systemctl show` is a per-model lottery: allowed on RM520N, denied outright on sibling builds such as RM502Q-GL, and www-data has no privileged way to run it either: its only systemctl grants are four exact `tailscaled` lines, and the `qmanager_svc` helper has no `show` verb. `dpi_service_status` therefore probes tpws liveness with an anchored pgrep on the binary path (hardcoded fallback, since some builds ship `$DPI_BINARY` empty), confirms it with the `/proc/net/tcp` listener read, and consults systemd only to label degraded states. Uptime derives from `/proc/<pid>/stat` starttime jiffies vs `/proc/uptime`. Validated live on RM520N v0.1.14 + RM502Q-GL fleet.
- **tpws's listener reports `8A` in `/proc/net/tcp`, not `0A` — RM520N-GL, kernel 5.4.210.** Every ordinary listener on the device (`:22`, `:53`, `:80`, `:443`) reports `0A`; only tpws's transparent-mode socket reports `8A` (`0x80 | TCP_LISTEN`), and `/opt/bin/netstat` prints `(null)` in its State column for that row. Not confirmed on RG501Q-EU (see `docs/reference/platform-matrix.md`); the probe accepts both states, so a device reporting only `0A` reads correctly either way.

## The UI (rebuilt 2026-11-01)

The page was rebuilt to the RM551E v0.1.34 layout (Engine card + mode cards), on this platform's two tpws modes. **No backend contract changed** — same endpoint, actions, fields, 2 s hook poll and CGI-enforced mutex — so everything above this section still holds.

Retired in that rebuild, do not look for them: `live-strip.tsx`, `targets-card.tsx`, `onboarding.tsx` (now `engine-onboarding.tsx`), the three-row mode radiogroup, and the `ModeCardSkeleton` / `TargetsCardSkeleton` / `CARD_PAIR` / `HOST_ROW` geometry.

### Layout

`traffic-engine.tsx` composes, top to bottom:

| Block | File | Content |
| --- | --- | --- |
| Page header | `traffic-engine.tsx` | Title, description, Refresh pill |
| Banners, only while they apply | `traffic-engine.tsx` | Stale poll (`stale`, Retry); failed uninstall (`stale`, Dismiss); redirect rule missing (`degraded`) |
| Engine card (the `rounded-hero` anchor) | `engine-card.tsx` | **Live view:** Off / Video Optimizer / Full Bypass `SegmentedField` (a `Select` on a narrow card), Bypass Hotspot row, uptime, new connections, a Package drill row; connections chart on the right from `@[46rem]/card`. **Package view:** rule state, engine, source, Remove behind an `AlertDialog` |
| Mode pair | `mode-card.tsx` | `VideoOptimizerCard`, `FullBypassCard`: handshake diagram (`handshake-strip.tsx`), two metric rows (`metric-row.tsx`), a `CardFoot` |
| Last pair | `verify-card.tsx`, `force-tcp-card.tsx` | Bypass benefit test; QUIC Force-TCP |

Not installed: `EngineOnboarding` plus the Force-TCP card. Read failed with nothing cached: a destructive condition card plus Force-TCP. Loading: the page skeleton plus `VerifyCardSkeleton` and the real Force-TCP card. Pairs use `PAIR` in `shapes.ts` (`items-stretch` + `*:data-[slot=card]:h-full`, two columns from `@4xl/main`).

In-card views (Engine → Package, Video Optimizer → Hostnames) swap the card body in place through `card-view.tsx`; Back sits in the header and takes focus on mount.

### One derived mode

The shell computes `configMode` once: `full_bypass` when `fb.data.enabled`, else `video` when `vo.data.enabled`, else `null`. Every child receives it resolved; none infers a mode from a payload's shape (that inference was the 2026-08 "Domains loaded under Full Bypass" bug).

- The UI's `EngineMode` names are `video` and `full_bypass` — the `?mode=` deep-link names. The wire `DpiMode` (`types/traffic-engine.ts`) is `video_optimizer` / `full_bypass` / `none`. Do not mix them.
- `status`, `uptime`, `packets_processed`, `binary_installed` and `kernel_module_loaded` are **engine-global** (one tpws, one rule), so the shell reads `vo.data ?? fb.data` for them. Using that fallback to pick the *mode* is what was wrong before.
- `?mode=` acts once, after the first ready render: it scrolls `modeCardId(mode)` into view (`auto` under reduced motion) and highlights it for 1.6 s. The route wraps the page in `Suspense` because `useSearchParams` needs one in a static export.

### Engine changes

Every mode change goes through `run()` in `traffic-engine.tsx`: set `pending` (`start` / `stop` / `switch` plus target), await the hook's `MutationResult`, fire one toast (the failure description is `result.error`), then `refreshEngine(true)` — **both** sections, silently, on failure too, because the backend mutex may have changed the other section.

- `pending` makes the control show the target and the card show a Starting / Stopping / Switching chip. It clears when the poll's `configMode` equals the target, or after `PENDING_TIMEOUT_MS` (8 s) so a poll that never confirms cannot strand it.
- While `pending` is set the mode control and Remove are disabled, the mode cards' `active` is false, and the rule banner is suppressed.
- Off writes only the section that owns the engine (`saveEnabled(false)` or `save(false, …)`).

> ⚠️ WARNING: **post-write refetches must stay silent.** A non-silent `refresh()` sets `isLoading`, the shell renders the skeleton, and every card unmounts: a running Bypass benefit test loses its poll loop (the backend worker carries on, the card comes back idle), and an unapplied hostname draft is lost. `refresh(silent?: boolean)` is on all three read hooks (`use-video-optimizer`, `use-full-bypass`, `use-cdn-hostlist`) for this reason.
>
> The header Refresh pill is silent: a running test keeps its poll loop, and the hostname draft keeps pending edits (`useHostlistDraft` adopts a re-read list only when the draft has none). The Retry buttons after a failed read are non-silent and show the loading state; nothing editable is on screen then.

### The redirect-rule banner

The `degraded` banner shows only when the mode runs, `kernel_module_loaded` is false, and nothing is pending. The ensure timer re-inserts the rule within 60 s over a live listener, so after a QCMAP re-dial flushes iptables the banner can appear briefly and clear on its own. The Package view shows the rule state at all times.

### The packet chart

`packet-chart.tsx` draws `CHART_SAMPLES` = 30 samples, one per poll. Each sample is the change in `packets_processed` divided by `POLL_SECONDS` (2) in `traffic-engine.tsx`. A new sample is taken when `source` changes identity (every fetch is a new object). The history resets on stop and on a mode change; a negative delta clamps to 0.

> ℹ️ NOTE: three limits on what the number means. `packets_processed` is the REDIRECT rule's counter in the `nat` table, and netfilter sends only the first packet of each connection through `nat`, so it counts **redirected connections, not packets** (standard netfilter behaviour; not separately measured on the device). The divisor is the nominal 2 s, while real spacing is 2 s plus the GET round trip, so the rate reads slightly high. A rule re-insert (stop/start, QCMAP flush) resets the counter, which shows as one zero sample.

### Bypass Hotspot row

`bypass-hotspot-row.tsx` is a shortcut onto the global TTL/HL setting, through `useTtlSettings` (owned by the shell so the Engine card's view swaps never refetch it). On writes TTL 64 / HL 64, Off writes 0 / 0. Any other active value belongs to the TTL page or a SIM profile, so the row is disabled and says so. Backend and invariants: [`ttl-mtu.md`](./ttl-mtu.md).

### The Video Optimizer card and the hostname draft

The main view shows the handshake diagram, a "Carrier reads" row and an "Acts on N domains" drill row that opens the Hostnames view. Hostnames are grouped by service with `groupDomains` from `video-services.ts` (unknown domains first, then the services in `VIDEO_SERVICES` order). `VIDEO_SERVICES` mirrors the default list `qmanager_setup` seeds — change both together.

**Hostname edits are a draft, committed from the Video Optimizer card's foot.** `useHostlistDraft` (`hostnames-view.tsx`) is owned by the card, so the draft survives Back. Add, remove and import edit the draft only; Apply sends the whole list in one `save_hostlist` POST, and the hook re-reads the list from the device. This replaced the retired targets card's POST on every add or remove.

- Whenever the hook delivers a new `domains` array — first load, save, restore, any refetch — the draft is replaced by it.
- **Apply is not blocked while Full Bypass owns the engine.** The list is stored independently of the mode and tpws re-reads it per connection. The foot says when the edit takes effect instead (`foot_hosts_live`, `foot_switch_to_apply`, `foot_on_enable`), and the Hostnames view shows a "Not in use" info chip.
- The client mirrors the CGI's limits (`MAX_DOMAINS` 300, 253 characters, `[a-z0-9._-]` with at least one dot) because `save_hostlist` is all-or-nothing: one bad entry rejects the whole write.
- **Import** (≤ 256 KB) strips `#` comments and blanks, lowercases, drops invalid entries, dedupes against the draft and caps at 300. It merges into the draft, never replaces it, and toasts only when lines were lost or nothing was added. **Export** writes `# QManager Video Optimizer hostlist` then one domain per line — the device's own file format — so a round trip is lossless.
- **Restore defaults** is a direct write, not a draft: `restore_hostlist` copies the factory file, and the confirm names `defaultDomains.length`.

> ⚠️ WARNING: **the client is the only guard against an empty list.** Apply is disabled when the draft is empty (`invalid: draft.length === 0`). The CGI does not refuse `[]`: `.domains // empty` passes an empty array (jq treats `[]` as true), `length <= 300` passes, the validation loop runs zero times, and a header-only file is written — Video Optimizer then matches nothing. (Read from the CGI source, not run on a device.)

### The Full Bypass card

No setting of its own (tpws has no SNI to choose), so no draft: its `CardFoot` carries only the ownership line. Both mode feet show the same ownership sentence at rest (`foot_owner` / `foot_other_owns` / `foot_idle`) so the pair reads alike.

### The Bypass benefit test card

Same `verify` POST, `verify_status` poll and 12-minute window as before. Rows on one shared scale; the faster of "with" and "without" bypass is promoted, and the line-speed reference shares the scale but never competes. Idle, running and not-installed render a resting block (`RESTING` in `shapes.ts`) with the run action inside it; once a result exists the action moves to the header as "Run test again", so there is only ever one.

### Geometry

`components/local-network/traffic-engine/shapes.ts` is the family's own module, ported from the RM551E v0.1.34 family. Restate geometry there; never import it from `components/cellular/` or another `/local-network/` family. Skeletons import the same constants as the loaded views.

## Files

- `scripts/usr/lib/qmanager/dpi_state.sh` — helpers (args build, rule ensure/remove, status probes, mode detection)
- `scripts/usr/bin/qmanager_dpi_run` — engine supervisor. Verbs: `run` (default), `--ensure`, `--rule-up`, `--rule-down`, `--clear`. There is no `--start` / `--stop`; the CGI reaches the engine through systemd.
- `scripts/etc/systemd/system/qmanager-dpi.service` — `ExecStart` / `ExecStartPost` / `ExecStopPost` (see [Rule liveness](#rule-liveness-the-rule-cannot-outlive-the-engine))
- `scripts/usr/lib/qmanager/platform.sh` — `svc_reset_failed` and `run_iptables`; as `www-data` they go through the root helpers `qmanager_svc` and `qmanager_fw_apply` (one bare-path grant each in `scripts/etc/sudoers.d/qmanager`)
- `scripts/usr/bin/qmanager_fw_apply` — iptables allow-list for `www-data` callers; holds its own copies of the engine rule specs (see [Architecture](#architecture))
- `scripts/usr/bin/qmanager_dpi_install` — binary provisioning (pin + manifest verification)
- `scripts/usr/bin/qmanager_dpi_verify` — speed comparison helper (fast.com + speedtest.net/Cloudflare reference)
- `scripts/uninstall_rm520n.sh` — Step 1 calls `qmanager_dpi_run --clear` (see Teardown)
- `scripts/www/cgi-bin/quecmanager/network/video_optimizer.sh` — CGI (status / save / save_full_bypass / save_force_tcp / verify / install / uninstall / save_hostlist / restore_hostlist)
- `app/local-network/traffic-engine/page.tsx` — thin route; wraps the shell in `Suspense` for `?mode=`
- `components/local-network/traffic-engine/` — shell `traffic-engine.tsx`; `engine-card.tsx`, `bypass-hotspot-row.tsx`, `packet-chart.tsx`, `engine-onboarding.tsx`, `result-alert.tsx`; `mode-card.tsx`, `handshake-strip.tsx`, `hostnames-view.tsx`, `video-services.ts`; `verify-card.tsx`, `force-tcp-card.tsx`; shared `card-view.tsx`, `metric-row.tsx`, `shapes.ts` (see [The UI](#the-ui-rebuilt-2026-11-01))
- `hooks/use-video-optimizer.ts`, `hooks/use-full-bypass.ts`, `hooks/use-force-tcp.ts`, `hooks/use-cdn-hostlist.ts` — every write returns `MutationResult` (`{ ok, error }`), so the caller toasts the call's own failure reason
- `public/locales/<lang>/local-network.json` — `traffic_engine.*`

`scripts/test/` was deleted 2026-09-03. It used to hold four harnesses covering this feature: `installer-teardown-lockstep.sh` (the uninstaller invokes every teardown-style verb), `dpi-rule-signature-port.sh` (`DPI_RULE_SIG` and the `_dpi_uninstall_run` teardown track `$DPI_PORT`), `dpi-uninstall-path-symmetry.sh` (the UI and full-device uninstall paths drain the same chains, and `--clear` drains all three rules the lib owns), and `traffic-engine-design-language.sh` (the 2026-08-31 surface, since replaced). None of them are runnable any more — the invariants they pinned are documented at their call sites above; prove a touch to this feature by running it on the device and loading the Traffic Engine page.
