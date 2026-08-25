# Hardware Identity Profile (`platform.json`) & Boot Self-Heal

> **Applies to:** RM520N-GL (SDX65) and RG501Q-EU (SDX55) — the mechanism is
> device-independent; the *values* it writes differ per device. Per-device facts
> live in [`platform-matrix.md`](./platform-matrix.md).

`/etc/qmanager/platform.json` is a small, **advisory** record of what hardware
QManager is running on: which modem model, which SoC (the system-on-chip the
modem's Linux runs on), what physical package, which support tier, and a
fingerprint of the firmware build. It exists so that code which needs to behave
differently per device does not have to re-parse the Quectel vendor version file
every time it wants to know what it is running on.

The file was originally written **once**, by the installer, at preflight. That
was a trap: nothing rewrote it afterwards, so a device that installed under one
schema could never pick up a later one, and a modem reflashed independently of
QManager would keep asserting its old firmware build forever. As of commit
`581a861`, `qmanager_setup` re-checks the profile on **every boot** and
regenerates it when it has drifted. That check is `qm_hw_self_heal`.

> ⚠️ WARNING: **The profile is advisory and is never a security boundary.**
> `/etc/qmanager` is owned by `www-data` and `qmanager_setup` re-`chown`s the
> whole directory to `www-data` on every boot, so `www-data` can replace this
> file at will. No privilege, authentication, or tier-enforcement decision may
> consult it. See
> [qmanager-independence.md](qmanager-independence.md#-nothing-that-must-be-protected-from-www-data-may-live-in-etcqmanager).

## Quick Reference

| Thing | Value |
| ----- | ----- |
| Profile path | `/etc/qmanager/platform.json` |
| Mode / owner after a write | `0644`, then `www-data:www-data` (the boot `chown -R` on the next line) |
| Library | `scripts/usr/lib/qmanager/hw_profile.sh` — the **single writer** |
| Boot entry point | `qm_hw_self_heal /etc/qmanager/platform.json`, called from `scripts/usr/bin/qmanager_setup` |
| Install-time entry point | `qm_hw_write_profile "$CONF_DIR/platform.json"`, called from `install_rm520n.sh`'s `preflight()` |
| Schema constant | `QM_HW_SCHEMA` in `hw_profile.sh` (currently `1`) |
| Source of truth for every field | `/etc/quectel-project-version` (overridable in tests via `QUECTEL_VERSION_FILE`) |
| Log destination | `/tmp/qmanager.log` (overridable in tests via `QM_HW_LOG_FILE`) — **not** stdout |
| Test harness | `scripts/test/hw-profile.sh` (65 assertions; 4 symlink cases SKIP on Windows) |

Example, read live from the RG501Q-EU on 2026-08-26:

```json
{
  "schema": 1,
  "model": "RG501QEU_VD",
  "soc": "SDX55",
  "form_factor": "lga",
  "tier": "community",
  "fw_fingerprint": "RG501QEUAAR12A11M4G_04.202",
  "caps": {}
}
```

Note the model is the **suffixed vendor string** (`RG501QEU_VD`), not the
marketing name `RG501Q-EU`. Glob patterns (`RG501Q*`) survive that suffix; exact
string comparisons do not.

## The format is line-oriented, and that is load-bearing

`platform.json` is valid JSON, but nothing on the boot path parses it as JSON.
The reader is a pair of `sed` **line matchers** anchored on
`^[[:space:]]*"key"[[:space:]]*:` — `_qm_hw_read_schema` and
`_qm_hw_read_fw_fingerprint`. The generator's `printf` block emits exactly one
key per line to match.

The reason is `jq` (the standard command-line JSON processor): it is not usable
here. See [Why no `jq`](#why-no-jq) below — the reason is narrower than it looks
and two commonly-repeated explanations for it are false.

Consequences you need to hold onto:

- **Compact single-line JSON (`{"schema":1,...}`) will not match at all.** The
  reader sees "schema absent" and regenerates. That is survivable exactly once:
  the regenerated file is always written in this library's own line-oriented
  format, so the next read converges.
- **Never hand-edit this file into compact form**, and never introduce a second
  writer that emits compact JSON. There is only one writer for exactly this
  reason — two would drift on field order, tier string, or schema number, and
  the file would flip-flop between install-time and boot-time content.
- The fingerprint comparison is **escaped-to-escaped**: the on-disk value is
  compared against `_qm_hw_json_escape "$(qm_hw_fw_fingerprint)"`, never against
  the raw value. That round-trips correctly for hostile values containing `\"`
  or `\\`, and the harness pins the coupling — if the escaper ever changes, the
  test fails there instead of silently rewriting every fielded device on every
  boot.

## The regeneration triggers

`_qm_hw_regen_reason` is the single decision function. It prints a short reason
string and exits 0 when the profile should be regenerated; it prints nothing and
exits 1 otherwise. `qm_hw_profile_needs_write` is a thin 0/1 predicate wrapper
around it.

| Trigger | Reason string logged | Notes |
| ------- | -------------------- | ----- |
| Profile absent | `profile absent` | Checked **after** the symlink/directory refusal, because `[ -e ]` follows a symlink and would misreport a dangling one as "absent" |
| Profile present but unreadable | `profile unreadable` | |
| `schema` absent, empty, or not a bare integer | `schema absent or non-numeric` | Validated with a `case` glob **before** any `-eq` test — `qmanager_setup` has no `set -e`, so a numeric test on a string would print a shell error and behave unpredictably rather than failing loudly |
| `schema` differs from `QM_HW_SCHEMA` **in either direction** | `schema N (want M)` | See below — a *higher* number regenerates too |
| `fw_fingerprint` differs from the live `Project Rev` | `fw_fingerprint drift` | Only evaluated when the schema already matched |

Everything matching is the silent every-boot no-op. A converged device writes
**nothing** to the log, which is deliberate: a success line here would mean one
new line in `/tmp/qmanager.log` on every boot forever.

### Why a *higher* on-disk schema also regenerates

This is a deliberate departure from the obvious "regenerate when absent or
lower" rule, and it is worth understanding before someone "fixes" it back.

`platform.json` sits in a directory `www-data` owns, and a live device was found
with the file at mode `0666`. The reader takes the **first** matching line. So if
a higher schema number were treated as "already migrated, leave alone", anyone
who can write that file could plant a single line — `"schema": 999,` — and freeze
`model`, `soc`, `tier` and `fw_fingerprint` at attacker-chosen values for the
life of the device, with no path back. The profile is advisory, so that is not a
privilege escalation, but it *is* a terminal state that no later release could
recover from.

Regenerating on any mismatch is idempotent and cheap; the frozen state is
permanent. That trade is not close.

### `QM_HW_SCHEMA` is now a working fleet-wide migration lever

Before the self-heal existed, bumping `QM_HW_SCHEMA` did nothing for
already-installed devices. `config.sh` has **no key-migration primitive** —
`qm_config_init` returns early on any non-empty file — so a field added in a
later schema would never reach a device that upgraded over OTA.

With `qm_hw_self_heal` on the boot path, bumping the constant is a real
migration: every device rewrites its profile on its next boot after the update
lands. If you add a field to the generator, **bump `QM_HW_SCHEMA` in the same
change**, or fielded devices keep the old field set indefinitely.

## The refuse arms, and why they exist

Two shapes at the profile path are **refused outright** rather than regenerated
over. Both refusals are logged, and both exist to prevent a silent every-boot
rewrite of `ubi2_0` flash.

```
qm_hw_self_heal: refusing to touch /etc/qmanager/platform.json -- it is a symlink or a directory, not a plain file
```

- **A symlink.** Writing through it puts root's JSON wherever the link points.
  Leaving it in place also preserves the evidence that someone planted it —
  deleting an attacker's link is a courtesy that destroys the only record of the
  attempt.
- **A directory.** This arm is not hypothetical tidiness. `mv "$tmp" "$dest"`
  onto a directory does not fail — it moves the temp file *inside* it and exits
  `0`. Meanwhile `sed` on a directory reads as empty, so the decision function
  would see "schema absent" and regenerate. Without the refusal, the profile
  would be "successfully written" and re-decided as stale on every single boot,
  forever, churning flash while every log line claimed success.

### The converge re-check

After a successful write, `qm_hw_self_heal` re-runs the same decision. If the
just-written file *still* reads as needing regeneration, this boot's writer and
this boot's reader disagree about the format:

```
qm_hw_self_heal: wrote /etc/qmanager/platform.json but it did NOT converge (trigger: ...) -- read-back still says regenerate, see hw_profile.sh
```

Same purpose as the refusals: turn a writer/reader disagreement into **one loud
log line** instead of an invisible flash-churning loop. The realistic way to
trigger it is a format change on one side only — compact JSON, or a changed
escaper.

## The deferral guard

`qm_hw_write_profile` re-derives every field from the live vendor file from
scratch and has **no merge mode**. So if `/etc/quectel-project-version` were
transiently unreadable at the moment a trigger fired, regenerating would
overwrite a perfectly good profile with all-`unknown` fields.

The guard: when a trigger has fired **and** all three identity accessors
(`qm_hw_model`, `qm_hw_soc`, `qm_hw_fw_fingerprint`) return `unknown`, the write
is skipped and the existing profile is left untouched:

```
qm_hw_self_heal: regeneration DEFERRED (schema 1 (want 2)) -- live vendor file unreadable, existing profile at /etc/qmanager/platform.json left untouched
```

**The deferral names the trigger it deferred.** That is the point: a device that
can never migrate its schema and never says why is exactly the failure this whole
mechanism exists to prevent. A deferral that swallowed a schema bump silently
would recreate it.

## Logging: `/tmp/qmanager.log`, never stdout

Every self-heal decision that is not the silent no-op goes to
`/tmp/qmanager.log` via `_qm_hw_log`, which is best-effort — logging must never
abort the boot, so every failure mode inside it is swallowed.

> ⚠️ WARNING: do not "improve" this by echoing to stdout instead. Two facts make
> that unobservable on these devices:
>
> - `qmanager-setup.service` sets **no `StandardOutput=`**, so it takes
>   systemd's default, `journal`.
> - **journald has no storage here.** `journalctl -u qmanager-setup` reports
>   *"No journal files were found"* on **both** devices.
>
> A message written to stdout therefore leaves no record at all. `/tmp/qmanager.log`
> is the only trace a self-heal decision leaves behind.

`qmanager_setup` seeds `/tmp/qmanager.log` `root:root` mode `0666` about thirty
lines above the `qm_hw_self_heal` call, so no ownership or mode work belongs in
the library. That seed is not optional — see
[tmp-file-ownership.md](tmp-file-ownership.md) for why `root:root 0666` is the
only ownership both UIDs can write on the RM520N-GL.

## Why no `jq`

Short version: on the reference device, `qmanager-setup` starts running **before
`/opt` is mounted**, and every `jq` on the box lives behind that mount. A
`jq`-based staleness guard would silently yield empty output and either
regenerate on every boot or never regenerate at all, logging nothing either way.

The mechanism, measured on both devices 2026-08-26:

- **`jq` is on the boot `PATH`, but resolving it requires `/opt`.**
  `/usr/bin/jq` exists and is on the systemd `PATH`
  (`/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`) — but it is a
  **symlink to `/opt/bin/jq`** on both devices. So `command -v jq` succeeds
  while the binary behind it is unreachable until `opt.mount` is active. This is
  the same "a thing named X is not an X that behaves as required" trap that
  produced the `wget`, `timeout` and `mountpoint` defects.
- **`qmanager-setup.service` declares no `After=opt.mount`** — its resolved
  `After=` is `systemd-journald.socket basic.target system.slice sysinit.target
  qmanager-firewall.service` — so nothing orders it after that mount.
- **On the RM520N-GL the race is real and it is lost by 0.29 s.** Monotonic boot
  timestamps: `qmanager-setup` `ExecMainStart` at **28.113 s**, `opt.mount`
  active at **28.404 s**. Setup begins before `/opt` exists.
- **On the RG501Q-EU the same code is safe by 20 s** — `opt.mount` active at
  **5.021 s**, setup starting at **25.226 s**. A `jq` call in the boot path would
  therefore work on the community-tier device and fail on the reference one:
  precisely the divergence that makes single-device testing untrustworthy.

`opt.mount` **does exist** on both (`Bind /usrdata/opt to /opt`, `loaded
active`); `/opt` is a bind of `/usrdata/opt` on the same `/dev/ubi2_0` volume as
`/etc`. The volume being always-available is not the point — the *bind* is what
lands late.

> ⚠️ WARNING: **one commonly repeated explanation is false, and one "correction"
> of it was also false.** Both are recorded here because each would lead someone
> to relax the constraint.
>
> - **False:** "the RG501Q-EU has no `jq` at all." It does — `/opt/bin/jq`,
>   `jq-1.7.1`, present since the successful install of 2026-08-25.
> - **False:** "there is no `opt.mount`, and the real reason is that `/opt/bin`
>   is not on the systemd `PATH`." Both halves are wrong: the unit exists on both
>   devices, and `jq` *is* reachable by `PATH` via the `/usr/bin/jq` symlink.
>   This wrong correction reached the body of commit `581a861`; the measurements
>   above supersede it.
>
> The operative reason is the **boot-ordering race**, and it is the original one.
> Parsing is `grep`/`sed`, verified on BusyBox 1.31.1 and 1.29.3.
>
> If you ever genuinely need `jq` in the boot path, the fix is
> `After=opt.mount` on the unit — not a `PATH` edit, which would not help,
> because the symlink already resolves through `PATH` and still points into an
> unmounted directory.

Related: the Entware `jq` on the RM520N-GL is built without ONIGURUMA, so
`gsub`/`test`/`match` abort at runtime anywhere else you use it. That is a
separate constraint — see [alerts.md](alerts.md).

## No fire guard, no mtime check

Two mechanisms that are mandatory elsewhere in QManager are deliberately absent
here.

- **No 1970 boot-window fire guard.** These devices have no battery-backed
  real-time clock, so every boot starts at Jan 1 1970 until `ql_time_daemon`
  steps the clock ~24 s in. Every armed `OnCalendar` timer misfires twice around
  that step (see [scheduled-timers.md](scheduled-timers.md)). `qm_hw_self_heal`
  is immune: it runs **synchronously inside the `qmanager-setup` oneshot**, not
  from a timer, and every comparison it makes is a string diff. There is nothing
  for a clock step to perturb.
- **No mtime-based staleness check.** `/etc/qmanager/last_iccid` on the RG501Q-EU
  is stamped `Jan 1 00:00` because something writes it under the 1970 clock every
  boot; an mtime test would read that as ~56 years stale. **The fingerprint is
  content, never a timestamp.**

## The write path and its symlink defence

`qm_hw_write_profile` is the only function that writes the file. Its ordering is
load-bearing:

1. Refuse if `$dest` is a symlink or a directory.
2. If `${dest}.tmp` is a **symlink**, refuse and leave it in place (evidence). If
   it is a **regular** file, clear it — a stranded temp from a crash between the
   write and the `mv` cannot redirect anything, and leaving it would wedge every
   future write behind noclobber.
3. Write the temp inside `( set -C; … )` — the shell's `noclobber` option, which
   gives the redirect `O_CREAT|O_EXCL` semantics, so the kernel itself refuses if
   anything now occupies that path.
4. `chmod 0644` before the `mv`, so the mode does not depend on the caller's
   umask.
5. `mv` the temp over `$dest`.

The threat this closes is described in full — including why `[ -f ]` is not a
guard and `[ -L ]` is, and why `fs.protected_symlinks=1` does not help in this
directory — under
[Any root helper writing into `/etc/qmanager` with a plain `>` is redirectable](qmanager-independence.md#-any-root-helper-writing-into-etcqmanager-with-a-plain--is-redirectable).
Read that before writing **any** root helper that targets this directory: only
this one writer has been fixed.

> ⚠️ WARNING: the destination directory is **not** created here. Callers own
> directory creation, with `install -d -m 0755` and never `mkdir -p` (which
> no-ops on an existing directory and so lets a bad mode persist across every
> OTA). A missing parent makes the function return `1` with no side effect.

## Two identity axes, never collapsed

`hw_profile.sh` keeps model and SoC separate on purpose:

- **`model`** (`Project Name:`) governs form factor and peripherals.
- **`soc`** (`Branch  Name:` — note the **two** spaces) governs counter
  orientation, IPA quirks, and udev rules.

Never merge them into a single "platform" string. And note that
`scripts/usr/lib/qmanager/platform.sh`, despite its name, is something else
entirely — it is the init-system abstraction (`svc_start` / `svc_enable` /
`run_iptables`) left over from the OpenWRT port. Hardware identity lives in
`hw_profile.sh`.

The vendor file's labels are column-aligned and three of the five are not what a
naive parser expects. The exact spellings, the traps, and the shared matcher
idiom are documented once in
[platform-matrix.md](./platform-matrix.md) — use `hw_profile.sh` rather than
writing a fourth ad-hoc `grep`.

## Tier table

`tier` is **advisory**. Nothing may gate a privilege or auth decision on it.

| Match on `Project Name` | Tier | Installer behaviour |
| ----------------------- | ---- | ------------------- |
| `RM551E*` | `incompatible` | hard die — wrong architecture (OpenWRT) |
| `RM520N*` | `official` | proceed, full profile |
| `RG501Q*` | `community` | proceed, full profile |
| known SoC (`SDX6X` / `SDX55`), unknown model | `community` | proceed, inferred from the SoC axis |
| unknown SoC / unparseable | `fallback` | proceed, conservative defaults |

RG501Q-EU is `community` in Phase A, not `official`; that promotion is Phase C's
deliverable.

## Consumers

As of commit `581a861` there are **two writers and no readers**: the installer's
`preflight()` and `qmanager_setup`'s boot call. Nothing in the CGI backend or the
frontend reads `platform.json` yet.

If you add a reader, remember two things: the file is `www-data`-writable (so
treat every field as untrusted input for anything beyond cosmetics), and there is
a live window on every install where the CGI serves requests before the profile
exists — `install_rm520n.sh` restarts lighttpd before it restarts
`qmanager-setup`. Fall back to reading `/etc/quectel-project-version` directly
rather than assuming the profile is there.

## Related docs

- [platform-matrix.md](./platform-matrix.md) — every per-device fact, including
  the vendor-file label traps and the `/opt` volume topology
- [qmanager-independence.md](qmanager-independence.md) — the `/etc/qmanager`
  ownership rules and the plain-`>` symlink hazard
- [tmp-file-ownership.md](tmp-file-ownership.md) — why `/tmp/qmanager.log` is
  seeded `root:root 0666`
- [scheduled-timers.md](scheduled-timers.md) — the 1970 boot window this
  mechanism is immune to
