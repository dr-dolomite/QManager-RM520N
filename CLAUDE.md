## How to Use This File

This file is loaded into **every** session — keep it lean. Everything here is a **golden rule to follow**: the Communication Style, Design Context, and platform/backend truths below are non-negotiable and always apply.

Detailed feature and subsystem notes live in `docs/reference/`. **Do NOT read those reference docs preemptively** — open one only when the current task actually touches that subsystem. Reading them "just in case" wastes context. The same applies to `PRODUCT.md` and `DESIGN.md` — read them when doing product or UI work, not for backend fixes.

## Communication Style

When reporting findings, diagnoses, root causes, or explaining how something works, write so the user **learns alongside the fix** — not just expert-to-expert shorthand.

- **Lead with a plain-English summary** (one line) before the technical specifics. Example: "Short version: the CGI script can't see `jq` because lighttpd starts CGI scripts with a stripped-down `PATH` that doesn't include `/opt/bin`."
- **Briefly explain the *why*** behind the underlying mechanism — one or two sentences of context. Example: "lighttpd does this on purpose: untrusted CGI scripts shouldn't inherit the parent shell's environment, so it gives them a minimal one."
- **Define jargon on first use**: acronyms (CGI, RLS, RSRP, EN-DC), kernel/system terms (sysctl, udev, systemd target, journald), protocol terms (flock, PTY, WebSocket upgrade) get a one-clause gloss.
- **Use analogies** when they clarify ("`flock` is like a 'do not disturb' sign on the file — only one process can hold it at a time").
- **Keep it additive, not bloating.** Trivial answers ("yes", "the file is at X") don't need a tutorial. The rule kicks in for findings, diagnoses, post-mortems, code review, and architecture explanations.

This applies to all output that explains *what's happening* or *why* — bug investigations, debug session reports, audit findings, design rationale, and any "I traced this and found..." moments. **Exception:** `RELEASE_NOTES.md` copy targets end users — see Release Notes below; brevity wins there.

## Change Workflow

Every code-change request in this repo follows a tier-routed, 6-phase flow (Triage → Plan → Approval → Execute → Validation → Docs & Close), run by the orchestrator dispatching specialist agents, with the user holding the approval gate. **Before triaging any code-change request** (i.e. before the first `**[Phase 1 — Triage]**` header), read `docs/reference/change-workflow.md` in full — it holds the 6 phases, tier routing table, Lite Path, agent roster, hard rules, branch model, worktree discipline, and Orchestration Mode. This is the project default for code changes and supersedes the generic brainstorming / writing-plans / verification skills; inside Phase 4, the test harness is written from the plan's Test Contract and committed **red before** the fix (Phase 4a → 4b) — see that doc's “Tests Come First” section. Skip phrases ("just do it" / "skip the plan" / "tier 0 it") short-circuit straight to direct execution without reading the doc.

This doc is deliberately **not** inlined here: it's read once by the orchestrator per code-change request, not carried by every dispatched agent's auto-loaded `CLAUDE.md`. Builders/validators get only the relevant excerpt inlined in their brief (per the doc's Hard Rules), never the whole flow.

## Design Context

See **`PRODUCT.md`** (strategic: what QManager is, users, brand personality, aesthetic references/anti-references, design principles) and **`DESIGN.md`** (visual: OKLCH tokens, typography, status-badge pattern, layout rules, component conventions, motion, Do's and Don'ts). Read them before any UI or product-facing work.

`DESIGN.md` is **the binding canon** — it describes the target as a single correct answer, with no "in progress" hedging. It was rewritten from the shipped `/dashboard` and `/cellular/` index surfaces, so those two are the reference implementations: when a rule is ambiguous, read `components/dashboard/**` or `components/cellular/radio/**` rather than guessing. `DESIGN.md`'s **Migration Deltas** section tracks the places where the canon is ahead of the code (partial Icon-Boundary rollout, unmigrated opacity washes, etc.) — read it before touching a surface that might be one of those deltas.

Quick reminders the visual spec enforces:

### Status Chip Pattern
All status indicators are **filled tonal chips**: a `Badge` variant carrying a role container fill, that container's `on-` ink, no visible border, pill radius, and a `size-3` icon (lucide, or a `MaterialSymbol` with an explicit `size` on the dashboard route). The variant is the whole API — never hand-write the classes, and never use `variant="outline"` for a status indicator.

| State | Variant | Renders | Icon |
| ----- | ------- | ------- | ---- |
| Success/Active | `success` | `bg-success-container text-on-success-container` | `CheckCircle2Icon` |
| Warning | `warning` | `bg-warning-container text-on-warning-container` | `TriangleAlertIcon` |
| Destructive/Error | `destructive` | `bg-destructive-container text-on-destructive-container` | `XCircleIcon` or `AlertCircleIcon` |
| Info | `info` | `bg-primary-container text-on-primary-container` | Context-specific (`DownloadIcon`, `ClockIcon`, etc.) |
| Muted/Disabled | `muted` | `bg-surface-container-high text-on-surface-variant` | `MinusCircleIcon` |

```tsx
<Badge variant="success">
  <CheckCircle2Icon className="size-3" />
  Active
</Badge>
```

- `components/ui/badge.tsx` is the shared wrapper: the five roles above live in its `cva`, so a status chip is correct by construction rather than by reviewer discipline. **`secondary` is not the home for metadata** — `components/ui/tag.tsx` is. A `Tag` says what a thing *is*: "a band number, a radio family, a channel width, **a capability**". That covers a storage label, a slot label, an encoding name and a network type, all of which are `<Tag variant="neutral">`. `default` / `secondary` / `outline` survive only for a genuine non-status, non-identity label with no `Tag` variant to key onto — and reaching for one is a signal to check the Two-Form Rule first
- **Every status chip carries an icon.** `success-container` and `warning-container` measure **1.03:1** apart — the same surface to the eye, and identical under deuteranopia — so the glyph is the only thing separating a healthy state from a degraded one. Two states in the same slot must never share a glyph either
- Tone maps key onto the exported `BadgeVariant` type, never onto a class string, so a new tone without a matching role fails the build (`REBOOT_TONE_BADGE`, `TONE_BADGE`, `qualityBadgeVariants`, `getQualityBadgeVariant`)
- Choose muted for deliberately inactive states (Stopped, Offline peer, Disabled); destructive for failure/error states (Disconnected link, Failed email)
- **Identity and metadata are NOT badges** — they render as outline tags through `components/ui/tag.tsx` (`nr` / `lte` / `spatial` / `neutral`: role border + role ink, transparent fill, `Badge` geometry). `BadgeVariant` no longer contains any identity or direction member, so the split is compiler-enforced: `variant="nr"` on a `Badge` fails the build. Where a chip carries identity AND reports quality, the quality must be encoded non-chromatically (the dashboard signal cards use the Material glyph's bar count). See DESIGN.md > Identity-Chip Rule
- **Measured signal quality is NOT a chip axis.** The five-stop ramp (`--quality-1`…`--quality-5`) lives on **numerals and bars**, never on chip fills — chips stay on the five status roles above, so `bad` and `poor` both key onto `destructive` and are separated by their glyphs. Route every quality→display decision through `components/cellular/signal-quality-display.ts` (`QUALITY_GLYPH` / `qualityBadgeVariant` / `qualityMeterTone` / `qualityInkClass`); four rival copies of that map existed and one had silently drifted into painting an unread antenna green. **Ramp ink on a numeral with no bar beside it is a bug** — adjacent stops sit below the CVD separation floor by design, so colour is never the only channel: the bar carries magnitude and the glyph carries the stop. The map **saturates at the top cut on purpose** (every `excellent` reading draws a full bar); discriminating above that cut is the score scale's job, not the bar's. A missing reading is an empty track (`MetricBar value={null}`), never a zero-length fill. See DESIGN.md > The signal quality ramp

### UI Component Conventions
- **CardHeader**: Always plain `CardTitle` + `CardDescription` without icons. Icons belong in badges or separate action areas, not in the card header itself.
- **Primary action buttons**: Default variant (not outline) for main actions like Record, Save, Apply. Use `SaveButton` for save-specific actions — pass it a **translated** `label`; it owns the three states, the width lock, and the 1.03 check.
- **Step-based progress**: `Loader2Icon` spinner + dot indicators for step/sample progress. Reserve fill/progress bars for data visualization (signal strength, quality meters) only.
- **Typography**: Rethink Sans is the UI typeface (`--font-sans`), including every changing numeric figure (`tabular-nums`, no `font-mono`); JetBrains Mono (`--font-jetbrains-mono` → `font-mono`) is scoped to identifiers and raw machine strings per DESIGN.md's Machine-Voice Rule. No other typeface is loaded — Material Symbols is an icon font, not a voice. Both light and dark mode are first-class (OKLCH tokens).
- **Shape**: the role scale is 12/20/28/36/40px plus pill. A card in a grid is `rounded-card`, the anchor card on a surface is `rounded-hero`, and anything that acts or labels is `rounded-pill`.
- **Responsive**: container queries against `@container/main` (or a card-local `@container/card`). Viewport breakpoints only for the page gutter and the shell.
- **Three states**: every data surface ships loading, empty, and error. Skeletons mirror the loaded geometry by importing the same shape constant (see `TILE_SHAPE` in `components/cellular/radio/summary-tiles.tsx`), never by restating numbers.
- **Motion**: `lib/motion.ts` is the JS source of truth and mirrors the `--duration-*` / `--ease-*` properties in `globals.css`. Three durations (360/600/800ms — the Motion Guide's 400/300/180 figures are its 1x *inspection* baseline, not the shipped scale), two stagger steps (120ms cards, 80ms rows), `emphasized` is the ceiling, no springs. Retune both layers in the same change. **A raw `duration-200` / `{ duration: 0.25 }` / bare `transition-all` in a component is a bug** — it silently won't retune. See DESIGN.md > The One-Scale Rule.
- **Components**: use shadcn/ui primitives before hand-rolling; semantic color tokens only, never raw Tailwind colors.

## Modem Platforms

QManager's reference target is the Quectel RM520N-GL modem, which runs **vanilla Linux internally** (SDXLEMUR SoC, ARMv7l, kernel 5.4.210 — RM520N-GL measurements, not universal) — NOT OpenWRT on an external host. Per-device facts, including RG501Q-EU, live in `docs/reference/platform-matrix.md`; treat unlisted claims below as RM520N-GL-only until confirmed otherwise. The app (Next.js static export + CGI shell backend) is deployed **onto the modem itself** and is fully standalone. Because the app runs on the device, anything that reboots the modem also kills any in-flight HTTP request — defer reboots via dialog + persistent banner, never `AT+CFUN=1,1` mid-request.

**No battery RTC — every boot starts at Jan 1970.** Stock `ql_time_daemon` steps the clock ~24s into boot (requires a registered SIM; no SIM = 1970 forever), and every armed `OnCalendar` timer misfires **twice** around that step (measured on hardware: ~23s at 1970, ~29s just after) regardless of its real schedule. Any new timer payload must pass the fire guard in `schedule_timer.sh` or use monotonic `OnBootSec=` — see `docs/reference/scheduled-timers.md` ("The 1970 boot window").

### Live Device Access

**Two live devices are reachable over SSH, on distinct subnets** — probe them whenever you can verify an architecture claim directly instead of guessing. Credentials are in `.env` (gitignored, local-only). Connect with the POSH-SSH PowerShell module (`New-SSHSession` / `Invoke-SSHCommand`). The devices are the source of truth for platform facts; docs drift.

| Device | `.env` vars | Serial |
| --- | --- | --- |
| **RM520N-GL** (SDX6X, BusyBox 1.31.1) — reference target | `RM520N_IP` / `RM520N_SSH_USER` / `RM520N_SSH_PASSWORD` | `61368cd2` |
| **RG501Q-EU** (SDX55, BusyBox 1.29.3) — community tier | `RG501Q_IP` / `RG501Q_SSH_USER` / `RG501Q_SSH_PASSWORD` | `b7e3d6f1` |

The bare `MODEM_*` triad still works and is an **alias for the RM520N-GL**. Older docs describing adb as the RG501Q's only shell are obsolete — that was true before 2026-08-25.

**Comparing the two devices is the highest-yield probe there is — so do it first.** Every cross-device defect found so far (`wget`, `timeout`, `mountpoint`) came from running a command on both and diffing the result; none came from reading code. For any portability question that is the first move, before dispatching an agent. **Always prove which device answered** (`cat /etc/quectel-project-version`, `grep -o 'androidboot.serialno=[^ ]*' /proc/cmdline`) — a wrong-device capture fails silently.

⚠️ **Check reachability, don't assume it.** Distinct subnets removed the old address collision, but the host must hold an address on **both** to reach both, which is not automatic — and either device may simply be offline (the RM520N-GL frequently is). Verify before concluding a probe failure means a defect.

Typical read-only probes: `systemctl status <unit>` / `journalctl -u <unit> -n 50`, `/tmp/qmanager_*.json` runtime state, `/etc/qmanager/` + `/usrdata/` config files, `curl -sS http://127.0.0.1/cgi-bin/quecmanager/...` (CGI through lighttpd), `qcmd 'AT+...'` query commands, `pgrep -fa qmanager`, `iptables -t mangle -L -n`, `/proc/net/dev`.

**Safety:** treat the modem as a live system — no reboots, `AT+CFUN=1,1`, factory resets, service restarts, or config writes without a stated reason. Never echo `.env` values into transcripts; reference the variable names. Deep investigation belongs to `modem-investigator`; scoped post-deploy checks to `busybox-portability-checker`.

### System Differences

The table below contrasts RM520N-GL against the legacy RM551E (OpenWRT) target — useful when porting or reading older code. RG501Q-EU values are unverified and live in `platform-matrix.md`, not here.

| Concern | RM551E (OpenWRT) | RM520N-GL (SDX65) |
|---------|-----------------|---------------------------|
| Init system | procd | systemd (`.service` units in `/lib/systemd/system/`) |
| Config store | UCI | Files in `/usrdata/` (persistent partition) |
| Root filesystem | Read-write | Two UBIFS volumes. `/` is `ubi0:rootfs` and **boots `ro`** (authoritative proof: `ro` in `/proc/cmdline` — **not** `/proc/mounts`, which shows `rw` only because `qmanager_setup` already remounted it, and **not** the `assert=read-only` mount option, which is UBIFS's assertion-*failure* policy and appears on `rw` volumes too). `/etc`, `/usrdata`, `/opt` are `ubi2_0`, always `rw`, no remount. Rootfs writes (`/lib/systemd/system`, `/usr/bin`, `/usr/lib`): remount `rw` once, `sync`, **never restore `ro`**. Full contract + reference implementations: `docs/BACKEND.md` §2.1 |
| Shell | BusyBox sh (POSIX only) | `/bin/bash` available |
| Web server | uhttpd | lighttpd (Entware) |
| Firewall | nftables / fw4 | iptables direct |
| TTL interface | `wwan0` | `rmnet+` |
| Package manager | opkg (system) | Entware opkg at `/opt` (bind of `/usrdata/opt` on the `ubi2_0` volume) |
| LAN config | UCI (`network.*`) | `/etc/data/mobileap_cfg.xml` via xmlstarlet |

### Reference Docs

Read these only when working on the relevant subsystem:

- **AT command transport** (`atcli_smd11`, `qcmd`, SMS, flock serialization, **how to detect a `qcmd` failure** — exit status only; `ERROR` never reaches stdout, so `case "$result" in *ERROR*)` is dead code, swept repo-wide in `b4d87ef` with the surviving safe-by-accident sites and the incomplete `grep -qx 'OK'` write assertion tracked there — and **why QManager can never consume AT URCs**: no resident listener, `smd11` is not a selectable URC port, and enabling one corrupts unrelated responses) — `docs/reference/at-command-transport.md`
- **QManager standalone install & runtime internals** (Entware bootstrap, udev permissions, CGI auth, service persistence, firewall, Tailscale, web console, email/SMS alerts, OTA pipeline incl. opt-in auto-update timer gated on `update.auto_update_enabled` — armed at install/OTA AND live by the Software Update UI toggle via the `qmanager_auto_update_arm` root helper — **and the canonical table of what lives inside vs outside `/etc/qmanager` and why**, incl. all three relocations out of it: `/etc/qmanager.env`, `/etc/qmanager-secrets`, `/etc/qmanager-backups`) — `docs/reference/qmanager-independence.md`
- **Full platform architecture** (platform internals, Entware bootstrapping, lighttpd config, boot sequences, troubleshooting) — `docs/rm520n-gl-architecture.md`

**Source reference:** `simpleadmin-source/` contains the original RM520N-GL admin panel (iamromulan/quectel-rgmii-toolkit) for historical reference. QManager is now fully independent and does not require SimpleAdmin to be installed.

## Release Notes (`RELEASE_NOTES.md`)

Fixed template — the file's normal end-state is a **single active release entry** with all of these elements:

1. `# 🚀 QManager RM520N BETA vX.X.X` heading
2. **One-line summary paragraph** (rewritten each release to hook on the headline change)
3. OTA blockquote, verbatim: `> One-click OTA from **System Settings → Software Update** if you're on v0.1.5 or newer.` (the v0.1.5 anchor is fixed)
4. `## ✨ New Features` / `## 🛠️ Improvements` / `## 🐛 Fixes` (any subset)
5. `## 📥 Installation` with `### Upgrading from vX.X.X` (only the version number rotates) and `### Fresh Install` (curl + wget blocks verbatim)
6. `## 💙 Thank You!` — GitHub Issues link, support links, and the `**License:** MIT + Commons Clause` line, all verbatim

**Tone per bullet:** bold plain-English lead → one short sentence of user-visible behavior (say where in the UI) → optional compressed technical parenthetical for power users. ~1–2 sentences per entry; 3 only for a migration note. No post-mortem paragraphs — that register belongs in `docs/`, not release notes.

## Removed/Deferred Features (dev-rm520 Branch)

The following features have been **completely removed** from the `dev-rm520` branch. Their backend scripts, frontend components, hooks, and types no longer exist. Do NOT reference, modify, or create code for these features unless explicitly re-porting them.

| Feature | Reason | Scope of Removal |
|---------|--------|-----------------|
| VPN Management (NetBird only) | Third-party binary, fw4/mwan3 dependencies | CGI, hooks, components for NetBird |
| Low Power Mode | Daemons removed earlier; `save_low_power` CGI action + `low_power_*` config seeds retired in the crond→systemd-timer migration — no Low Power code remains | qmanager_low_power, qmanager_low_power_check, `save_low_power`, `low_power_*` seeds |

## Feature-Specific Notes

Each feature below has a reference doc holding its invariants, gotchas, and rationale. **These rows are a routing table, not a summary** — they exist only so you can tell whether your current task touches a subsystem. When it does, read that doc; it carries the non-obvious constraints and load-bearing ordering rules that will otherwise bite you. When it doesn't, read nothing.

| Feature | Touch it when you're working on | Scope | Doc |
| ------- | ------------------------------- | ----- | --- |
| **Cross-UID `/tmp` file ownership** | Any file in `/tmp` written by both root daemons and www-data CGI — seeding, which direction `fs.protected_regular` actually blocks (and that the sysctl is **off** on RG501Q-EU, so the contract is RM520N-only), the never-`mv` rule, the recovery-flag claim protocol | RM520N | `tmp-file-ownership.md` |
| **Hardware profile / `platform.json`** | `hw_profile.sh`, the boot-time self-heal in `qmanager_setup`, anything reading or writing `/etc/qmanager/platform.json`, a `QM_HW_SCHEMA` bump — **and any root helper that writes into `/etc/qmanager` at all**, since that directory is www-data-owned and non-sticky, so a plain `>` there is redirectable via a planted symlink | Both | `platform-profile.md` |
| **Colour System / tokens** | Any colour token in `globals.css`, a new role, a `Badge` tone, or a surface that reads too loud — hue-slot arithmetic, the direction-vs-radio axis split, the CVD floor, and the two tokens that must never be "levelled" | Both | `color-system.md` |
| **Icon System / Icon-Boundary Rule** | Any icon, anywhere. The Material-vs-lucide boundary is ROUTE-scoped; Material now covers the sidebar, dashboard, pre-auth routes, and all of `/cellular/` (index + all 17 sub-routes) — the boundary is no longer partial inside `/cellular/` | Both | `icon-system.md` |
| **Tailwind's content scan** | Any prose that quotes a utility class — a code comment, a doc sentence, a harness failure message — or the CSS build gate in `bun run package`. Tailwind v4 auto-detects content and scans **every non-gitignored file**, so a class written in prose compiles into real CSS; four spellings 500 **every** route in `next dev`, and that failure latches until a cold restart | Both | `tailwind-prose-hazard.md` |
| **Auth Rate Limiting** | `cgi_auth.sh`, login lockout, `auth/check.sh` | RM520N | `auth-rate-limiting.md` |
| **Antenna Alignment** | `/cellular/antenna-alignment`, the composite aim score / recorder sampling gate, and the two shared `/cellular/` primitives it extracted: `components/cellular/condition-screen.tsx` and `components/cellular/signal-quality-display.ts` | RM520N | `antenna-alignment.md` |
| **Antenna Statistics** | `/cellular/antenna-statistics`, `signal_per_antenna`, and the shared `SIGNAL_SENTINELS` / `normalizeSignalValue` / `isPortReporting` boundary in `types/modem-status.ts` (both antenna pages read through it) | RM520N | `antenna-statistics.md` |
| **Band Locking** | `/cellular/cell-locking`, the two-axis band chip (fill=selected, inset ring=live), the neutral on-air carrier tile (identity on the disc, quality on the ramp), `unlockAll` as a write, the hero-level failover row, the Refresh action gated on `failover.watcher_running`, or the profile/scenario gate chain | RM520N | `band-locking.md` |
| **Tower Locking** | `/cellular/cell-locking/tower-locking`, `AT+QNWLOCK` (`common/4g` / `common/5g` / `save_ctrl`), `status.sh`'s `lte_read_ok` / `nr_read_ok` / `persist_read_ok` (absent means **true** — test `=== false`), the `/tmp/qmanager_tower_write_inflight` settle marker, the **unbounded** `qmanager_tower_failover` watcher and its activation-flag lifecycle, or the one-directional frequency-lock gate | RM520N | `tower-locking.md` |
| **Frequency Locking** | `/cellular/cell-locking/frequency-locking`, `AT+QNWCFG` (`lte_earfcn_lock` / `nr5g_earfcn_lock` — colon-separated, count field), the **absent** persistence key and failover watcher, the tri-state `tower_lock_*_active` gate that now fails **closed** (`tower_state_unknown`), or the one-directional tower-lock gate that `tower/lock.sh` does not reciprocate | RM520N | `frequency-locking.md` |
| **Cell Scanner family** | Any of the three routes under `/cellular/cell-scanner/` (full sweep, neighbour read, frequency calculator), `AT+QSCAN` / `AT+QENG="neighbourcell"`, the `/tmp/qmanager_long_running` maintenance marker and who writes it, or this surface's deliberately divergent signal thresholds | RM520N | `cell-scanner.md` |
| **Carrier Aggregation** | `AT+QCAINFO`, `network.carrier_components[]`, the dashboard CA strip | RM520N | `carrier-aggregation.md` |
| **Radio Information** | `/cellular/` index, `lib/radio-info.ts`, `components/cellular/radio/**` | RM520N | `radio-information.md` |
| **Cellular Basic Settings** | `/cellular/settings`, `cellular/settings.sh`, the six writable fields (`AT+QUIMSLOT` / `AT+CFUN` / `AT+QNWPREFCFG` / `AT+QSIMDET`), the dirty-state merge rule in `use-cellular-settings.ts`, the read contract (guard `raw`, not the fields — a failed read omits `settings`/`ambr` entirely), the ~35s SIM-slot apply, the poller's new `.sim` block, or `network.type` now being legitimately `""` | RM520N | `cellular-basic-settings.md` |
| **Cellular Settings family (shared contract)** | `components/cellular/settings/shapes.ts` — it now governs all five `/cellular/settings/` routes, so any shared export, the dirty-row tone rule, or `FIELD_SHELL`, which replaces the `Input` primitive | RM520N | `cellular-settings-family.md` |
| **Network Priority** | `/cellular/settings/network-priority`, `cellular/network_priority.sh`, `rat_acq_order`, the reorder list, or `RAT_RANK_TONE` | RM520N | `cellular-settings-family.md` |
| **IMEI Settings** | `/cellular/settings/imei-settings`, `cellular/imei.sh`, `use-imei-settings.ts`, Luhn gating, or the `qm_imei_reboot_pending` deferred-reboot contract | RM520N | `cellular-settings-family.md` |
| **Blocked Networks (FPLMN)** | `/cellular/settings/fplmn-settings`, `cellular/fplmn.sh`, `AT+CRSM` EF_FPLMN, the five condition states, or the unused `raw_data` payload | RM520N | `cellular-settings-family.md` |
| **Recent Activities** | `events.sh`, `/tmp/qmanager_events.json`, the dashboard event feed, event tone/freshness | RM520N | `recent-activities.md` |
| **Dashboard chart cards** | Device Metrics, Live Latency, Signal History, `hooks/use-chart-motion.ts`, recharts | Both | `dashboard-chart-cards.md` |
| **Dashboard state-change motion** | `TickGroup`/`useValueTick`, `SwapLabel`, status-chip morph, live value ticks, and `SaveButton`'s save flow | Both | `dashboard-state-motion.md` |
| **Custom DNS** | `/local-network/custom-dns`, the sentinel block in `/etc/data/dnsmasq.conf`, the family's `components/local-network/custom-dns/shapes.ts` (the route's only shapes module — restate geometry there, never import from `components/cellular/`), the single derived `DnsState` the shell computes and every child reads, the `<DNSMode>` read-time availability gate (**nothing in QManager writes it**, so the page must never link elsewhere to change it), or `blockCorrupt` — which renders as a **non-blocking** warning because it false-positives, and whose `clearSettings` "repair" verb **must never be wired**: `action=clear` runs the sentinel stripper, which on a corrupt block deletes every line after the stray BEGIN | RM520N | `custom-dns.md` |
| **TTL & MTU** | `/local-network/ttl-settings`, `ttl.sh` / `mtu.sh` (**two endpoints that fail independently**, hence per-endpoint pending flags — never one page-level `isLoading`), `ttl_state.sh`'s live-`iptables` read on `rmnet+`, the family's `components/local-network/ttl-mtu-settings/shapes.ts` (the route's only shapes module — restate geometry there, never import from `components/cellular/`), the un-renderable `autostart` (a symlink test the installer re-creates every OTA, so it is `true` on every device forever — the band is **three** tiles), or `mtu.sh`'s `${current_mtu:-1500}` default, which makes a failed read and a genuine 1500 indistinguishable | RM520N | `ttl-mtu.md` |
| **IP Passthrough** | `/local-network/ip-passthrough`, `AT+QMAP="MPDN_rule"` / `IPPT_NAT` / `DHCPV4DNS` + `AT+QCFG="usbnet"`, the family's `components/local-network/ip-passthrough/shapes.ts` (the route's only shapes module — restate geometry there, never import from `components/cellular/`), the band that is **"Last applied", never "In force"** (the GET reads our own `ippt_config.json` with a boot-time poller fallback and issues no AT command), or the three-line reboot handoff — `qm_rebooting` + clearing `qm_logged_in` + `/reboot/` — where dropping any one line silently breaks `cgi_reboot_response`'s ack wait | RM520N | `ip-passthrough.md` |
| **Traffic Engine (DPI bypass)** | `/local-network/traffic-engine`, the tpws recipe in `dpi_build_args()` (drop-`--tlsrec` rule, `--filter-l7`, no `-m comment`, hostlist hot-reload), the manifest+pin provisioning, the verify helper's trap-restore, the uninstall teardown contract (`qmanager_dpi_run --clear` — whole-product teardown, drains **all three** rules the lib owns, and is deliberately NOT the verb the engine's own UI uninstall goes through), the inert `sni_domain` contract key, the family's `components/local-network/traffic-engine/shapes.ts` (the route's only shapes module — restate geometry there, never import from `components/cellular/`, and note it carries **no `min-h-`**: the tile is pinned, everything else sizes to content), the silent-vs-loud refetch split (`selectMode` refetches both hooks with `refresh(true)`; `retry()` stays non-silent and belongs only to the two banners, because a loud post-write reconcile unmounts the whole page and kills a running Test bypass), the pair's height lock — which is only honest because `RESTING` gives the verify card a state built to FILL, so **never restore `items-start` and never add a lock to a card without one**, and note the `Empty` primitive is unusable here (`md:p-12` is a viewport breakpoint no call site can remove), the mode radiogroup's arrows-move-focus-only rule (deliberately not the stock ARIA pattern: "select" here restarts the service carrying the user's own session), the client's 253-character per-domain mirror of `save_hostlist` (whose merge is all-or-nothing, so one long line rejects the lot), or the single derived `mode` the shell computes from the two `enabled` flags and every child reads — **no component may infer the mode from a payload's shape** | RM520N | `dpi.md` |
| **Data Usage Counter** | `/proc/net/dev` counters, usage schema, orientation map | RM520N | `data-usage-counter.md`, `data-counter-platform-matrix.md` |
| **LAN Gateway IP** (planned, not built) | `/etc/data/mobileap_cfg.xml`, the not-yet-built gateway-IP editor, the `StartIP`/`EndIP` companion-field gotcha, the F8 reboot-reliability precedent | Both | `lan-gateway-ip.md` |
| **Ethernet Status & Link Speed** | `/local-network/ethernet`, `eth0`, `ethtool`, `qmanager_ethernet_apply`, the family's `components/local-network/ethernet/shapes.ts` (the route's only shapes module — restate geometry there, never import from `components/cellular/`), or the `interface_present` GET field, whose **absence means true** | RM520N | `ethernet.md` |
| **Centralized Alerts** | `/monitoring/alerts`, `alert_engine.sh`, SMS/email/Discord routing — **and** alert-channel secret storage: `/etc/qmanager-secrets/`, the `qmanager_secret_set` / `qmanager_email_send` root helpers, the `token_set` / `app_password_set` markers, and why a chmod inside `/etc/qmanager` is never the fix | RM520N | `alerts.md` |
| **Discord Bot** | `discord-bot/`, `qmanager_discord` | RM520N | `discord-bot.md` |
| **WAN Profile Management** | `cellular/apn.sh`, PDP contexts, the APN Management page (incl. the MBN card, the poller-fed "what the network granted" band, and the page-header status chip — which must verify against `+CGCONTRDP`, never `cids[].apn`), the shared `apn_apply.sh` attach-cycle primitive any APN write must go through, or **any parser for `+CGCONTRDP`** — whose fields are quoted on SDX65 and bare on SDX55, so it must be comma-split and quote-agnostic | RM520N | `wan-profile-management.md`, `cellular-settings-family.md` |
| **Custom SIM Profiles & Connection Scenarios** | One merged page at `/cellular/custom-profiles` (the `connection-scenarios` sub-route is retired to a client-side redirect): profile create/apply, scenarios + schedule ribbon, band locks via scenarios, suggested profiles, `current_settings.sh`, or any geometry/tone on the surface (governed by `shapes.ts`) | RM520N | `sim-profiles.md` |
| **SIM Detection** | `known_iccids`, `sim_registry.json`, the SIM-swap banner, Tracked SIMs | RM520N | `sim-detection.md` |
| **Connection Watchdog** | `/monitoring/watchdog`, `qmanager_watchcat`, the 4-tier recovery ladder | RM520N | `connection-watchdog.md` |
| **Connection Quality** | `qmanager_ping`, latency/jitter/loss, probe targets and thresholds | RM520N | `connection-quality.md` |
| **Timezone / System Clock** | `/etc/localtime`, `qmanager_timezone_apply`, zoneinfo | RM520N | `timezone.md` |
| **Scheduled Reboot & Tower Lock Schedule** | Any scheduled operation. **RM520N has no working `crond`** — everything is a runtime systemd `OnCalendar` timer. Any new timer must account for the 1970 boot window / clock-step fire guard | RM520N | `scheduled-timers.md` |
| **Overview Splash + `/login/`** | The two pre-auth routes, public CGI under `public/`, the pre-auth type scale | RM520N | `overview-splash.md` |
| **i18n / Language Picker** | Any user-visible string, `public/locales/**`, language packs | RM520N | `i18n.md`, `docs/CONTRIBUTING-translations.md` |
| **SMS Center** | `/cellular/sms`, `sms_tool`, CPMS storage routing, the single-flight inbox GET, or anything on the surface (geometry and tone live in `components/cellular/sms/shapes.ts`) | RM520N | `sms.md` |
| **SMS Forwarding** | `qmanager_sms_forward`, `/cellular/sms/forwarding`, the dirty-row promotion, or the hook's untranslated error strings | RM520N | `sms-forwarding.md` |
| **Speed Test** | Ookla CLI, `at_cmd/speedtest_*.sh`, the dashboard tile and dialog | RM520N | `speedtest.md` |
| **RG501Q-EU Bring-up** | Bringing QManager up on the RG501Q-EU specifically — the Entware `wget`-absent chicken-and-egg, the `timeout` positional-form fix, GitHub-vs-Entware reachability findings, and install-time fixes unique to this device | RG501Q-EU | `rg501q-bringup.md` |
| **Windows GUI Installer** | `installer-gui/` — the offline (China/GFW) installer: the `__QM_RC=` exit-code sentinel and `wrap_command`'s conditional separator, why SSH ignores the channel exit status, the always-`--no-reboot` split, the fail-closed model and Entware gates (`--force` disables the installer's own RM551E block), `tokens.css` extraction from `globals.css`, the saved connection (`%LOCALAPPDATA%` settings + the DPAPI blob, which never crosses the bridge), and the two defects that exist only in the frozen PyInstaller build | Both | `gui-installer.md` |

All paths are relative to `docs/reference/` unless stated. If you add a substantial feature with non-obvious invariants, write `docs/reference/<feature>.md` and add **one row** here — do not summarize the doc in this file.

## Shared Constants

- **`ANTENNA_PORTS`** (`types/modem-status.ts`): Canonical metadata for 4 antenna ports (Main/PRX, Diversity/DRX, MIMO 3/RX2, MIMO 4/RX3). Used by `antenna-statistics` and `antenna-alignment`. Any new per-antenna UI must import from here — do not duplicate port definitions.
- **`components/cellular/sms/shapes.ts`**: The SMS family's shape module — every geometry string, control height, tone map and skeleton line box for `/cellular/sms` **and** `/cellular/sms/forwarding`. Import from here; no component on the surface exports a shape constant, and the loaded views and their skeletons must read the same values. Tone maps key onto `ConditionTone` and resolve through `CONDITION_TONE` (`components/cellular/condition-screen.tsx`), never onto class strings. Sibling families restate geometry rather than importing it — anything genuinely family-wide belongs one level up in `components/cellular/`.
