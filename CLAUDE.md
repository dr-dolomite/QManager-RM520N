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

Every code-change request in this repo follows a tier-routed, 6-phase flow. The main session orchestrates; the specialist agents do the work. The user holds the approval gate. This flow is the project default for code changes and supersedes the generic brainstorming / writing-plans / verification skills; test-driven development still applies inside Phase 4 wherever tests exist.

**Signal each phase transition** with a header so the user always knows where we are: `**[Phase 1 — Triage]**`, `**[Phase 2 — Plan]**`, `**[Phase 3 — Approval]**`, `**[Phase 4 — Execute]**`, `**[Phase 5 — Validation]**`, `**[Phase 6 — Docs & Close]**`.

### The 6 Phases

1. **Triage & Recon (orchestrator):** Classify the request into Tier 0–4 by blast radius. For every **bug fix**, every **Tier 3+** change, and **all Tier 4** work, dispatch `modem-investigator` as a read-only Phase 1 gate — it maps the UI→hook→CGI→`qcmd`→modem flow statically and probes live state via Posh-SSH before any code is written. It returns an evidence report (file paths with line numbers, captured CGI/systemd/journal/log output, findings), never code. If the change touches the installer, systemd units, sudoers, `/usrdata/` layout, or the OTA pipeline, also dispatch `installer-safety-auditor` as a hard read-only gate. Synthesize findings.
2. **Plan (orchestrator synthesizes, builders pre-flight):** For Tier 2+, dispatch builder agents in parallel — `cgi-endpoint-builder` (backend CGI / daemons / libs / AT flows) and/or `ui-builder` (pages / cards / hooks / types). They return scaffolding + design notes, NOT committed code. Synthesize into ONE plan: tier, agent roster, file list, build order, risks, post-flight validator list.
3. **Approval Gate (user):** Plan changes here are cheap; later changes are not.
4. **Execute (builders):** Bottom-up for cross-layer work: poller → CGI → hook → component → alerts. Parallel where files are independent; sequential where there's a data dependency.
5. **Post-Flight Validation (parallel, ONE message):** Fire every applicable validator in a single message: `busybox-portability-checker` (static audit **and** scoped on-device verification of the deployed change), `installer-safety-auditor` (verify mode, for installer/systemd/OTA changes). Loop failures back to Phase 4 — but after **2 failed validation rounds**, stop and surface to the user instead of looping further.
6. **Docs & Close (`docs-writer`):** Update `docs/reference/`, the routing tables in this file, and `RELEASE_NOTES.md` as needed. Report summary + git status.

### Tier Routing

| Tier | Scope | Flow |
|------|-------|------|
| 0 | Typos, comments, copy edits, version bumps | Direct edit, no agents, no plan |
| 1 | Single existing file in one layer | Skip Phase 2–3. Implement + the layer's validator + maybe docs |
| 2 | New feature, single layer | Full flow; pre-flight is the layer's builder only |
| 3 | Cross-layer feature (CGI + hook + component, or a poller field consumed across layers) | Full flow; `modem-investigator` runs the Phase 1 recon gate |
| 4 | Installer / systemd / sudoers / `/usrdata/` layout / OTA pipeline | Full flow; `modem-investigator` recon **plus** `installer-safety-auditor` as a hard Phase 1 gate before code is written |

Bug fixes match the tier of the *fix*, not the bug — and always get a Phase 1 `modem-investigator` recon first, because "understand the live flow before touching it" is cheaper than a wrong fix. Pure refactors with no behavior change drop one tier (validators still run; builders don't pre-flight).

### Agent Roster

All agents are defined in `.claude/agents/`. Models are pinned per agent — the orchestrator does not choose them.

- **Recon gate (Phase 1, read-only):** `modem-investigator` — traces the full stack statically and probes the live modem read-only via Posh-SSH; returns an evidence report and can halt work before code is written.
- **Safety gate (Phase 1 + Phase 5, read-only):** `installer-safety-auditor` — audits installer/systemd/sudoers/`/usrdata/`/OTA changes; can BLOCK before code is written; re-runs in verify mode post-change.
- **Builders (Phases 2 & 4):** `cgi-endpoint-builder` (backend CGI shell endpoints, AT/`qcmd` flows, daemons, apply pipelines), `ui-builder` (Next.js / shadcn / Tailwind frontend).
- **Validator (Phase 5):** `busybox-portability-checker` — static audit (shebang, CRLF, BusyBox applet limits, 32-bit arithmetic) **and** scoped on-device verification of the deployed change.
- **Closer (Phase 6):** `docs-writer`.

### Hard Rules

- **Tier is decided once, up-front.** If tempted to skip the recon or a validator mid-flow, re-triage rather than skip.
- **`modem-investigator` is read-only and fails loud.** If recon reveals the change needs a write action on live state, or surfaces a broken invariant, it halts and reports — the main thread re-routes through the builders + validators.
- **The Phase 1 `installer-safety-auditor` gate fails loud.** BLOCKED halts the work before code is written. This is cheap; rework is not.
- **Post-flight validators always go out in a single parallel message.** Never serially.
- **Validate CGI as `www-data`, never as root.** On-device CGI checks go through lighttpd (`curl http://127.0.0.1/cgi-bin/...`) or `sudo -u www-data` — root-shell testing with `_SKIP_AUTH=1` has masked real permission bugs before.
- **No in-flight reboot.** The app runs on the modem itself — `reboot` / `AT+CFUN=1,1` mid-request kills the in-flight HTTP response and the device. Reboots are deferred (dialog + persistent banner after the response is written); validators reject inline reboots in a CGI response path.
- **`docs-writer` is the closing bracket.** If it doesn't run on Tier 2+, the change isn't done.
- **Agents don't see the orchestrator's conversation.** Each dispatch is a self-contained brief with file paths, schemas, the live evidence from `modem-investigator`, and the relevant `CLAUDE.md` / `DESIGN.md` / `PRODUCT.md` sections inlined.

### Worktree Discipline (Tier 2+)

Parallel branches and parallel builders must never cross-contaminate commits. Two layers of isolation, both harness-native:

1. **Run-level — every Tier 2+ run gets its own worktree.** Immediately after the Phase 3 approval gate (before any builder writes a file), call `EnterWorktree` to create an isolated checkout on a fresh branch named for the change (e.g. `wt/eth-link-alerts`). The session CWD moves there and every subsequently spawned teammate inherits it. Phases 1–3 (recon/plan) stay in the main checkout — they're read-only and should see the branch the user actually asked about. Tier 0/1 edits stay in-place, no worktree.
2. **Agent-level — isolate builders only when file sets overlap.** If two builders would touch overlapping or uncertain file sets in parallel, spawn them with `isolation: "worktree"` and reconcile their results into the run worktree. When file sets are provably disjoint (the normal case — backend in `scripts/`, UI in `components/`), skip it; they share the run worktree.

**On entry, fix the two things a fresh worktree is missing:**
- **`.env` is gitignored** → copy it from the main checkout or `modem-investigator` / `busybox-portability-checker` silently lose SSH access to the live modem. Verify `git check-ignore .env` still holds in the worktree; never commit it.
- **`node_modules` is absent** → run `bun install` lazily, only if the change actually needs a frontend build/lint/tsc pass; backend-only changes skip it.

**Close-out (Phase 6):** after validation passes and `docs-writer` closes, ask the user via `AskUserQuestion` — merge back into the originating branch, keep the branch for a PR, or discard — then `ExitWorktree`. Never auto-merge.

### Skip Phrases

User can short-circuit by saying "just do it" / "skip the plan" / "tier 0 it" — drop to direct execution. Otherwise the flow is the default.

### Orchestration Mode ("orchestrate")

When the user says **"orchestrate"** (e.g. "orchestrate this", "orchestrate a team for…"), run the 6-phase flow above as a **multi-agent team**, not a solo pass. Tiers, gates, and the user approval gate all still apply. Default shape:

- **The orchestrator is the head architect, not a worker.** It plans, briefs teammates, synthesizes their evidence, holds the approval gate, and makes the calls. The legwork (recon, builds, validation, docs) goes to teammates. The orchestrator still does its own targeted reads to *judge* teammate reports rather than rubber-stamp them.
- **Teammates are spawned liberally and in parallel**, each with a **self-contained brief** (file paths, schemas, live evidence, the relevant CLAUDE.md/DESIGN.md/PRODUCT.md sections inlined) — they don't see the orchestrator's conversation. Use the project agents (`modem-investigator`, `cgi-endpoint-builder`, `ui-builder`, `busybox-portability-checker`, `installer-safety-auditor`, `docs-writer`) plus `Explore`/`general-purpose` for recon.
- **One teammate is always a dedicated devil's advocate** for any investigation — its job is to attack the leading hypotheses, surface what the team is underweighting, and stop the team from "fixing" accurate telemetry or chasing a phantom.
- **Phase 1 recon fans out.** Run several read-only agents at once on different leads (live `modem-investigator` probing, static `Explore`, a delta/compare angle, the devil's advocate). When new evidence lands mid-flight, **redirect a running teammate with `SendMessage`** instead of re-spawning. If a backgrounded teammate goes idle without delivering its report, ping it for the report.
- **Synthesize, then gate.** Fold all reports into ONE plan and use **`AskUserQuestion`** at the Phase 3 approval gate and for any real scoping decision. Don't start Phase 4 builders until the user approves.
- **Worktree Discipline applies (see above).**
- **Execute → validate → docs, with a task board.** Builders run bottom-up (parallel where files are independent), validators gate every backend/shell change on-device, `docs-writer` closes. Track it with `TaskCreate`/`TaskUpdate` (owners + blockers) so the user can follow progress.
- **UI craft stays with the orchestrator** via the Impeccable skill; `ui-builder`/`Explore` may still recon the surfaces.

The same Skip Phrases still apply — "just do it" drops orchestration back to a solo direct pass.

## Design Context

See **`PRODUCT.md`** (strategic: what QManager is, users, brand personality, aesthetic references/anti-references, design principles) and **`DESIGN.md`** (visual: OKLCH tokens, typography, status-badge pattern, layout rules, component conventions, motion, Do's and Don'ts). Read them before any UI or product-facing work.

Quick reminders the visual spec enforces:

### Status Badge Pattern
All status badges use `variant="outline"` with semantic color classes and `size-3` lucide icons. Never use solid badge variants (`variant="success"`, `variant="destructive"`, etc.) for status indicators.

| State | Classes | Icon |
| ----- | ------- | ---- |
| Success/Active | `bg-success/15 text-success hover:bg-success/20 border-success/30` | `CheckCircle2Icon` |
| Warning | `bg-warning/15 text-warning hover:bg-warning/20 border-warning/30` | `TriangleAlertIcon` |
| Destructive/Error | `bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30` | `XCircleIcon` or `AlertCircleIcon` |
| Info | `bg-info/15 text-info hover:bg-info/20 border-info/30` | Context-specific (`DownloadIcon`, `ClockIcon`, etc.) |
| Muted/Disabled | `bg-muted/50 text-muted-foreground border-muted-foreground/30` | `MinusCircleIcon` |

```tsx
<Badge variant="outline" className="bg-success/15 text-success hover:bg-success/20 border-success/30">
  <CheckCircle2Icon className="size-3" />
  Active
</Badge>
```

- There is no shared badge wrapper component — compose the pattern inline with `Badge` (every current surface does); if a wrapper is extracted later, update this line and DESIGN.md together
- Choose muted for deliberately inactive states (Stopped, Offline peer, Disabled); destructive for failure/error states (Disconnected link, Failed email)

### UI Component Conventions
- **CardHeader**: Always plain `CardTitle` + `CardDescription` without icons. Icons belong in badges or separate action areas, not in the card header itself.
- **Primary action buttons**: Default variant (not outline) for main actions like Record, Save, Apply. Use `SaveButton` for save-specific actions with loading animation.
- **Step-based progress**: `Loader2Icon` spinner + dot indicators for step/sample progress. Reserve fill/progress bars for data visualization (signal strength, quality meters) only.
- **Typography**: Euclid Circular B is the UI typeface (`--font-sans`); Geist Mono (`--font-geist-mono` → `font-mono`) is scoped to machine-voice surfaces per DESIGN.md's Machine-Voice Rule. No other typeface is loaded. Both light and dark mode are first-class (OKLCH tokens); radius 0.65rem base.
- **Components**: use shadcn/ui primitives before hand-rolling; semantic color tokens only, never raw Tailwind colors.

## RM520N-GL Platform

QManager targets the Quectel RM520N-GL modem, which runs **vanilla Linux internally** (SDXLEMUR SoC, ARMv7l, kernel 5.4.210) — NOT OpenWRT on an external host. The app (Next.js static export + CGI shell backend) is deployed **onto the modem itself** and is fully standalone. Because the app runs on the device, anything that reboots the modem also kills any in-flight HTTP request — defer reboots via dialog + persistent banner, never `AT+CFUN=1,1` mid-request.

### Live Device Access

A live RM520N-GL is reachable over SSH — **probe it whenever you can verify an architecture claim or assumption directly instead of guessing.** Credentials are in `.env` (`MODEM_IP`, `MODEM_SSH_USER`, `MODEM_SSH_PASSWORD`) — gitignored, local-only. Connect with the POSH-SSH PowerShell module (`New-SSHSession` / `Invoke-SSHCommand`). The device is the source of truth for platform facts; docs drift.

Typical read-only probes: `systemctl status <unit>` / `journalctl -u <unit> -n 50`, `/tmp/qmanager_*.json` runtime state, `/etc/qmanager/` + `/usrdata/` config files, `curl -sS http://127.0.0.1/cgi-bin/quecmanager/...` (CGI through lighttpd), `qcmd 'AT+...'` query commands, `pgrep -fa qmanager`, `iptables -t mangle -L -n`, `/proc/net/dev`.

**Safety:** treat the modem as a live system — no reboots, `AT+CFUN=1,1`, factory resets, service restarts, or config writes without a stated reason. Never echo `.env` values into transcripts; reference the variable names. Deep investigation belongs to `modem-investigator`; scoped post-deploy checks to `busybox-portability-checker`.

### System Differences

The table below contrasts RM520N-GL against the legacy RM551E (OpenWRT) target — useful when porting or reading older code.

| Concern | RM551E (OpenWRT) | RM520N-GL (Vanilla Linux) |
|---------|-----------------|---------------------------|
| Init system | procd | systemd (`.service` units in `/lib/systemd/system/`) |
| Config store | UCI | Files in `/usrdata/` (persistent partition) |
| Root filesystem | Read-write | UBIFS — read-only by default on stock boot (`mount -o remount,rw /`) |
| Shell | BusyBox sh (POSIX only) | `/bin/bash` available |
| Web server | uhttpd | lighttpd (Entware) |
| Firewall | nftables / fw4 | iptables direct |
| TTL interface | `wwan0` | `rmnet+` |
| Package manager | opkg (system) | Entware opkg at `/opt` (dedicated UBIFS volume) |
| LAN config | UCI (`network.*`) | `/etc/data/mobileap_cfg.xml` via xmlstarlet |

### Reference Docs

Read these only when working on the relevant subsystem:

- **AT command transport** (`atcli_smd11`, `qcmd`, SMS, flock serialization) — `docs/reference/at-command-transport.md`
- **QManager standalone install & runtime internals** (Entware bootstrap, udev permissions, CGI auth, service persistence, firewall, Tailscale, web console, email/SMS alerts, OTA pipeline) — `docs/reference/qmanager-independence.md`
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
| Video Optimizer / Traffic Masquerade (DPI) | nftables dependency, nfqws ARM32 not validated | CGI, hooks, components, types, dpi_helper.sh, installer |
| Low Power Mode (daemons) | Daemon scripts removed; cron/config management retained in settings.sh | qmanager_low_power, qmanager_low_power_check |

## Feature-Specific Notes

Detailed operational notes for individual features live in `docs/reference/`. Read the relevant file only when working on that feature:

- **Antenna Alignment** (`/cellular/antenna-alignment`) — `docs/reference/antenna-alignment.md`
- **Custom DNS** (`/local-network/custom-dns`, dnsmasq upstream override via sentinel block in `/etc/data/dnsmasq.conf`) — `docs/reference/custom-dns.md`
- **Data Usage Counter** (kernel `/proc/net/dev`-sourced, schema v5 with static SoC-based orientation map from `/etc/quectel-project-version`, `modem_reset_count`, `orientation`) — `docs/reference/data-usage-counter.md`
- **Ethernet Status & Link Speed** (`/local-network/ethernet`, Realtek RTL8125B 2.5GbE on `eth0` via `r8125` driver; reads link state from sysfs, speed/duplex from `ethtool`; speed limit applied via `qmanager_ethernet_apply` root helper; lib at `scripts/usr/lib/qmanager/ethtool_helper.sh`)
- **Discord Bot** (`discord-bot/`, deployed as `/usr/bin/qmanager_discord`) — `docs/reference/discord-bot.md`
- **WAN Profile Management** (`cellular/apn.sh`, 6 PDP contexts, AT-only, per-context `AT+CGACT` cycle) — `docs/reference/wan-profile-management.md`
- **Custom SIM Profiles** (4-step apply `apn → ttl_hl → scenario → imei`; `settings.scenario_id` binds a Connection Scenario; active profile gates APN / TTL/HL / Scenarios / Band Locking pages; `profile_managed` CGI guard) — `docs/reference/sim-profiles.md`
- **Timezone / System Clock** (`/system-settings`, glibc reads `/etc/localtime`; applied by copying a TZif via the `qmanager_timezone_apply` root helper; zoneinfo at `/opt/share/zoneinfo` from Entware `zoneinfo-all`; `/etc/TZ` is inert on glibc; cron adopts a new zone on the next reboot) — `docs/reference/timezone.md`
- **i18n / Language Picker** (`react-i18next`, **bundle-only** — all 5 langs `en`/`zh-CN`/`zh-TW`/`it`/`id` compiled in via `lib/i18n/resources.ts`, no download/CGI backend; client-only-lazy init is a hard invariant for the static export; native `_one`/`_other` plurals — **no** `i18next-icu`/`http-backend`/`languagedetector`; `localStorage["qmanager_lang"]`; `bun run i18n:check` key-parity gate. Increment 1 = `common`/`sidebar`/`dashboard` namespaces) — `docs/reference/i18n.md`

If you add a substantial new feature with non-obvious invariants, drop its notes into `docs/reference/<feature>.md` and add a row above rather than re-fattening this file.

## Shared Constants

- **`ANTENNA_PORTS`** (`types/modem-status.ts`): Canonical metadata for 4 antenna ports (Main/PRX, Diversity/DRX, MIMO 3/RX2, MIMO 4/RX3). Used by `antenna-statistics` and `antenna-alignment`. Any new per-antenna UI must import from here — do not duplicate port definitions.
