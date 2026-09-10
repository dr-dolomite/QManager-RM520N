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

Every code-change request runs under the **`qm-orchestrate`** skill (`.claude/skills/qm-orchestrate/SKILL.md`) — invoke it before triaging any change, and also when the user says "resume", "handoff", or "pick up where we left off" (it reads the run ledger in `.orchestra/runs/`). It supersedes the generic brainstorming / writing-plans / verification skills for code changes. **No test harnesses** — a change is proved by running it on the device or loading the page; the user's own tarball run is authoritative. Skip phrases ("just do it" / "skip the plan" / "direct") go straight to an inline edit.

## Design Context

`PRODUCT.md` (what QManager is, users, brand, principles) and `DESIGN.md` (tokens, typography, status chips, layout, motion, Do's and Don'ts) are the canon — **read them before any UI or product-facing work.** `DESIGN.md` is binding: it was written from the shipped `/dashboard` and `/cellular/` index, so `components/dashboard/**` and `components/cellular/radio/**` are the reference implementations when a rule is ambiguous, and its **Migration Deltas** section lists where the canon is ahead of the code.

Rules the build and review enforce most often — the detail and rationale are in `DESIGN.md`:

- **Status chips** are filled tonal `Badge` variants (`success` / `warning` / `destructive` / `info` / `muted`) from `components/ui/badge.tsx`, each with a `size-3` icon — `success-container` and `warning-container` measure 1.03:1 apart, so the glyph is the only separation. Never `variant="outline"` for status, never hand-written classes, never two states sharing a glyph. Identity and metadata (band, radio family, capability, slot) are `Tag`s from `components/ui/tag.tsx`, not badges; the split is compiler-enforced through `BadgeVariant`.
- **Measured signal quality** lives on numerals and bars through `components/cellular/signal-quality-display.ts`, never on chip fills; ramp ink without a bar beside it is a bug; a missing reading is an empty track.
- **CardHeader** is plain `CardTitle` + `CardDescription`, no icons. Primary actions use the default button variant; saves go through `SaveButton` with a translated label.
- **Typography:** Rethink Sans for UI including every changing numeral (`tabular-nums`); JetBrains Mono only for identifiers and raw machine strings. **Shape:** 12/20/28/36/40px plus pill — `rounded-card` in a grid, `rounded-hero` for the anchor, `rounded-pill` for anything that acts or labels.
- **Responsive** through container queries (`@container/main` or a card-local one); viewport breakpoints only for the page gutter and shell. **Three states** on every data surface — loading, empty, error — with skeletons importing the loaded shape constant, never restating numbers.
- **Motion** comes from `lib/motion.ts`, which mirrors `globals.css`; a raw `duration-200`, `{ duration: 0.25 }` or bare `transition-all` is a bug. Retune both layers together.
- **shadcn/ui primitives first**, custom components only where none exists; semantic colour tokens only, never raw Tailwind colours.

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

**`docs/reference/README.md` is the router**: one row per reference doc, listing the routes, scripts, symbols and config keys that mean a task touches that subsystem. **Before editing anything under `scripts/`, `components/`, `hooks/`, `app/`, `lib/`, `types/` or `public/locales/`, open the router and read the doc for the subsystem you are touching.** The docs hold the invariants and ordering rules that are not visible from the code — a field whose absence means true, a verb that must never be wired, a write that must go through a shared primitive. Read only the matching doc; the rest wastes context. Under `qm-orchestrate` the conductor does this once and puts the paths in each ticket's READ FIRST line.

When you add a feature with non-obvious invariants, write `docs/reference/<feature>.md` and add **one router row** — never a summary here.
