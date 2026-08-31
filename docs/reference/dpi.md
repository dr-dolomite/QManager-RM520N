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

## The UI (re-authored 2026-08-31)

The surface was rebuilt onto the finalized design language. **No backend contract changed** — same endpoint, same actions, same response fields, same 2s cadence, same CGI-enforced mutex — so everything above this section is unaffected. What changed is the shape, and two of the changes are correctness rather than style.

**The page is ordered by cadence, not by config key.** Page header → live tile strip → the two-up band (**Bypass mode beside Test bypass**) → Optimizer targets → QUIC Force-TCP. Force-TCP stays last for the reason given under [QUIC handling](#quic-handling-force-tcp-standalone): its independence is deliberate and the position states it.

> ℹ️ NOTE: that cadence changed in the [polish pass](#the-polish-pass-second-round-2026-08-31) below. The retired order was a single column — strip, decision, what the decision operates on, then the occasional test. `traffic-engine.tsx`'s own header comment was rewritten along with the layout, because a file describing an order it no longer has is worse than one describing none.

**One derived `mode`, and nothing below infers its own.** `traffic-engine.tsx` computes `mode: DpiMode` once from the two sections' `enabled` flags and passes it down. This replaced `videoOptimizer.data ?? masquerade.data` followed by a `"sni_domain" in data` shape sniff in the status card — and that combination was a live bug: both hooks fetch, so the Video Optimizer payload essentially always won, and with **masquerade** enabled the card rendered the Video Optimizer layout and reported "Domains loaded" for a mode that has no domain list.

The four LIVE fields are read differently and deliberately so: `status`, `uptime`, `packets_processed` and `kernel_module_loaded` are **engine-global** — one tpws process, one REDIRECT rule, both sections reporting the same ones — so the shell takes whichever section read succeeded. That fallback was never the bug; using it to decide the *mode* was.

**The two modes are one three-way selector**, not tabs. They are mutually exclusive by construction (see [Modes](#modes)) and tabs say "two independent panes you may browse", so the mutex only ever surfaced as a surprise dialog at toggle time. The takeover confirm survives with a different job — it guards "this restarts the engine" — and fires **only on a mode→mode switch**, which is the only transition that actually restarts anything.

**The target list stays mounted while masquerade owns the engine**, and says why. It used to unmount with its tab, so the interface's only statement about a list that is still stored and still applies on switching back was its absence. The count chip switches from "N of 300" to "N saved" with it. The editor is not disabled either: the list is stored independently of the mode and tpws re-reads it per connection, so editing it is legitimate — what would be dishonest is implying the edits take effect right now.

**The verify result is a comparison, not a list.** Three rows on one shared 0–100 scale whose ceiling is the fastest of the three samples, so "did the bypass help" is read by bar length. The winner is promoted to `primary-container` and its numeral drops ramp ink for `on-primary-container`. **The line-speed row shares the scale but can never be the winner** — it is the reference (see [Verify](#verify-test-bypass)), not a contestant.

**Geometry lives in `components/local-network/traffic-engine/shapes.ts`** — the family's only shapes module, and the second under `/local-network/` after `ethernet/shapes.ts`. Restate geometry there; never import it from `components/cellular/`. Two values in it are load-bearing and are documented in place: the tile height is **pinned** (`h-[6.5rem]`) because a skeleton mirrors it and a floor cannot be a mirror, and there is deliberately **no `min-h-` anywhere in the file** — every other box sizes to its content, because a mode hint and the idle explanation both wrap on a narrow container.

The polish pass added to it: `CARD_PAIR` / `CARD_PAIR_WIDE` (the two-up band and its full-width member — see [The layout contract](#the-layout-contract)); `HOST_ROW.VIEWPORT` / `HOST_ROW.GRID` plus `HOST_VISIBLE_ROWS` (the capped, multi-column target list — the skeleton draws `HOST_VISIBLE_ROWS` blocks through the same two constants, so the skeleton→content handoff cannot jump, and the harness fails the file if any of those numbers is restated inline); `ICON_ACTION` (the 40px icon-only card action for import/export/restore — 40px is `HOST_ROW.ROOT`'s own height rather than a new number, and deliberately above the 32px per-row remove control); and `CARD_HEAD.ROOT_WRAP` / `CARD_HEAD.ACTIONS_WRAP` (the plain `ACTIONS` is `flex-none` and never shrinks, so on a narrow card a four-control group takes the width it wants and `CARD_TITLE` — which wraps by design rather than truncating — absorbs the entire loss).

> ℹ️ NOTE — **open item, not a solved one.** `HOST_ROW.VIEWPORT` themes its own scrollbar (`[scrollbar-width:thin]` plus a `scrollbar-color` on `surface-container-high`, one step from the card ground in both themes) because **nothing themes scrollbars product-wide**: `globals.css` carries no `::-webkit-scrollbar` or `scrollbar-color` declaration at all, and two other files have already worked around that ad hoc with a bare thin-width declaration. Scoping the fix to this module was deliberate — a global scrollbar token is a product decision and a polish pass is the wrong place to make one — so the gap is still open, and the third ad-hoc workaround is the point at which to close it properly. When checking one of these, read the **computed** `scrollbar-color`: a `var()` that fails to resolve ships as no declaration at all and reports nothing.

Two departures from the approved comp, both documented at their call sites: the Processed and Scope discs are **neutral** rather than `downlink`/`spatial` (a packet count and a hostlist size are counts, and giving a direction hue a second meaning is the failure `globals.css` records having already removed once), and the winning bar keeps its ramp fill rather than the comp's `on-primary-container` mix, because expressing that would mean minting a tone on the shared `MetricBar` for one call site.

Pinned by `scripts/test/traffic-engine-design-language.sh` (sections [0]–[18], committed red in `3338d48` before the fix landed in `0fdfc65`).

## The polish pass (second round, 2026-08-31)

Five user reports plus three defects a devil's-advocate pass found while attacking the plan written for them. **No backend contract changed here either** — same endpoint, same actions, same fields. Sections [19]–[28] of the harness, committed red in `a7b5d72`; the file now stands at 28 sections and 110 assertions.

### The silent-refetch contract

`selectMode` refetches both sections **silently**. `retry()` stays **non-silent** and is wired only to the two read-failure banners' Retry buttons. They are opposite on purpose, and the opposition is the fix.

The report was "switching Bypass Mode has no animation, it just refreshes then shows the toasts", which reads as a missing spinner. It was not one. `selectMode` ended in `retry()`; `retry` calls `refresh()` on both hooks; `refresh` **is** `fetchStatus`, whose `silent` parameter defaults to `false`. Both hooks therefore set `isLoading`, the shell took its loading branch instead of its content branch, and the live strip, the mode card, the targets card and the verify card were all **destroyed and rebuilt** for two CGI round-trips. There was never a missing spinner — there was nothing left on screen to put one in.

> ⚠️ WARNING: the obvious tidy-up is to collapse these back into one call. Do not. What breaks:
>
> - **A post-write reconcile that is not silent tears down the page it is reconciling.** That is the original defect, returning verbatim, and it presents as "no animation" rather than as an unmount — so it will not be reported as what it is a second time either.
> - **It also kills a running Test bypass.** `VerifyCard` holds `isRunning`, its result and its poll loop in local state, and the loop aborts on `!mountedRef.current` — so an unmount throws away up to twelve minutes of measurement, the card returns reading "idle" without saying anything was lost, and the backend worker carries on regardless. This has no separate fix and no separate assertion: the silent refetch *is* the fix. The two-up band makes a mid-test mode switch **more** likely, not less.
> - **Conversely, making `retry()` silent breaks the banners.** Someone pressing Retry after a failed read is asking to *see* the read happen; a button that changes nothing on screen reads as a button that did nothing.

**`refresh` takes an optional silent flag on both status hooks** — `refresh: (silent?: boolean) => void` in `hooks/use-video-optimizer.ts` and `hooks/use-traffic-masquerade.ts`. It is part of the published signature rather than an internal convenience, because the shell has to silence **both** halves of a mode-switch refetch; a hook that could not would leave half the page tearing down anyway. `use-cdn-hostlist`'s `refresh` is unchanged — nothing refetches it mid-write.

**Which mode is pending, not merely that one is.** `ModeCard` now takes `pendingMode: DpiMode | null` in place of `isSwitching: boolean`. A boolean cannot name one of three rows, so the flag was spent entirely on `disabled`, which fired the group-wide dim on all three rows equally and erased the signal it was meant to carry. The two non-pending rows take the real `disabled` attribute and inherit the primitive's dim for free; the pending row takes `aria-disabled` so it stays at full strength and holds the spinner, kept inert by `commit`'s existing `isSaving` guard. Two deliberate omissions, both recorded at their call sites: the pending row is **not** painted as selected (a status surface reports what is actually running, never the half-edited form — and on failure `selectMode` returns before the refetch, so an optimistic mark would visibly snap back), and there is **no synthetic "Switching" chip** in the card header, because `restarting` is already a real `DpiEngineStatus` member rendered by `ENGINE_BADGE` here and by `ENGINE_SPEC` in `live-strip.tsx`, and a second answer to one question is the exact defect this surface was re-authored to remove.

### Arrow keys move focus; they do not select

**The mode radiogroup does not commit on arrow.** Arrows move focus only; committing needs Space, Enter or a click — and neither key is handled explicitly, because a native `<button>` already turns both into a click and a second implementation of that would only drift from the first.

This is a deliberate departure from the stock ARIA radiogroup pattern, which conventionally selects on arrow. That convention assumes selection is cheap and instantly reversible. Here "select" is a service restart: `onKeyDown` used to call `commit()` on every row the arrows passed over, so arrowing from Off to Traffic Masquerade fired a real `svc_start` and an iptables REDIRECT insert for Video Optimizer on the way past. **QManager is served by the device it is reconfiguring**, so one of the connections a restart drops is the user's own browser session.

`AlertDialogAction` re-checks `isSaving` as well. That is not redundant with `commit`'s own check: the takeover confirm sits open across an arbitrary human-length gap, and a write starting in that window would queue a second restart behind the first.

### The target list, and its import/export

**The client mirrors the CGI's 253-character per-domain ceiling** (`MAX_DOMAIN_LENGTH` in `targets-card.tsx`), and it has to. `save_hostlist` validates the charset, the dot, that ceiling **and** that the extracted entry count matches the declared one, then rewrites the file atomically — it is all-or-nothing, so **one over-length line rejects the entire merge**. A client that did not mirror the rule would show "42 added" over a write the modem refused outright. The success toast fires inside `saveDomains`'s own `.then` for the same reason.

**Export writes the device's own hostlist format**: the leading `# QManager Video Optimizer hostlist` comment line, then one domain per line, byte-identical to what the CGI writes at the top of `/etc/qmanager/video_domains.txt`. An export/import round trip is therefore lossless, and an exported file can be hand-edited or dropped onto a second modem without either end knowing about the other — the import parser strips `#` comments and blanks exactly as the backend's own reader does.

**Import merges and never replaces.** It rejects files over 256KB before reading them, lowercases, drops entries that fail the domain check, dedupes against both itself and the saved list, and caps the union at 300. Only the non-zero skip reasons reach the toast description, so a clean import shows no description rather than three sentences of zeros.

**`restore_hostlist` and `default_domains` are consumed now.** Both had shipped in the CGI with nothing in the frontend reading them — `use-cdn-hostlist` read `json.domains` and discarded the rest, so a Restore defaults control could not exist and nothing could name the factory list. The hook exposes `defaultDomains` (its only consumer is the confirm dialog, which names how many domains are about to replace the saved list; it is a read of the default file, not a preview of the write, since the CGI copies the file itself rather than echoing the array back) and `restoreDefaults` (the write). `count` from the same GET is deliberately **left unread**: it is `domains | length` from the jq expression that emitted the array, so surfacing it would be a second copy of a derivable number.

**The chip cascade is capped.** The list holds up to 300 entries and `staggerRows` drove an uncapped `staggerChildren` at 80ms a row, which put the last chip 24 seconds late. `lib/motion.ts` already exported `ROW_CASCADE_MAX_INDEX` and `rowCascadeDelay` for exactly this. The parent now carries `initial`/`animate` with no variants of its own and each chip rides the capped delay through `custom={index}`; worst case entrance is 0.8s. Note the trap the harness cannot see: keeping `staggerRows` on the parent **and** applying the capped delay stacks the two, and a text-anchored assertion that only proves the helper is imported passes either way.

### The layout contract

`CARD_PAIR` is `grid grid-cols-1 items-start gap-5 @5xl/main:grid-cols-2`, and the targets card sits in the **same** grid beneath the pair via `CARD_PAIR_WIDE` (`@5xl/main:col-span-2`) rather than in a second container, so the band has one source of truth for its rows and its gaps cannot drift apart. The grid wrapper is itself the `staggerItem` with the three cards directly inside it: they are one band and arrive as one beat. (That also avoids the trap where a plain `div` between a cascade root and a `motion` child breaks variant propagation and pins everything at `hidden` — a complete DOM, no console errors, an invisible page.)

- **`items-start`, with no height lock.** DESIGN.md does not ban equal heights outright; it makes them explicit and conditional on symmetry being a real property of the pair. It is not one here. The verify card is a single footnote line when idle and a headline plus three comparison bars when complete, so a lock would strand dead space in whichever card had less to say — and which one that is **changes while the test runs**. That is the Radio Information failure DESIGN.md already records paying for once. Harness section [23] bans the alternative.
- **`@5xl`, not `@6xl`, and the reason is measured rather than aesthetic.** The container is the viewport less 264px of sidebar, less 48px of main padding, less 16px of page padding. `@6xl` (1152px) therefore needs a viewport past **1480px** — a 1440px laptop, the commonest desktop width there is, would never see the side-by-side at all. `@5xl` (1024px) needs 1352px, and its ~546px cells clear the 512px threshold `CMP_ROW` uses to hold the verify comparison rows on one line. The cost is a ~20px band of viewport widths where those rows take their already-designed wrapped layout, which is a layout and not a defect. `@5xl` is also a step this codebase already uses; `@6xl` appears nowhere in the tree.
- **CSS `order` was considered and rejected.** It could have preserved the old single-column reading order underneath the new visual one, but that is precisely the disagreement between DOM order and visual order that WCAG 1.3.2 (Meaningful Sequence) exists to forbid. The DOM order below the shell **is** the reading order, at every width.

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
- `app/local-network/traffic-engine/` + `components/local-network/traffic-engine/` — frontend (`shapes.ts` is the family's geometry contract; see [The UI](#the-ui-re-authored-2026-08-31))
- `scripts/test/traffic-engine-design-language.sh` — harness pinning the re-authored surface: sections [0]–[18] the re-author, [19]–[28] the [polish pass](#the-polish-pass-second-round-2026-08-31) (silent refetch, `pendingMode`, no-select-on-arrow, `CARD_PAIR`, the capped list, import/export/restore, the em-dash sweep, and a CRLF guard on the locale packs)
- `hooks/use-video-optimizer.ts`, `hooks/use-traffic-masquerade.ts`, `hooks/use-force-tcp.ts`, `hooks/use-cdn-hostlist.ts`
