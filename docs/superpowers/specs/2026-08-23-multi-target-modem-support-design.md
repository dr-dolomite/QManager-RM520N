# Multi-Target Modem Support (RG501Q-EU / SDX55)

**Date:** 2026-08-23
**Status:** Approved design — Phases A0/A specced, Phases B/C outlined
**Scope:** Promote QManager from an RM520N-GL-only project to a declared multi-target
one, with RG501Q-EU (LGA, SDX55/PRAIRIE) as the second officially supported modem.

---

## 1. Problem

QManager is built and named for the RM520N-GL (M.2, SDX65/LEMUR). We intend to
officially support the RG501Q-EU: an **LGA** module on the SDX55 platform.

The starting question was "new branch, or clone the repo?" Investigation showed
both framings miss the actual situation.

### The repo is already multi-target, undeclared

Evidence found in the existing tree:

| Evidence | Location |
| --- | --- |
| Poller already branches on SoC | `scripts/usr/bin/qmanager_poller:68` — `detect_orientation_from_soc()` maps `SDX55` to `reversed` |
| A test already asserts that branch | `scripts/test/poller-data-used.sh:194` |
| A whole doc of X55/X65 behavioral deltas exists | `docs/reference/data-counter-platform-matrix.md` |
| A udev rule was deliberately written portable | `docs/BACKEND.md:1025` — omits `SUBSYSTEM==` because it "differs on PRAIRE-derived platforms (RG502Q/RM502Q)" |
| Users already run these releases on X55 hardware | RM502Q-AE, in the field, unsupported and undetected |

### The `RM520` string count is misleading

Grepping the backend, essentially every hit is cosmetic or infrastructural,
not behavioral:

| Category | Approx. hits | Example |
| --- | --- | --- |
| GitHub repo / OTA URL | 8 | `qmanager_auto_update:61` |
| Installer filename | 7 | `install_rm520n.sh` — also the tarball integrity sentinel (`qmanager_update:165`) |
| Cosmetic default | 1 | `system_config.sh:22` — hostname fallback `"RM520N-GL"` |
| Smoke-test string match | 4 | `qcmd_test:50,75` |
| Genuine behavioral caveat | 1 | `apn.sh:745` — no per-context MTU write |

There is **no** model gate in the AT layer, the band tables, or any CGI endpoint.
The poller already reads `AT+CGMM`.

**Conclusion:** this is not a port. It is promoting an accidental capability into
a declared one, and adding a place to put genuinely LGA-specific code.

---

## 2. Decisions

Each was decided explicitly during design.

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | **One repo. No fork.** | Shared surface is ~99% (283 components, 205 scripts, the entire AT/auth/SMS/i18n stack). A fork pays a permanent cherry-pick tax on the 99% to isolate the 1%. |
| D2 | **Repo keeps the name `QManager-RM520N`.** | Renaming touches 6 hardcoded OTA constants. Zero technical benefit today. RM520N-GL remains the reference device. |
| D3 | **Divergence lives in build-time variant overlays, not branches.** | A branch is a source-control concept; what is needed is a build-target concept. Overlays give per-modem files with no merge debt. |
| D4 | **Per-variant release assets, one release tag.** | OTA detects the modem and fetches the matching asset. Requires no new branch and no change to the URL security whitelist beyond one pattern. |
| D5 | **The installer still self-detects.** | Three jobs: generate the platform profile, assign the support tier, and reject a variant tarball installed on the wrong modem. |
| D6 | **Platform profile is generated at install and self-heals on firmware change.** | See §4.2. |
| D7 | **Unknown modems get a best-effort profile inferred from SoC.** | Never blocks. Preserves today's de-facto behavior for RM502Q-AE users, but stops guessing wrong. |
| D8 | **No new long-lived branches. `development` stays the integration base.** | OTA is tag-gated, not branch-gated — see §3. Each phase gets a throwaway worktree per `docs/reference/change-workflow.md:102`. |
| D9 | **Every platform fact carries provenance.** | See §5. Without this, RM520N measurements silently contaminate RG501Q work. |
| D10 | **Docs/context re-optimization is its own phase (A0), done before any code.** | It is pure documentation — zero regression risk — and every later phase inherits its context model. Probing (B) then files results into a structure that already exists rather than into an undifferentiated pool. |

### Rejected: a long-lived `rg501q` branch

Considered seriously, because LGA vs M.2 implies genuinely different exposed
peripherals (RGMII/`eth0`, USB gadget, GPIO, LED). Rejected on three grounds:

1. **It is forbidden by the current security model.** `qmanager_update:validate_url()`
   whitelists `releases/download/*/qmanager.tar.gz` and, only in non-strict
   *install* mode, `raw/*/qmanager-build/qmanager.tar.gz`. OTA uses **strict**
   mode, which rejects the `raw/` path. Serving OTA from a branch requires
   widening that whitelist to accept arbitrary refs — the exact control that
   stops a hijacked update pointer from fetching arbitrary code onto a modem.
2. **Shared fixes would ship twice, forever.** At the observed velocity
   (263 commits in 90 days, most touching shared code), the cherry-pick tax
   compounds daily.
3. **The divergence size is not yet known.** It is what Phase B measures. An
   overlay scales to whatever probing finds — 4 files or 200 — with an identical
   mechanism. A branch decision must be made *before* the evidence exists, and
   un-making it means reconciling two histories. **The overlay is the cheap path
   to the branch, if the branch later proves right.**

---

## 3. Why branches would not have protected users anyway

`main` is at `v0.1.12`, last commit **2026-05-24** — 263 commits and three months
behind `development` (`v0.1.14-draft`). It has caused zero user impact, because:

**OTA is tag-driven, not branch-driven.** `qmanager_update:147` and
`qmanager_auto_update:61` fetch published GitHub *Release assets*. No shipped
device reads a branch. What protects RM520N users is **not publishing a release**.

*Unrelated but worth tracking:* because `origin/HEAD` points at `main`, GitHub's
landing page currently shows visitors a `v0.1.12` README and install instructions.
Fixing that is a fast-forward at the next stable release. **Out of scope here.**

---

## 4. Architecture

### 4.1 Two identity axes, kept separate

The installer and the poller already read *different fields* of
`/etc/quectel-project-version`, and this is correct — they are different axes,
and the known divergences split along both:

| Axis | Field | Read today by | Governs |
| --- | --- | --- | --- |
| Model | `Project Name:` (`RM520N…`) | `install_rm520n.sh:367` | Form factor, peripherals, capability deltas (e.g. MTU write) |
| SoC | `Branch Name:` (`SDX65`/`SDX55`) | `qmanager_poller:70` | Counter orientation, IPA quirks, udev subsystem |

The profile keeps both explicit. It must never collapse them into one "platform"
string.

### 4.2 The platform profile

Generated at install into `/etc/qmanager/platform.json`:

```json
{
  "schema": 1,
  "model": "RG501Q-EU",
  "soc": "SDX55",
  "form_factor": "lga",
  "tier": "official",
  "fw_fingerprint": "<verbatim Project Rev line>",
  "caps": { "...": "populated in Phase C" }
}
```

**Self-heal (D6).** Modem firmware can be reflashed independently of QManager, and
`data-counter-platform-matrix.md:79` documents behavior differing by *firmware
build* (`_A0.303`), not only by SoC. So a frozen profile can silently go stale.
`qmanager_setup` regenerates the profile at boot when either:

- `schema` is absent or lower than the current schema version, or
- `fw_fingerprint` no longer matches the live `/etc/quectel-project-version`.

This also solves a known trap: **`config.sh` has no key-migration primitive** —
`qm_config_init` only seeds an empty file, so a key added later never appears on
OTA-upgraded devices. Schema-versioned regeneration gives the profile its own
migration path from day one.

**Constraint:** `/etc/qmanager/` **cannot hold a root-pinned file** — `www-data`
owns the directory and `qmanager_setup` re-chowns it every boot. The profile is
therefore advisory configuration and must never be treated as a security boundary.

### 4.3 Name collision to avoid

`scripts/usr/lib/qmanager/platform.sh` is, despite its name, the **init-system**
abstraction (`svc_start`, `svc_enable`, `run_iptables`) — a leftover of the
OpenWRT-to-systemd port. It has nothing to do with hardware platform. **SoC/model
logic must not go there**, or "platform" comes to mean two unrelated things in one
tree. New logic lands in a distinctly named lib (e.g. `hw_profile.sh`).

### 4.4 Support tiers

The tier model already exists, unnamed, at `install_rm520n.sh:369-409`. Phase A
formalizes the inline `case` into a table:

| Match | Tier | Behavior |
| --- | --- | --- |
| `RM551E*` | incompatible | Hard `die` — wrong architecture (OpenWRT). **Unchanged.** |
| `RM520N*` | official | Proceed, full profile |
| `RG501Q*` | official *(after Phase C)* | Proceed, full profile |
| Known SoC, unknown model | community | Proceed, profile inferred from `Branch Name` |
| Unknown SoC / unparseable | fallback | Proceed, conservative SDX6X defaults |

**Load-bearing behavior that must be preserved:** when no terminal is available,
the unrecognized-device path **auto-proceeds with a warning** rather than aborting
(`install_rm520n.sh:399-409`). Pre-v0.1.8 `qmanager_update` workers do not pass
`--force`, so dying there silently breaks OTA on variant devices. Any refactor of
this block must keep the headless auto-proceed.

Per D7, tiers are **not** surfaced in the UI in this phase.

### 4.5 Build: variant overlays

`build.sh` today stages into `$BUILD_DIR/qmanager_install` and emits a single
`qmanager.tar.gz` (`build.sh:202`). It gains a variant loop:

```
scripts/            shared — AT transport, auth, SMS, alerts, i18n, all CGI
variants/rm520n/    M.2 overlay
variants/rg501q/    LGA overlay
```

For each variant: stage shared, copy the overlay over it, stamp the variant name,
then tar. Overlay files replace same-path shared files; the shared tree is never
modified in place.

### 4.6 Release assets and the backward-compatibility floor

**CRITICAL.** `update.sh:245` does **not** select from the assets array. It
constructs the download URL by string interpolation:

```sh
download_url="https://github.com/${GITHUB_REPO}/releases/download/${latest_tag}/qmanager.tar.gz"
```

`.assets[]` is read only for the size display (`update.sh:234-236`). Therefore
**every device running v0.1.14 or older will request the literal filename
`qmanager.tar.gz` forever.**

Consequently every future release **must** publish:

| Asset | Purpose |
| --- | --- |
| `qmanager.tar.gz` | **Compatibility floor.** Identical to the RM520N build. Dropping it silently 404s OTA on every already-shipped device. |
| `qmanager-rm520n.tar.gz` | Variant-aware clients |
| `qmanager-rg501q.tar.gz` | Variant-aware clients |

New clients select by interpolating the variant name from the profile. The
`validate_url()` whitelist widens by exactly one pattern —
`releases/download/*/qmanager-*.tar.gz` — and the `raw/` path stays
install-mode-only. No branch refs are ever admitted.

**Second sentinel constraint:** `qmanager_update:165` verifies a downloaded
tarball with `tar tzf … | grep -q "install_rm520n.sh"`. That filename must remain
present in **both** variant tarballs, regardless of target modem, or older
updaters reject the payload as corrupt. Renaming the installer is therefore
**out of scope** (see §7).

---

## 5. Context integrity (D9, D10)

Two distinct problems, often conflated. **Provenance** is "can I trust this fact
for my device?" **Navigation cost** is "how much do I pay to find out?" Both are
Phase A0 deliverables.

### 5.A Provenance — the contamination problem

**The problem.** Four layers assert RM520N-GL measurements as unqualified truth,
and three of them are injected into sessions automatically:

| Layer | Injected how | Contamination risk |
| --- | --- | --- |
| `CLAUDE.md` | Every session, always | States kernel 5.4.210, ARMv7l, SDXLEMUR, `/dev/smd11`, `rmnet+` as flat truth |
| Auto-memory (~60 entries) | Recalled by relevance, silently | ~16 are device-measured facts naming no device |
| `.claude/agent-memory/modem-investigator/` | Every investigator run | Device findings, no device scope |
| `docs/reference/*.md` (110 files) | On demand | Written entirely against RM520N |

**The failure mode** is specific: while debugging an RG501Q issue, a memory
surfaces *"/etc is persistent always-RW UBIFS — reboot-proven 2026-08-10"*. It is
trusted *because it says proven*, a check is skipped, and the real bug is missed.
The provenance was genuine — for a different device.

### 5.A.1 The split that matters

Not every fact is at risk. Two categories, and only one needs qualifying:

**QManager's own design — travels with the code, safe to state unqualified:**
CGI docroot is `/usrdata/qmanager/www`; nothing root-pinned survives in
`/etc/qmanager`; `install -d -m 0755` not `mkdir -p`; `config.sh` has no
migration primitive; `qcmd` failure is exit-status-only.

**Measured on RM520N-GL hardware — must name the device:** no working `crond`;
the 1970 boot window and its ~17s timers.target race; `/etc` is persistent
always-RW UBIFS; rootfs boots `ro`; CPU has full VFP so hard-float binaries run;
device `jq` has no ONIGURUMA regex; BusyBox `flock` supports the bare-FD form;
poller cadence ~3.7–4.0s; attach cycle drops the `eth0` link ~4s.

Every fact in the second group could be false on an LGA X55 module, and nothing
in the current setup would say so.

### 5.A.2 Convention

1. **Qualify at the source.** Platform assertions in `CLAUDE.md` and
   `docs/reference/**` name the device: "On RM520N-GL, …" — not "The device …".
   `CLAUDE.md`'s "RM520N-GL Platform" section is retitled and its claims scoped.
2. **Memories carry a device scope.** Any memory recording a device measurement
   names the device in its `description`, so the contamination is visible at
   recall time rather than after acting on it.
3. **Unverified-on-RG501Q is the default.** A Phase-A fact is assumed RM520N-only
   until Phase B measures it. Absence of a contrary measurement is not evidence.
4. **`modem-investigator` is told which device it is on.** Its instructions and
   its memory file are scoped per device; findings from one must not be filed as
   general truth.

### 5.B Navigation cost — the filtering problem

**The concern, stated fairly.** A shared tree means every doc read carries the
question "does this apply to my modem?" A fork would eliminate that question
permanently: every doc in a `QManager-RG501Q` repo is unambiguously about
RG501Q. **Context isolation — not code isolation — is the real argument for a
fork, and it is a genuine one.**

**Measured surface** (`docs/reference/`, 41 files, grep for
`RM520|SDX|LEMUR|smd11|ubifs|rmnet|busybox|/proc/|kernel|udev|ARMv7`):

| | Files | Bytes |
| --- | --- | --- |
| Platform-coupled (>3 hits) | 33 | ~818 KB |
| Effectively agnostic (≤3 hits) | 8 | ~686 KB |

The grep is deliberately broad — `kernel`, `busybox` and `/proc/` also match
shell-design discussion that is QManager's own architecture, not device truth —
so 818 KB is an **upper bound** on coupling. It is nonetheless substantial, and
larger than first assumed.

**Why this still does not favor a fork:**

1. **A fork duplicates the 686 KB of agnostic docs and lets them drift.**
   `DESIGN.md`, `color-system.md`, `icon-system.md`, `cellular-settings-family.md`
   and every feature invariant are modem-independent. Two copies means the design
   canon forks — a worse failure than filtering, because drift is silent.
2. **The 818 KB must be rewritten for RG501Q either way** — that is Phase B. A
   fork does not avoid the work; it only guarantees that every shared fix
   afterward is edited twice.
3. **For divergence, one matrix is cheaper to read than two documents.** The proof
   is already in this repo: `data-counter-platform-matrix.md` is the *most*
   platform-coupled doc (77 hits) and simultaneously the *easiest* to answer a
   per-modem question from, because it places SDX55 and SDX65 in adjacent columns.
   Two forked documents force the reader to open both and diff them mentally.
4. **Per-session cost is bounded by the existing routing table.** `CLAUDE.md`
   already forbids reading reference docs preemptively — one or two docs are
   opened per task, not 41. The real cost is therefore per-*task*, not
   per-*session*, and is closed by making device relevance visible before the doc
   is opened.

**Deliverables:**

- **Scope header on every coupled doc** — `Applies to: RM520N-GL (SDX65) |
  RG501Q-EU (SDX55) | both`, as the first line of the body.
- **Promote `data-counter-platform-matrix.md` to a general `platform-matrix.md`** —
  the single canonical home for device deltas. Feature docs point at it instead of
  restating hardware facts, which is what keeps the 33 coupled docs from each
  growing their own per-device sections.
- **Scope column in `CLAUDE.md`'s routing table** — device relevance known
  *before* opening a doc. This is where the token saving actually lands.
- **Device scope on memories and `modem-investigator`'s memory file** (§5.A.2).

### 5.C Why this is Phase A0

This work is pure documentation: no shipped behavior changes, so regression risk
is zero. It must land **before** Phase B, or probe results get filed into the same
undifferentiated pool and the problem doubles rather than resolving. Every
subsequent phase inherits its context model.

---

## 6. Phases

| Phase | Content | Needs hardware? | Isolation |
| --- | --- | --- | --- |
| **A0** | Context re-optimization (§5): scope headers, `platform-matrix.md`, `CLAUDE.md` scope column, memory + agent-memory device scoping. **Docs only, no code.** | No | worktree `wt/context-scoping` off `development` |
| **A** | Profile generation + self-heal; tier table; `hw_profile.sh`; consumers migrated off ad-hoc parsing; variant overlay build; OTA variant selection + whitelist widening | No | worktree `wt/multi-target-platform` off `development` |
| **B** | Probe RG501Q-EU, fill the delta table | Yes | None — read-only |
| **C** | Populate `variants/rg501q/`, promote tier to `official` | Yes | Fresh worktree off `development` |

**Phases A0 and A are both hardware-independent** — everything in it is derivable from the
current tree. It ships as a **no-op on RM520N-GL**: identical behavior, now
explicit. That is the validation gate — *if RM520N behavior changes at all, the
refactor is wrong.*

**Phase A makes Phase B tractable**: the profile schema becomes the probe
checklist. `modem-investigator` gets a finite table of fields that must differ,
each with a known RM520N value to diff against, instead of an open-ended
exploration.

Only Phases A0 and A are specced here. B and C depend on measurements that do not yet
exist; planning around guessed values is how guesses become load-bearing.

### 6.1 Known Phase-B obstacles

Named now so they are not discovered mid-probe:

1. **`.env` holds one device.** `MODEM_IP` / `MODEM_SSH_USER` / `MODEM_SSH_PASSWORD`
   are singular, and the `modem-investigator` agent's instructions assume *the*
   modem. A second credential set is needed before probing.
2. **Platform-fact contamination** — see §5. Addressed in Phase A0.
3. **`qcmd_test` greps for the literal string `RM520`** (`:50`, `:75`) to decide
   whether the AT transport is healthy. On an RG501Q it reports failure on a
   working device. One-line fix; expensive to debug cold.

---

## 7. Explicitly out of scope

- Renaming the repository (D2).
- Renaming `install_rm520n.sh` — it is the OTA integrity sentinel (§4.6).
- Any RG501Q-specific band, capability, or peripheral work — blocked on Phase B.
- Surfacing support tier in the UI (D7).
- Fast-forwarding `main` (§3) — real, but a separate release-time act.

---

## 8. Open questions for Phase B

To be answered by probing, not by assumption:

- Does `eth0`/RGMII exist on the RG501Q-EU carrier board, and does
  `qmanager_ethernet_apply` apply at all?
- What is the udev subsystem name for `smd11`? (`glinkpkt` on RM520N-GL;
  `BACKEND.md:1025` says it differs on PRAIRE.)
- Do `QGDCNT`/`QGDNRCNT` behave as SDX55 per `data-counter-platform-matrix.md`,
  or has firmware changed it?
- Is the per-context MTU write (`apn.sh:745`) supported?
- Does the rootfs `ro`/`rw` volume layout match (`ubi0:rootfs` + `ubi2_0`)?
- Is there a battery RTC, or does the 1970 boot window apply identically?
- Is `crond` present and working, or is the systemd-timer requirement identical?
- Does the device `jq` have ONIGURUMA regex, and does BusyBox `flock` support the
  bare-FD form?
