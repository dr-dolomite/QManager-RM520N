# Traffic Engine (DPI bypass) — Video Optimizer & Full Bypass

The Traffic Engine re-ports the RM551-era "Video Optimizer / Traffic Masquerade" DPI bypass to the RM520N-GL using **zapret's `tpws`** (the transparent-proxy mode) instead of the RM551's `nfqws` (netfilter queue mode). The RM551 implementation was removed in the dev-rm520 branch (nftables/fw4 dependency, ARM32 nfqws unvalidated); tpws runs as a plain userspace proxy on vanilla Linux, so the RM520's iptables REDIRECT is enough.

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

The two modes are **mutually exclusive** (CGI-enforced; enabling one disables the other), and they differ in **scope, not technique** — which is the whole content of the distinction, and the reason for the name. `sni_domain` is accepted and stored for API-contract compatibility with the RM551, but is **inert**: tpws has no fake-ClientHello mode (that is nfqws-only), so there is nothing to put a spoofed name into.

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
| i18n | `trafficEngine.mode.masquerade{,_hint}`, `.toast_masquerade` | `.full_bypass{,_hint}`, `.toast_full_bypass` |

> ⚠️ **The persisted config section is renamed, and `config.sh` has no migration primitive.** `qm_config_init` only *seeds* an empty file — it returns early the moment `$QM_CONFIG` is non-empty. Every already-deployed device therefore keeps its `traffic_masquerade` section, and a renamed reader would find nothing, fall back to its default, and switch the mode **off** on a user who had it on: no error, no log line, nothing observable. `migrate_traffic_masquerade_to_full_bypass()` in `install_rm520n.sh` (called from `install_backend()`, right after `migrate_watchcat_fail_threshold`) copies both keys across and retires the old section. It is idempotent, runs on every install and OTA, and takes `|| true` on every write because `install_backend` runs under `set -e`. This was pinned behaviourally by the now-deleted `scripts/test/full-bypass-config-migration.sh` (`scripts/test/` was removed 2026-09-03) — verify the migration on-device: check for a stray `traffic_masquerade` section after an OTA from an older build.
>
> Retiring the section needed a new primitive: `qm_config_delete` is **key**-scoped, so using it would have left `"traffic_masquerade": {}` behind on every device. `qm_config_delete_section` in `config.sh` mirrors its gated-`mv` pattern.

**Two sites still spell it the old way, deliberately:**

1. **The CGI accepts `?section=masquerade` and `action=save_masquerade` as deprecated aliases, for one release.** An OTA replaces the CGI and the JS bundle together, so a *device* is never half-updated — but a browser tab left open across the OTA still holds the old bundle, and its next write would return `unknown_action`. Remove the aliases once no supported upgrade path can still be serving the old bundle (there is no harness left to update alongside them — `scripts/test/` was deleted 2026-09-03).
2. **`_dpi_uninstall_run`'s config cleanup drains both names** (`del(.video_optimizer, .full_bypass, .traffic_masquerade)`). It is a teardown that can run on a device which has not taken the installer migration — a UI uninstall needs no OTA — and `del()` on an absent key is free. Every **read** site was renamed outright; only this drain is bilingual.

Historical prose in `dpi_state.sh`'s header and `targets-card.tsx`'s finding-17 note still says "Traffic Masquerade", because both describe the RM551E feature or the file's own past. Renaming those would make the comments false rather than current.

The rename was pinned across all four layers by the now-deleted `scripts/test/traffic-engine-design-language.sh` section [31] (`scripts/test/` was removed 2026-09-03), including an i18n assertion that each locale's `targets.idle_*` prose no longer contains that locale's own word for the retired mode. Re-check by grepping each locale's `targets.idle_*` strings by hand — a key swap without a real re-translation is the failure mode this used to catch.

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
- **UI:** a standalone tile at the very bottom of the Traffic Engine page (below onboarding and the Bypass benefit test card), rendered in every page state — including before the engine is installed. It talks through its own `use-force-tcp` hook with zero coupling to the engine hooks.
- **Why drop DSCP rather than keep both?** Marking QUIC only asks the carrier's QoS to prioritize it — it could never route QUIC into tpws's protection (tpws is TCP-only). Keeping an automatic mark would silently re-couple QUIC behavior to the engine and hide that QUIC is otherwise unmanaged. QUIC is now either explicit passthrough (default) or Force-TCP; the tile's copy warns that on a network where QUIC already runs at full speed, forcing TCP can stream slower.

## Verify ("Bypass benefit test")

> ⚠️ **The verify card measures the TECHNIQUE, not the engine — it cannot detect a dead engine.** Renamed from "Test bypass" on 2026-09-10 for exactly this reason. Every leg runs from the modem itself through a throwaway **socks-mode** tpws on `127.0.0.1:19890`: it never crosses `-i bridge0`, so it never touches the REDIRECT rule, the running `qmanager-dpi` unit, or its argv. `curl` reaches it with `--socks5-hostname`, which hands tpws the hostname explicitly — so **no real ClientHello SNI extraction is exercised either**. A passing result therefore says "the bypass technique helps on this connection"; it says nothing about whether the installed engine is listening, running the right mode's argv, or blackholing the LAN. A user trusting a passing test while their LAN was dead is what made the whole liveness hotpatch necessary. Engine health is read from the live tile strip ([Status contract](#status-contract)), and the card carries an unconditional scope line (`trafficEngine.verify.scope`) saying so.

`qmanager_dpi_verify` runs the fast.com comparison plus a reference phase: **(0)** a reference sample of the raw connection over speedtest.net (Ookla's JS server API — a `random2000x2000.jpg` burst from the top server), falling back to Cloudflare's documented speed endpoint (`__down?bytes=25000000`) when Ookla is unreachable; **(1)** direct curl download from a freshly fetched Netflix-CDN URL (fast.com's own API) → without-bypass rate; **(2)** the same URL through a throwaway socks-mode tpws instance → with-bypass rate. The reference is the "3rd opinion": it measures the class of traffic ISPs usually do **not** throttle (Ookla/Cloudflare), so a low fast.com beside a healthy reference means real CDN throttling, while a slow reference means the line itself is slow. The throttled verdicts consult it — a slow-but-real connection no longer reads as "throttled" — and if both reference sources are down the verdicts fall back to the old absolute-speed rule, so a broken reference can never falsify a result. **Deliberate deviation from RM551**: the 551 uses the Ookla CLI as its *whole* test, but ISPs throttle by host (streaming CDNs capped while Ookla's servers pass) — fast.com is the traffic class the engine fixes, and Ookla is the baseline, not the signal. The with-bypass socks leg (`DPI_SOCKS_ARGS`) and the live engine now run the **same** tampering recipe: `--oob=tls` was excluded here from the start because it breaks the socks path, and was dropped from the live engine in `3b9cdf7` for breaking real connections — so this is no longer a deviation to keep in mind. The real engine is never touched — no state, no rules, no restore trap beyond killing the socks instance. Result (without/with/reference + improvement factor, `reference.source` = `speedtest`|`cloudflare`) is written to `/tmp/qmanager_dpi_verify.json` and polled by the UI. The UI gate is only `binary_installed` — the engine does not need to be running.

## Status contract

`GET /cgi-bin/quecmanager/network/video_optimizer.sh` (with `?section=full_bypass` for the Full Bypass view) returns: `enabled` (config intent), `status` (`running`/`stopped`, plus `restarting`/`error` when systemd permits the follow-up query), `uptime`, `packets_processed`, `domains_loaded`, `binary_installed`, `kernel_module_loaded` (rule present), `force_tcp`, `force_tcp_active`. Full contract in `docs/API-REFERENCE.md`.

`status` is **`running` only with a proven listener**: `dpi_service_status` anchors a `pgrep` on `$DPI_BINARY` and then calls `dpi_listener_present` — absent (1) reports `error`, unknown (2) keeps `running`. With no process at all it falls back to `systemctl show -p ActiveState` for the degraded labels (`activating` → `restarting`, `failed` → `error`, else `stopped`). See [The listener probe is tri-state](#the-listener-probe-is-tri-state) for the `8A` state and why the probe reads `/proc/net/tcp` rather than `netstat`. The `save`/`save_full_bypass` enable path can also return `engine_start_failed` when the restart is refused.

## Platform / ISP findings (tested on pilot, AT&T Wireless)

- The pilot ISP throttles **by host/SNI for streaming CDNs**: fast.com (Netflix CDN) reads 2.4 Mbps on the bare path and ~30 Mbps with the tampered handshake — measured from the modem itself, direct vs socks-tpws, same signed CDN URL. Some other destinations (kernel.org, tele2) measured as IP-throttled — the engine defeats SNI-based DPI; it is not a general VPN.
- RM520N kernel lacks `xt_comment` and `xt_owner` (rule identification is by signature, see above).
- tpws hot-reloads the hostlist per-connection; no restart needed on hostlist save.
- **Status reads are privilege-free by design.** Unprivileged `systemctl show` is a per-model lottery: allowed on RM520N, denied outright on sibling builds such as RM502Q-GL, and www-data has no privileged way to run it either: its only systemctl grants are four exact `tailscaled` lines, and the `qmanager_svc` helper has no `show` verb. `dpi_service_status` therefore probes tpws liveness with an anchored pgrep on the binary path (hardcoded fallback, since some builds ship `$DPI_BINARY` empty), confirms it with the `/proc/net/tcp` listener read, and consults systemd only to label degraded states. Uptime derives from `/proc/<pid>/stat` starttime jiffies vs `/proc/uptime`. Validated live on RM520N v0.1.14 + RM502Q-GL fleet.
- **tpws's listener reports `8A` in `/proc/net/tcp`, not `0A` — RM520N-GL, kernel 5.4.210.** Every ordinary listener on the device (`:22`, `:53`, `:80`, `:443`) reports `0A`; only tpws's transparent-mode socket reports `8A` (`0x80 | TCP_LISTEN`), and `/opt/bin/netstat` prints `(null)` in its State column for that row. Not confirmed on RG501Q-EU (see `docs/reference/platform-matrix.md`); the probe accepts both states, so a device reporting only `0A` reads correctly either way.

## The UI (re-authored 2026-08-31)

The surface was rebuilt onto the finalized design language. **No backend contract changed** — same endpoint, same actions, same response fields, same 2s cadence, same CGI-enforced mutex — so everything above this section is unaffected. What changed is the shape, and two of the changes are correctness rather than style.

**The page is ordered by cadence, not by config key.** Page header → live tile strip → the two-up band (**Bypass mode beside Bypass benefit test**) → Optimizer targets → QUIC Force-TCP. Force-TCP stays last for the reason given under [QUIC handling](#quic-handling-force-tcp-standalone): its independence is deliberate and the position states it.

> ℹ️ NOTE: that cadence changed in the [polish pass](#the-polish-pass-second-round-2026-08-31) below. The retired order was a single column — strip, decision, what the decision operates on, then the occasional test. `traffic-engine.tsx`'s own header comment was rewritten along with the layout, because a file describing an order it no longer has is worse than one describing none.

**One derived `mode`, and nothing below infers its own.** `traffic-engine.tsx` computes `mode: DpiMode` once from the two sections' `enabled` flags and passes it down. This replaced `videoOptimizer.data ?? masquerade.data` followed by a `"sni_domain" in data` shape sniff in the status card — and that combination was a live bug: both hooks fetch, so the Video Optimizer payload essentially always won, and with **masquerade** enabled the card rendered the Video Optimizer layout and reported "Domains loaded" for a mode that has no domain list.

The four LIVE fields are read differently and deliberately so: `status`, `uptime`, `packets_processed` and `kernel_module_loaded` are **engine-global** — one tpws process, one REDIRECT rule, both sections reporting the same ones — so the shell takes whichever section read succeeded. That fallback was never the bug; using it to decide the *mode* was.

**The two modes are one three-way selector**, not tabs. They are mutually exclusive by construction (see [Modes](#modes)) and tabs say "two independent panes you may browse", so the mutex only ever surfaced as a surprise dialog at toggle time. The takeover confirm survives with a different job — it guards "this restarts the engine" — and fires **only on a mode→mode switch**, which is the only transition that actually restarts anything.

**The target list stays mounted while Full Bypass owns the engine**, and says why. It used to unmount with its tab, so the interface's only statement about a list that is still stored and still applies on switching back was its absence. The count chip switches from "N of 300" to "N saved" with it. The editor is not disabled either: the list is stored independently of the mode and tpws re-reads it per connection, so editing it is legitimate — what would be dishonest is implying the edits take effect right now.

**The verify result is a comparison, not a list.** Three rows on one shared 0–100 scale whose ceiling is the fastest of the three samples, so "did the bypass help" is read by bar length. The winner is promoted to `primary-container` and its numeral drops ramp ink for `on-primary-container`. **The line-speed row shares the scale but can never be the winner** — it is the reference (see [Verify](#verify-bypass-benefit-test)), not a contestant.

**Geometry lives in `components/local-network/traffic-engine/shapes.ts`** — the family's only shapes module, and the second under `/local-network/` after `ethernet/shapes.ts`. Restate geometry there; never import it from `components/cellular/`. Two values in it are load-bearing and are documented in place: the tile height is **pinned** (`h-[6.5rem]`) because a skeleton mirrors it and a floor cannot be a mirror, and there is deliberately **no `min-h-` anywhere in the file** — every other box sizes to its content, because a mode hint and the idle explanation both wrap on a narrow container.

The polish pass added to it: `CARD_PAIR` / `CARD_PAIR_WIDE` (the two-up band and its full-width member — see [The layout contract](#the-layout-contract)); `HOST_ROW.VIEWPORT` / `HOST_ROW.GRID` plus `HOST_VISIBLE_ROWS` (the capped, multi-column target list — the skeleton draws `HOST_VISIBLE_ROWS` blocks through the same two constants, so the skeleton→content handoff cannot jump, and the harness fails the file if any of those numbers is restated inline); `ICON_ACTION` (the 40px icon-only card action for import/export/restore — 40px is `HOST_ROW.ROOT`'s own height rather than a new number, and deliberately above the 32px per-row remove control); and `CARD_HEAD.ROOT_WRAP` / `CARD_HEAD.ACTIONS_WRAP` (the plain `ACTIONS` is `flex-none` and never shrinks, so on a narrow card a four-control group takes the width it wants and `CARD_TITLE` — which wraps by design rather than truncating — absorbs the entire loss).

> ℹ️ NOTE — **open item, not a solved one.** `HOST_ROW.VIEWPORT` themes its own scrollbar (`[scrollbar-width:thin]` plus a `scrollbar-color` on `surface-container-high`, one step from the card ground in both themes) because **nothing themes scrollbars product-wide**: `globals.css` carries no `::-webkit-scrollbar` or `scrollbar-color` declaration at all, and two other files have already worked around that ad hoc with a bare thin-width declaration. Scoping the fix to this module was deliberate — a global scrollbar token is a product decision and a polish pass is the wrong place to make one — so the gap is still open, and the third ad-hoc workaround is the point at which to close it properly. When checking one of these, read the **computed** `scrollbar-color`: a `var()` that fails to resolve ships as no declaration at all and reports nothing.

Two departures from the approved comp, both documented at their call sites: the Processed and Scope discs are **neutral** rather than `downlink`/`spatial` (a packet count and a hostlist size are counts, and giving a direction hue a second meaning is the failure `globals.css` records having already removed once), and the winning bar keeps its ramp fill rather than the comp's `on-primary-container` mix, because expressing that would mean minting a tone on the shared `MetricBar` for one call site.

This was pinned by `scripts/test/traffic-engine-design-language.sh` (sections [0]–[18], committed red in `3338d48` before the fix landed in `0fdfc65`) — historical record only; `scripts/test/` was deleted 2026-09-03 and the harness is no longer re-runnable. Prove the surface now by loading the Traffic Engine page.

## The polish pass (second round, 2026-08-31)

Five user reports plus three defects a devil's-advocate pass found while attacking the plan written for them, then **a third round of two more reports** (R6 the height pair, R7 the skeleton) recorded in the last two sections below. **No backend contract changed in any of them** — same endpoint, same actions, same fields. Sections [19]–[28] of the harness were committed red in `a7b5d72` and [23]/[29]/[30] in `2996d2d`; the file now stands at 30 sections and 130 assertions.

### The silent-refetch contract

`selectMode` refetches both sections **silently**. `retry()` stays **non-silent** and is wired only to the two read-failure banners' Retry buttons. They are opposite on purpose, and the opposition is the fix.

The report was "switching Bypass Mode has no animation, it just refreshes then shows the toasts", which reads as a missing spinner. It was not one. `selectMode` ended in `retry()`; `retry` calls `refresh()` on both hooks; `refresh` **is** `fetchStatus`, whose `silent` parameter defaults to `false`. Both hooks therefore set `isLoading`, the shell took its loading branch instead of its content branch, and the live strip, the mode card, the targets card and the verify card were all **destroyed and rebuilt** for two CGI round-trips. There was never a missing spinner — there was nothing left on screen to put one in.

> ⚠️ WARNING: the obvious tidy-up is to collapse these back into one call. Do not. What breaks:
>
> - **A post-write reconcile that is not silent tears down the page it is reconciling.** That is the original defect, returning verbatim, and it presents as "no animation" rather than as an unmount — so it will not be reported as what it is a second time either.
> - **It also kills a running Bypass benefit test.** `VerifyCard` holds `isRunning`, its result and its poll loop in local state, and the loop aborts on `!mountedRef.current` — so an unmount throws away up to twelve minutes of measurement, the card returns reading "idle" without saying anything was lost, and the backend worker carries on regardless. This has no separate fix and no separate assertion: the silent refetch *is* the fix. The two-up band makes a mid-test mode switch **more** likely, not less.
> - **Conversely, making `retry()` silent breaks the banners.** Someone pressing Retry after a failed read is asking to *see* the read happen; a button that changes nothing on screen reads as a button that did nothing.

**`refresh` takes an optional silent flag on both status hooks** — `refresh: (silent?: boolean) => void` in `hooks/use-video-optimizer.ts` and `hooks/use-full-bypass.ts`. It is part of the published signature rather than an internal convenience, because the shell has to silence **both** halves of a mode-switch refetch; a hook that could not would leave half the page tearing down anyway. `use-cdn-hostlist`'s `refresh` is unchanged — nothing refetches it mid-write.

**Which mode is pending, not merely that one is.** `ModeCard` now takes `pendingMode: DpiMode | null` in place of `isSwitching: boolean`. A boolean cannot name one of three rows, so the flag was spent entirely on `disabled`, which fired the group-wide dim on all three rows equally and erased the signal it was meant to carry. The two non-pending rows take the real `disabled` attribute and inherit the primitive's dim for free; the pending row takes `aria-disabled` so it stays at full strength and holds the spinner, kept inert by `commit`'s existing `isSaving` guard. Two deliberate omissions, both recorded at their call sites: the pending row is **not** painted as selected (a status surface reports what is actually running, never the half-edited form — and on failure `selectMode` returns before the refetch, so an optimistic mark would visibly snap back), and there is **no synthetic "Switching" chip** in the card header, because `restarting` is already a real `DpiEngineStatus` member rendered by `ENGINE_BADGE` here and by `ENGINE_SPEC` in `live-strip.tsx`, and a second answer to one question is the exact defect this surface was re-authored to remove.

### Arrow keys move focus; they do not select

**The mode radiogroup does not commit on arrow.** Arrows move focus only; committing needs Space, Enter or a click — and neither key is handled explicitly, because a native `<button>` already turns both into a click and a second implementation of that would only drift from the first.

This is a deliberate departure from the stock ARIA radiogroup pattern, which conventionally selects on arrow. That convention assumes selection is cheap and instantly reversible. Here "select" is a service restart: `onKeyDown` used to call `commit()` on every row the arrows passed over, so arrowing from Off to Full Bypass fired a real `svc_start` and an iptables REDIRECT insert for Video Optimizer on the way past. **QManager is served by the device it is reconfiguring**, so one of the connections a restart drops is the user's own browser session.

`AlertDialogAction` re-checks `isSaving` as well. That is not redundant with `commit`'s own check: the takeover confirm sits open across an arbitrary human-length gap, and a write starting in that window would queue a second restart behind the first.

### The target list, and its import/export

**The client mirrors the CGI's 253-character per-domain ceiling** (`MAX_DOMAIN_LENGTH` in `targets-card.tsx`), and it has to. `save_hostlist` validates the charset, the dot, that ceiling **and** that the extracted entry count matches the declared one, then rewrites the file atomically — it is all-or-nothing, so **one over-length line rejects the entire merge**. A client that did not mirror the rule would show "42 added" over a write the modem refused outright. The success toast fires inside `saveDomains`'s own `.then` for the same reason.

**Export writes the device's own hostlist format**: the leading `# QManager Video Optimizer hostlist` comment line, then one domain per line, byte-identical to what the CGI writes at the top of `/etc/qmanager/video_domains.txt`. An export/import round trip is therefore lossless, and an exported file can be hand-edited or dropped onto a second modem without either end knowing about the other — the import parser strips `#` comments and blanks exactly as the backend's own reader does.

**Import merges and never replaces.** It rejects files over 256KB before reading them, lowercases, drops entries that fail the domain check, dedupes against both itself and the saved list, and caps the union at 300. Only the non-zero skip reasons reach the toast description, so a clean import shows no description rather than three sentences of zeros.

**`restore_hostlist` and `default_domains` are consumed now.** Both had shipped in the CGI with nothing in the frontend reading them — `use-cdn-hostlist` read `json.domains` and discarded the rest, so a Restore defaults control could not exist and nothing could name the factory list. The hook exposes `defaultDomains` (its only consumer is the confirm dialog, which names how many domains are about to replace the saved list; it is a read of the default file, not a preview of the write, since the CGI copies the file itself rather than echoing the array back) and `restoreDefaults` (the write). `count` from the same GET is deliberately **left unread**: it is `domains | length` from the jq expression that emitted the array, so surfacing it would be a second copy of a derivable number.

**The chip cascade is capped.** The list holds up to 300 entries and `staggerRows` drove an uncapped `staggerChildren` at 80ms a row, which put the last chip 24 seconds late. `lib/motion.ts` already exported `ROW_CASCADE_MAX_INDEX` and `rowCascadeDelay` for exactly this. The parent now carries `initial`/`animate` with no variants of its own and each chip rides the capped delay through `custom={index}`; worst case entrance is 0.8s. Note the trap the harness cannot see: keeping `staggerRows` on the parent **and** applying the capped delay stacks the two, and a text-anchored assertion that only proves the helper is imported passes either way.

### The layout contract

`CARD_PAIR` is `grid grid-cols-1 items-start gap-5 @5xl/main:grid-cols-2`, and the targets card sits in the **same** grid beneath the pair via `CARD_PAIR_WIDE` (`@5xl/main:col-span-2`) rather than in a second container, so the band has one source of truth for its rows and its gaps cannot drift apart. The grid wrapper is itself the `staggerItem` with the three cards directly inside it: they are one band and arrive as one beat. (That also avoids the trap where a plain `div` between a cascade root and a `motion` child breaks variant propagation and pins everything at `hidden` — a complete DOM, no console errors, an invisible page.)

- **`items-stretch` plus `*:data-[slot=card]:h-full`, and it is only honest because of the resting state.** This reverses the pass above it, which shipped `items-start` and *banned* the lock. That reasoning was right on its own premise: DESIGN.md does not ban equal heights outright, it makes them explicit and conditional on symmetry being a real property of the pair — and it was not one, because the verify card's idle state was a single footnote line. A lock over that is the Radio Information failure verbatim.

  The third round asked for the lock, and the answer was not to force one over the same premise. It was to **remove the premise**: the verify card now has a [resting state built to fill](#the-resting-state-and-the-height-lock), so both cards absorb the difference and the lock states something true. Both halves are load-bearing — `items-stretch` makes the *cell* take the row height, `*:data-[slot=card]:h-full` makes the *card* fill that cell, and a stretched cell holding a content-height card looks exactly like no change at all. Harness section [23] now asserts the lock, the fill, and a growing child in **both** cards; [29] is what keeps it honest.
- **`@5xl`, not `@6xl`, and the reason is measured rather than aesthetic.** The container is the viewport less 264px of sidebar, less 48px of main padding, less 16px of page padding. `@6xl` (1152px) therefore needs a viewport past **1480px** — a 1440px laptop, the commonest desktop width there is, would never see the side-by-side at all. `@5xl` (1024px) needs 1352px, and its ~546px cells clear the 512px threshold `CMP_ROW` uses to hold the verify comparison rows on one line. The cost is a ~20px band of viewport widths where those rows take their already-designed wrapped layout, which is a layout and not a defect. `@5xl` is also a step this codebase already uses; `@6xl` appears nowhere in the tree.
- **CSS `order` was considered and rejected.** It could have preserved the old single-column reading order underneath the new visual one, but that is precisely the disagreement between DOM order and visual order that WCAG 1.3.2 (Meaningful Sequence) exists to forbid. The DOM order below the shell **is** the reading order, at every width.

### The resting state, and the height lock

**The verify card's three footnote lines are one block with three faces.** Idle, running and not-installed used to be a single grey sentence each, sitting under a header on an otherwise empty card. They are now a centred media disc, a title, an optional body and — on the idle face — the run action, drawn from `RESTING` in the family's `shapes.ts`.

**The `Empty` primitive is deliberately not used, and not on taste.** `components/ui/empty.tsx` ships `p-6 … md:p-12`: a **viewport** breakpoint, inside a family whose entire responsive contract is container queries (harness section [13]). No call-site class removes it — `p-*` and `md:p-*` are different variants, so `cn()` keeps both and the viewport one wins above 768px; the one in-repo consumer that took the primitive had to neutralise it with a `md:` class of its own. This family already refused the `Input` primitive for exactly that defect (`shapes.ts` > `FIELD`) and restates `CONDITION` rather than importing the shared condition screen for the same reason. Third instance of one rule, not a new exception to it.

**The action moves, and there is only ever one of it.** Until a result exists the run lives *inside* the block, centred under the sentence explaining it. Once a result is on screen the block is gone and the action returns to the card header as "Run test again". The gate is `complete`, not "not idle" — written once, so no state can render two buttons for one action.

**The running face spins the disc, not a button.** Same call `onboarding.tsx` makes for the install, and the same reason: a wait measured in minutes has to be *readable* for minutes, not merely indicated.

**One string was deleted rather than left orphaned.** `trafficEngine.verify.idle` read "Run the test to compare your speed with and without the bypass" — the card description one line above, said again, over a button reading Run test. It existed because the idle state had no other content. The running and not-installed faces keep their bodies, because both say something the header does not (how long a run takes; what to do when there is no engine).

Measured at a 1440 viewport: idle 379/379, complete 467/467. At the real ~546px cell the two cards' **natural** heights are 398 and 401, so the lock is stating something almost true rather than forcing something false. At 375px the grid is one column and the lock is inert by construction.

### The skeleton mirrors the band, not the strip

The page skeleton drew four tiles and stopped, so the handoff grew three whole cards out of nothing. Each card now exports its own mirror — `ModeCardSkeleton`, `VerifyCardSkeleton`, `TargetsCardSkeleton` — and the shell composes them inside the **same `CARD_PAIR`** the loaded band uses, so the column split, the gap and the height lock cannot disagree between the two states.

> ⚠️ The mirrors live **beside the cards they mirror**, never in the shell. A skeleton kept in the shell drifts the first time its card changes, because nothing ever puts the two on one screen. That is finding 08 on this page, and it is the reason harness section [30] asserts the *location* of each mirror as well as its existence.

**The mode rows mirror by construction.** `CHOICE_ROW.ROOT` is deliberately unpinned (its hint wraps to two lines on a narrow container), so there is no height for a skeleton to copy and a guessed one would be finding 08 again. The mirror renders the real row box with line boxes inside it: same padding, same gaps, same mark, so the same height falls out of the same arithmetic. Measured 73px against the real 74px.

**`HOST_MAX_COLUMNS` fixes a mirror bug that predates this pass.** `HOST_VISIBLE_ROWS` counts **grid rows**, and both hostlist skeletons rendered it as a count of **chips** — five blocks, which is five rows at one column and *two* at three. On any desktop the loading box stood 138px short of the list that replaced it. The column count is a container query and therefore unknowable in JS, which is why this is a constant: the mirror renders the widest case (rows × columns), and at fewer columns the surplus falls past `VIEWPORT`'s own `max-h-56` and is clipped — which is exactly what a full list looks like, and the shipped default list is 21 domains against a five-row cap.

Handoff after the pass: pair 376 → 379, targets 399 → 401.

## Files

- `scripts/usr/lib/qmanager/dpi_state.sh` — helpers (args build, rule ensure/remove, status probes, mode detection)
- `scripts/usr/bin/qmanager_dpi_run` — engine supervisor. Verbs: `run` (default), `--ensure`, `--rule-up`, `--rule-down`, `--clear`. There is no `--start` / `--stop`; the CGI reaches the engine through systemd.
- `scripts/etc/systemd/system/qmanager-dpi.service` — `ExecStart` / `ExecStartPost` / `ExecStopPost` (see [Rule liveness](#rule-liveness-the-rule-cannot-outlive-the-engine))
- `scripts/usr/lib/qmanager/platform.sh` — `svc_reset_failed` and `run_iptables`; as `www-data` they go through the root helpers `qmanager_svc` and `qmanager_fw_apply` (one bare-path grant each in `scripts/etc/sudoers.d/qmanager`)
- `scripts/usr/bin/qmanager_fw_apply` — iptables allow-list for `www-data` callers; holds its own copies of the engine rule specs (see [Architecture](#architecture))
- `scripts/usr/bin/qmanager_dpi_install` — binary provisioning (pin + manifest verification)
- `scripts/usr/bin/qmanager_dpi_verify` — speed comparison helper (fast.com + speedtest.net/Cloudflare reference)
- `scripts/uninstall_rm520n.sh` — Step 1 calls `qmanager_dpi_run --clear` (see Teardown)
- `scripts/www/cgi-bin/quecmanager/network/video_optimizer.sh` — CGI (status / save / save_full_bypass / save_force_tcp / verify / install / save_hostlist)
- `app/local-network/traffic-engine/` + `components/local-network/traffic-engine/` — frontend (`shapes.ts` is the family's geometry contract; see [The UI](#the-ui-re-authored-2026-08-31))
- `hooks/use-video-optimizer.ts`, `hooks/use-full-bypass.ts`, `hooks/use-force-tcp.ts`, `hooks/use-cdn-hostlist.ts`

`scripts/test/` was deleted 2026-09-03. It used to hold four harnesses covering this feature: `installer-teardown-lockstep.sh` (the uninstaller invokes every teardown-style verb), `dpi-rule-signature-port.sh` (`DPI_RULE_SIG` and the `_dpi_uninstall_run` teardown track `$DPI_PORT`), `dpi-uninstall-path-symmetry.sh` (the UI and full-device uninstall paths drain the same chains, and `--clear` drains all three rules the lib owns), and `traffic-engine-design-language.sh` (the re-authored surface, sections [0]–[30]). None of them are runnable any more — the invariants they pinned are documented at their call sites above; prove a touch to this feature by running it on the device and loading the Traffic Engine page.
