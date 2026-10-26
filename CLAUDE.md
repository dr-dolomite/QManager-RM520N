## How to Use This File

This file is loaded into **every** session — keep it lean. Everything here is a **golden rule to follow**: the Communication Style, Design Context, and platform truths below are non-negotiable and always apply.

Feature and subsystem knowledge lives in `docs/reference/`, indexed by the **router** (`docs/reference/README.md`) — see Feature Router below. **Do NOT read reference docs preemptively**; open the one the router names for the subsystem you are touching. The same applies to `PRODUCT.md` and `DESIGN.md` — read them for product or UI work, not for backend fixes.

## Communication Style

**Be direct and concise, in plain English.** Say what was found, what was done, and what happens next. Short is better than complete.

- **Lead with the answer** in one line, then only the specifics the user needs to act.
- **Explain the why in one or two sentences** when it changes what the user should do. Skip it otherwise.
- **Jargon is fine when unavoidable** (CGI, RSRP, systemd, flock) — gloss it in a few words the first time, then use it.
- **No idioms, metaphors, or colourful phrasing.** Not "foot gun", "smoking gun", "load-bearing", "the tell", "bites". Name the thing plainly.
- **No lengthy explanations, tutorials, or post-mortem narrative** in a reply. If the long form matters, it goes in the commit body or `docs/reference/`, and the reply points there.
- Trivial answers ("yes", "the file is at X") stay one line.

This applies to every reply: findings, diagnoses, reviews, plans, and status updates. `RELEASE_NOTES.md` has its own end-user tone — see Release Notes below.

## Code Comments

**Hard rule: keep comments brief — one or two lines.** The Communication Style above governs what you write *to the user*, not what you leave in the source. A comment earns its place by naming the one non-obvious thing ("`ro` in `/proc/cmdline` is the authoritative proof, not `/proc/mounts`") and then stopping.

- **No paragraph-length comment blocks.** No `WHY THIS EXISTS` headers, no numbered lists of failure families, no evidence tables, no post-mortems, no measured before/after figures.
- **The long form goes in the commit body or `docs/reference/`.** Git stores it attached to the diff it explains; a reference doc is read when the subsystem is touched. A 40-line comment is read by everyone forever and goes stale silently.
- **Delete rather than narrate.** "What was here before and why it was a bug" is what `git log` is for.
- **Never restate the code.** If the line already says it, the comment is noise.

## Change Workflow

Lean (ported from QManager 2026-10-26): the main session understands, writes and validates; agents are for heavy or parallel work. This replaces the generic brainstorming / writing-plans / verification skills here. **Invoke `superpowers:brainstorming` only when the user asks.** **No test harnesses** — the user's own tarball run is authoritative.

- **Small** (typos, copy, single-file or single-layer fixes outside the risky areas): understand → change → validate.
- **Large** (cross-layer; the **installer / systemd units / sudoers / `/usrdata` layout / rootfs remount / iptables / OTA / AT path (`qcmd`, `qmanager_atd`, lock files)**; anything that can reboot the modem or cut the connection): understand → **short plan, stop for OK** → build → validate → docs. "Just do it" / "skip the plan" / "direct" drops it to small.

1. **Understand.** Read the code path and its router doc. For every bug fix and large change, look at the live device read-only first: past root causes often differed from the first theory. Broad sweeps go to `qm-scout`.
2. **Plan (large).** Files, build order, risks, validation, rollback.
3. **Build** in the main session, bottom-up: backend (poller / CGI / lib / unit) → hook → component. Builder agents only to parallelise independent file sets. Redesign / polish / repolish requests go through the **`qm-redesign-review`** skill first; the approved design is then built here.
4. **Validate.** Run the real thing (device or page load), then the deterministic gates, then a blind `qm-verifier` pass for logic changes — layers and gates in `docs/reference/change-workflow.md`. After 2 failed rounds, stop and ask.
5. **Docs** when behaviour, contracts or invariants change: feature doc, router row, `RELEASE_NOTES.md` if user-visible.

Hard rules:
- **Lifecycle lockstep:** `install_rm520n.sh`, the OTA update path and `uninstall_rm520n.sh` stay in sync (file copy, config seed, unit + wants-symlink, `/tmp` and reload-flag cleanup).
- **Live-state writes during investigation** need the user's OK first.
- **Agent briefs are self-contained:** inline paths, schemas, live evidence and relevant canon.
- **Never auto-merge.** End by reporting branch + git status and asking: merge, keep for PR, or discard.

**Worktrees** for large work or when another session may touch the branch: `EnterWorktree` after plan approval, then confirm its merge-base with `development` (the base has been measured stale). Copy `.env` from the main checkout (confirm `git check-ignore .env`, never commit it); `bun install` + `bunx next typegen` only if a frontend build/`tsc` is needed. Give parallel agents `isolation: "worktree"` only when their file sets overlap.

**"Orchestrate"** = same steps, more delegation: parallel Haiku recon (`qm-scout`) and parallel builders; the main session plans, judges reports with its own reads, holds the approval stop, and still validates.

Agents (`.claude/agents/`, models pinned there — never pass `model`): `qm-scout` (recon), `modem-investigator` (read-only evidence), `cgi-endpoint-builder` / `ui-builder` / `qm-worker` (build), `qm-verifier` / `busybox-portability-checker` / `installer-safety-auditor` (validate), `qm-advocate` (challenge a plan), `docs-writer`.

**Context handoff:** the user-level `context-handoff` hook nudges at ~30% context (hard at 40%). On a `CONTEXT HANDOFF` message, finish the atomic step and run the `context-handoff` skill; an orchestrated task hands off as ORCHESTRATOR. Opt out per checkout with `.claude/handoff.disabled`.

## Design Context

`PRODUCT.md` (what QManager is, users, brand, principles) and `DESIGN.md` (tokens, typography, status chips, layout, motion, Do's and Don'ts) are the canon — **read them before any UI or product-facing work.** `DESIGN.md` is binding: it was written from the shipped `/dashboard` and `/cellular/` index, so `components/dashboard/**` and `components/cellular/radio/**` are the reference implementations when a rule is ambiguous, and its **Migration Deltas** section lists where the canon is ahead of the code.

Rules the build and review enforce most often — the detail and rationale are in `DESIGN.md`:

- **Status chips** are filled tonal `Badge` variants (`success` / `warning` / `destructive` / `info` / `muted`) from `components/ui/badge.tsx`, each with a `size-3` icon — `success-container` and `warning-container` measure 1.03:1 apart, so the glyph is the only separation. Never `variant="outline"` for status, never hand-written classes, never two states sharing a glyph. Identity and metadata (band, radio family, capability, slot) are `Tag`s from `components/ui/tag.tsx`, not badges; the split is compiler-enforced through `BadgeVariant`.
- **Measured signal quality** lives on numerals and bars through `components/cellular/signal-quality-display.ts`, never on chip fills; ramp ink without a bar beside it is a bug; a missing reading is an empty track.
- **CardHeader** is plain `CardTitle` + `CardDescription`, no icons. Primary actions use the default button variant; saves go through `SaveButton` with a translated label.
- **Card-Foot Apply Rule** (user decision, ported from QManager-the101 2026-10-06; supersedes the old page-level save bar): a card that edits a draft commits it from `CardFoot` (`components/ui/card-foot.tsx`), a persistent borderless row on the card's bottom edge. Status on the left; Discard and secondary actions (ghost or `tonal-neutral`, never a stroked `outline`) then `SaveButton` last on the right. Never a mid-card Save, a bar under the card grid, or a sticky bar. Exempt: dialogs and wizards, per-row and inline actions, operational actions. The sweep landed 2026-10-06: no `SaveButton` placement is left off it, and an apply spanning several cards sits on the card it belongs to most (Cellular Settings → Network card); Watchdog gives Ladder and Detection one footer each.
- **Confirmations are toasts** (Toast-Confirms Rule, user decision, ported 2026-10-06): every user-initiated mutation that finishes (save, apply, persistent toggle, add, delete, reset, install, copy) fires one `toast.success` / `toast.error` — plain `sonner`, one sentence, `t()` copy with the key in **all five** catalogs, handler-level, at the terminal moment. The failure reason comes from the call's returned result, never from hook `error` state read after an `await` (stale closure). Effect-based toasts carry a deterministic sonner `id` and never fire for a result merely loaded on mount. Copy goes through `lib/clipboard.ts` `copyText`. A fading "Applied"/"Saved" chip is retired (`SaveButton`'s own Saved flash stays). Exception: a mutation that ends in navigation (the `/reboot/` hand-off, Change Password's redirect to `/login/`) or advances a `/setup` step keeps that transition as its success signal and still toasts failures. Never toast polling, background work, draft edits, or Discard. Traps and RM520N status: `docs/reference/toast-confirmation.md`.
- **Segmented pills** (user decision, ported 1:1 from QManager-the101): a boolean preference or a short mutually-exclusive choice uses `SegmentedField` (`components/ui/segmented-field.tsx`; the caller passes the check glyph through the required `glyph` prop), not a bare `Switch`. New and reworked surfaces only: the 9 files still on `<Switch` (12 sites) are tracked in `DESIGN.md` > Migration Deltas, so don't convert an untouched page.
- **Fact-Is-Info:** a fact worth knowing that is neither a fault nor health is a filled `Badge variant="info"` with a glyph, shown only while it applies. Never a grey outline (reads as disabled), amber (a problem) or green (healthy). On a promoted `primary-container` row the chip dissolves (`.claude/agent-memory/ui-builder/reference-info-chip-dissolves-on-primary-container.md`).
- **Typography:** Rethink Sans for UI including every figure (`tabular-nums`); JetBrains Mono only for opaque strings. The test is "a quantity you read, or an opaque string you compare?" — EARFCN / NR-ARFCN / PCI / band / TAC are quantities (Rethink); ICCID / IMEI / MAC / IP / paths / interface names / raw AT output stay mono even when all-digit. **Fonts are vendored** under `app/fonts/` via `next/font/local`; **never `next/font/google`** — it fetches from Google Fonts on every cold build, so a slow or absent link fails the build, and the device has no guaranteed egress. **Shape:** 8/10/12/16/20px plus pill — `rounded-card` in a grid, `rounded-hero` for the anchor, `rounded-pill` for anything that acts or labels; `card-sheen` (dark-only) belongs to the `Card` root and to every floating surface over a scrim (`DialogContent`, `AlertDialogContent`, `SheetContent`, `DrawerContent`), never an inner tile.
- **Scanning Rules** (`PRODUCT.md` Principle 8): surfaces are scanned, not read. Every element sits on two edges (receipt rows: key left, value right); fix a hard-to-scan list by grouping and varying it, not padding it; a glyph replaces text only if it needs no tooltip; defaults render quiet; at most one inner container per card. Target rules — don't sweep untouched pages.
- **Full-Width Page Rule (hard):** never wrap a feature page in `max-w-*`; a card drawn for a phone recomposes on a wide card (`@5xl/card:` — the card declares `@container/card` at the call site; `Card` does not); cap readability inside a card. **Card-Wrapped Surface Rule:** a feature's settings live inside one self-contained `Card` that the page arranges, never loose fragments on a full-bleed page (`PRODUCT.md` Principle 4, `DESIGN.md` > Layout).
- **Copy & Help** (`PRODUCT.md` Principle 7): convention over explanation; one sentence per page/card description. Jargon and non-dangerous caveats go behind `HintIcon` (a `Popover` toggletip, never `Tooltip`; Material glyph on every route) — about one per settings group, and no tip is the default. Consequences stay visible.
- **No Debug-Build Copy** (user decision, 2026-10-11): user-facing text never exposes implementation detail — no config file paths (`/etc/qmanager/...`, `/usrdata/...`), no "Read back from…" / "Saved to the modem" provenance lines, no script, CGI, daemon or AT-command names — unless the surface exists to show them (AT Terminal, Logs, About Device diagnostics, System Health Check). It makes QManager read as a debug build. Provenance lives in the code comment or `docs/reference/`, not the card; a real fault still gets a plain-language message. Applies to `t()` strings, hardcoded literals, tooltips and placeholders. Before shipping UI copy, grep the diff for `/etc/`, `/usrdata`, `read back`, `saved to`.
- **Responsive** through container queries (`@container/main` or a card-local one); viewport breakpoints only for the page gutter and shell. **Three states** on every data surface — loading, empty, error — with skeletons importing the loaded shape constant, never restating numbers.
- **Motion** comes from `lib/motion.ts`, which mirrors `globals.css`; a raw `duration-200`, `{ duration: 0.25 }` or bare `transition-all` is a bug. Retune both layers together. "Is motion reduced?" is answered only by `useMotionReduced()` / `isMotionReduced()` (ESLint-enforced; `docs/reference/motion-preference.md`).
- **shadcn/ui primitives first**, custom components only where none exists; semantic colour tokens only, never raw Tailwind colours.
- **Icon boundary:** Material Symbols Rounded (self-hosted subset) is scoped to the sidebar, `/dashboard`, the pre-auth `/` and `/login/`, and all of `/cellular/**`; `/setup`, `/local-network/**`, `/monitoring/**`, `/system-settings/**`, `/about-device`, `/support` and the header bar stay on lucide-react. `Banner`, `SaveButton` and `sonner` mount on every route and are pinned lucide; `HintIcon` renders Material on every route. Never mix both sets on one screen, and don't extend the boundary without a deliberate decision. `MaterialSymbol` sets `fontSize` inline, so pass `size` at every call site. A glyph name the type permits but the subset lacks renders as literal text and does **not** fail the build: `bun run icons:check` catches it, and `bun run icons:subset` needs network access to Google Fonts. See `docs/reference/icon-system.md`.
- **Colours are role-based:** `--primary` (hue 262) is the one hue that acts — brand, action, the `info` role and 5G NR identity. `--lte` is identity only, `--downlink` / `--uplink` mean direction and nothing else (a count or a capacity is neutral), `--spatial` is antennas and MIMO, and only success / warning / destructive mean a verdict. Identity and direction never mean "healthy". Values and measurements: `docs/reference/color-system.md`.

## Modem Platforms

QManager's reference target is the Quectel RM520N-GL modem, which runs **vanilla Linux internally** (SDXLEMUR SoC, ARMv7l, kernel 5.4.210 — RM520N-GL measurements, not universal) — NOT OpenWRT on an external host. Per-device facts, including RG501Q-EU, live in `docs/reference/platform-matrix.md`; treat unlisted claims below as RM520N-GL-only until confirmed otherwise. The app (Next.js static export + CGI shell backend) is deployed **onto the modem itself** and is fully standalone. Because the app runs on the device, anything that reboots the modem also kills any in-flight HTTP request — defer reboots via dialog + persistent banner, never `AT+CFUN=1,1` mid-request.

**No battery RTC — every boot starts at Jan 1970.** Stock `ql_time_daemon` steps the clock ~24s into boot (requires a registered SIM; no SIM = 1970 forever), and every armed `OnCalendar` timer misfires **twice** around that step (measured on hardware: ~23s at 1970, ~29s just after) regardless of its real schedule. Any new timer payload must pass the fire guard in `schedule_timer.sh` or use monotonic `OnBootSec=` — see `docs/reference/scheduled-timers.md` ("The 1970 boot window").

### Live Device Access

**Two live devices are reachable over SSH, on distinct subnets** — probe them whenever you can verify an architecture claim directly instead of guessing. Credentials are in `.env` (gitignored, local-only). Use the **modem bridge** MCP servers (`mcp__modem__*` = RM520N-GL, `mcp__modem-rg501q__*`; `modem_exec` / `modem_read` / `modem_write` / `modem_cgi`, serial-checked on connect — `docs/reference/modem-bridge.md`); Posh-SSH (`New-SSHSession` / `Invoke-SSHCommand`) is the fallback. The devices are the source of truth for platform facts; docs drift.

| Device | `.env` vars | Serial |
| --- | --- | --- |
| **RM520N-GL** (SDX6X, BusyBox 1.31.1) — reference target | `RM520N_IP` / `RM520N_SSH_USER` / `RM520N_SSH_PASSWORD` | `61368cd2` |
| **RG501Q-EU** (SDX55, BusyBox 1.29.3) — community tier | `RG501Q_IP` / `RG501Q_SSH_USER` / `RG501Q_SSH_PASSWORD` | `b7e3d6f1` |

The bare `MODEM_*` triad still works and is an **alias for the RM520N-GL**. Older docs describing adb as the RG501Q's only shell are obsolete — that was true before 2026-08-25.

**Comparing the two devices is the highest-yield probe there is — so do it first.** Every cross-device defect found so far (`wget`, `timeout`, `mountpoint`) came from running a command on both and diffing the result; none came from reading code. For any portability question that is the first move, before dispatching an agent. **Always prove which device answered** (`cat /etc/quectel-project-version`, `grep -o 'androidboot.serialno=[^ ]*' /proc/cmdline`) — a wrong-device capture fails silently.

⚠️ **Check reachability, don't assume it.** Distinct subnets removed the old address collision, but the host must hold an address on **both** to reach both, which is not automatic — and either device may simply be offline (the RM520N-GL frequently is). Verify before concluding a probe failure means a defect.

**Deploying and running a script on the device is the primary way we verify a backend change** — `scp` it up, run it, read the real output. Prefer that over reasoning about the code, and over any test we could write ourselves. Typical read-only probes: `systemctl status <unit>` / `journalctl -u <unit> -n 50`, `/tmp/qmanager_*.json` runtime state, `/etc/qmanager/` + `/usrdata/` config files, `curl -sS http://127.0.0.1/cgi-bin/quecmanager/...` (CGI through lighttpd), `qcmd 'AT+...'` query commands, `pgrep -fa qmanager`, `iptables -t mangle -L -n`, `/proc/net/dev`.

**Safety:** deploying a script and running it read-only is routine and needs no ceremony. **Ask the user first** for anything disruptive — a reboot, `AT+CFUN=1,1`, a factory reset, a service restart, or a config write on a live device: say what you want to run and why, then wait for a yes. Never echo `.env` values into transcripts; reference the variable names. Deep investigation belongs to `modem-investigator`; portability residue a single run cannot show goes to `busybox-portability-checker`.

### Platform facts

Vanilla Linux, **systemd** (`.service` units in `/lib/systemd/system/`, boot persistence by wants-symlink, not `systemctl enable`), config in files under `/usrdata/` and `/etc/qmanager/`, lighttpd (Entware) serving CGI as `www-data`, iptables direct on `rmnet+`, `/bin/bash` available beside BusyBox applets, Entware opkg at `/opt`. **Rootfs:** `/` is UBIFS and boots `ro` (proof is `ro` in `/proc/cmdline`, not `/proc/mounts`); `/etc`, `/usrdata`, `/opt` are always `rw`. Rootfs writes remount `rw` once, `sync`, and **never restore `ro`** — contract in `docs/BACKEND.md` §2.1. **AT commands** go through `qcmd`, which fails by exit status and stderr — `ERROR` never reaches stdout — and QManager can never consume URCs; see `docs/reference/at-command-transport.md`. The full platform architecture, the legacy RM551E (OpenWRT) comparison, and install/runtime internals are in `docs/rm520n-gl-architecture.md` and `docs/reference/qmanager-independence.md`; per-device facts in `docs/reference/platform-matrix.md`.

`simpleadmin-source/` is the original RM520N-GL admin panel, kept for reference; QManager does not depend on it.

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

## Feature Router

**`docs/reference/README.md` is the router**: one row per reference doc, listing the routes, scripts, symbols and config keys that mean a task touches that subsystem. **Before editing anything under `scripts/`, `components/`, `hooks/`, `app/`, `lib/`, `types/` or `public/locales/`, open the router and read the doc for the subsystem you are touching.** The docs hold the invariants and ordering rules that are not visible from the code — a field whose absence means true, a verb that must never be wired, a write that must go through a shared primitive. Read only the matching doc; the rest wastes context. When delegating, read it once and name the paths in the agent's brief.

One doc applies to every handler rather than one subsystem: before writing or changing any save / apply / toggle / delete / install / copy handler, a `toast.*` call, a failure reason shown from a handler, or a transient Saved/Applied chip, read `docs/reference/toast-confirmation.md`.

When you add a feature with non-obvious invariants, write `docs/reference/<feature>.md` and add **one router row** — never a summary here.
