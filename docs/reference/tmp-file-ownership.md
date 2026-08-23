# Cross-UID `/tmp` File Ownership

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

QManager runs as two different users. Root owns the daemons (`qmanager_poller`, `qmanager_ping`, `qmanager_watchcat`, `qmanager_discord`, `qmanager_tower_failover`); `www-data` owns everything lighttpd spawns, which is every CGI script under `scripts/www/cgi-bin/`. Both write shared state into `/tmp`. `/tmp` on this device is `root:root` mode **1777** and the kernel runs with **`fs.protected_regular=1`**, and those two rules together decide — permanently, at file-creation time — which UIDs may ever write a given file. Get the ownership wrong and the losing UID's writes fail silently: `>`/`>>` redirects are almost always wrapped in `2>/dev/null`, and `rm -f` returns 0 whether or not it removed anything. This doc is the single place those rules are stated correctly, because they are counterintuitive and the codebase has already shipped three separate bugs from applying them backwards.

> ⚠️ WARNING: the direction of `fs.protected_regular` is the part everyone gets wrong. In `/tmp`, it blocks **root** from writing a **www-data-owned** file. It never blocks www-data from a root-owned file. If you find a doc or comment claiming the opposite, it is wrong — see [The rule, stated correctly](#the-rule-stated-correctly).

## Quick Reference

| Thing | Value |
| ----- | ----- |
| `/tmp` mode / owner | `root:root` `1777` (tmpfs, ~89 MB, cleared every boot) |
| `fs.protected_regular` | `1` (kernel default on this firmware; confirmed live) |
| Only ownership both UIDs can write | **`root:root` mode `0666`** |
| Where shared files are seeded | `scripts/usr/bin/qmanager_setup` (systemd oneshot, runs as root before every other unit) |
| Seeded shared files | `/tmp/qmanager.log`, `/tmp/qmanager_events.json`, `/tmp/qmanager_profile_state.json`, `/tmp/qmanager_profile_apply.pid` |
| Seeded www-data-only files | `/tmp/qmanager_at.lock`, `/tmp/qmanager_at.pid` (root opens these **read-only**, `9<`) |
| Forbidden on any seeded file | tmp-file + `mv` (`rename(2)` swaps the inode and destroys the seed) |
| Required instead | write **in place** — `>`, `>>`, `cat tmp > file`, `: >` |
| Deliberately **not** seeded | `/tmp/qmanager_recovery_active` (a flag; see [The recovery flag](#the-recovery-flag-the-deliberate-exception)) |

## The two kernel rules

### 1. The sticky bit (`1777`) — who may *unlink*

The `t` in `drwxrwxrwt` means only a file's **owner** — or root, via `CAP_FOWNER` — may `unlink()` or `rename()` over an entry in that directory, no matter what the file's own mode is. Think of it as a coat-check tag: the directory is public, but only the person holding the tag can take a coat off the rack.

Consequences:

- `www-data` can **never** `rm` a root-created file in `/tmp`. `rm -f` still exits 0 (that is what `-f` means), so the failure is invisible unless you check the file afterwards.
- `mv tmp file` from `www-data` onto a root-owned target fails for the same reason.
- Root *can* unlink a www-data-owned file — this direction is unrestricted.

### 2. `fs.protected_regular=1` — who may *open for write*

The sysctl adds a check on `O_CREAT` opens of **regular files** in world-writable sticky directories. The kernel (`may_create_in_sticky()`, `fs/namei.c`) allows the open only when:

> `file_owner == dir_owner` **OR** `caller_uid == file_owner`

Two things about that rule matter enormously:

- **There is no root override.** No capability exempts a caller from this check. Root is subject to it exactly like www-data.
- The escape clause is `file_owner == **dir**_owner`, **not** `dir_owner == caller`. Since `/tmp` is root-owned, "the file is root-owned" satisfies the first clause *for every caller*.

Shell `>` and `>>` both pass `O_CREAT` internally even when the file already exists, so ordinary redirects trigger this.

### The rule, stated correctly

For a regular file sitting in `/tmp` on this device:

| File owner | www-data may open for write? | root may open for write? | www-data may unlink? | root may unlink? |
| ---------- | --------------------------- | ------------------------ | -------------------- | ---------------- |
| **`root`** (matches dir owner) | ✅ yes — if the mode permits | ✅ yes | ❌ no (sticky) | ✅ yes |
| **`www-data`** | ✅ yes (caller owns it) | ❌ **no — EACCES, no override** | ✅ yes | ✅ yes |

Read the second row twice. A www-data-owned file in `/tmp` is a file **root cannot write**, and no `chmod` fixes it — mode is not the gate here, ownership is. That is why `root:root 0666` is the only ownership under which both UIDs can write the same `/tmp` file.

> ℹ️ NOTE: this is specific to `/tmp` (and any other `+t` directory). `/usrdata/` and `/etc/qmanager/` are not sticky, so neither rule applies there. `/etc/qmanager` has its own, unrelated hazard — it is *owned* by www-data, so nothing root-pinned can survive in it; see [qmanager-independence.md](qmanager-independence.md).

### Two mechanisms, frequently conflated

Mode and ownership are separate gates and they fail differently:

- **Mode `0644`** on a root-owned file blocks www-data because the `w` bit is missing for others. This is ordinary Unix permissions, nothing to do with the sysctl. It is what actually broke `/tmp/qmanager_events.json`.
- **`fs.protected_regular`** blocks *root* from a *www-data-owned* file, at any mode including `0666`.

A bug report that says "protected_regular blocked www-data" is almost certainly a plain mode problem wearing the wrong name.

## The seeding contract

`qmanager_setup` runs as root at boot, before any other QManager unit, and pre-creates every shared `/tmp` file:

```sh
touch /tmp/qmanager.log \
      /tmp/qmanager_profile_apply.pid /tmp/qmanager_profile_state.json \
      /tmp/qmanager_events.json
chown root:root ...
chmod 666 ...
```

The seed exists because **whoever creates the file first decides its ownership for the whole boot**, and that is a race between a root daemon starting and the first CGI request. Seeding takes the race off the table.

`/tmp/qmanager_at.lock` and `/tmp/qmanager_at.pid` are deliberately `www-data:www-data` instead. Root only ever opens the lock **read-only** (`qcmd` holds the `flock` via `9<`), and `flock()` does not care whether the FD is readable or writable — so no `O_CREAT` write ever happens from root and `protected_regular` never engages. See [at-command-transport.md](at-command-transport.md).

### Every writer of a seeded file must write in place

This is the rule that keeps getting broken, because it contradicts the project's normal "atomic write" habit.

```sh
# WRONG — destroys the seed
jq -n '...' > "$FILE.tmp" && mv "$FILE.tmp" "$FILE"

# RIGHT — keeps the seeded inode, its owner and its mode
jq -n '...' > "$FILE.tmp.$$" && cat "$FILE.tmp.$$" > "$FILE"; rm -f "$FILE.tmp.$$"
```

`rename(2)` replaces the directory entry with a **different inode** — one owned by whoever wrote the temp, at their umask (root's `0022` gives `0644`). The seed's ownership is gone from that moment, and the other UID is locked out for the rest of the boot. A single remaining `mv` anywhere in a file's write path re-breaks it.

`>`, `>>`, `cat src > dst` and `: >` all write **through** the existing inode and preserve owner and mode.

Two corollaries:

- **Shared ownership and rename-atomicity are mutually exclusive in `/tmp`.** You give up atomic publication, so a reader can observe a partially written file. Readers of these files must be fail-soft: validate the JSON (`jq -e .`) and degrade to a valid envelope rather than forwarding torn bytes. `profiles/apply_status.sh` is the worked example — it re-reads and re-validates immediately before serving, with a bounded retry and an honest `"applying"` floor.
- **Never use a fixed `${FILE}.tmp` scratch name.** That scratch path lands in the same sticky `/tmp` and inherits the same trap: a run killed between build and copy leaves a temp owned by one UID that the other can then never open for write, and the loser cannot unlink it either. Always PID-qualify (`${FILE}.tmp.$$`). This is a real observed failure — see bug 2 below.
- **Do not `rm` a seeded file to "reset" it.** Truncate it (`: > "$FILE"`) or overwrite it with a valid empty-state document. An unlink either fails silently (cross-UID) or succeeds and voids the seed for the rest of the boot.

### Log rotation is a special case of the same trap

`qlog.sh`'s `_qlog_rotate()` does `mv $QLOG_FILE $QLOG_FILE.1` then `: > $QLOG_FILE`. When **root** rotates, the `mv` carries the seeded inode away and `: >` creates a brand-new one at umask `0022` — www-data's appends are denied from then on, silently. The fix is an explicit `chmod 666` after the recreate. (When www-data rotates, the `mv` fails first on the sticky bit and `: >` truncates through the surviving inode, so the seed is preserved and the `chmod` is a harmless no-op.)

## The recovery flag (the deliberate exception)

`/tmp/qmanager_recovery_active` is **not** seeded, and must not be added to the `qmanager_setup` list. Two independent reasons:

1. It is a **flag, not a data file.** Its mere *existence* means "a recovery is in progress, suppress alerts and internet events". `qmanager_ping` reads it as `during_recovery`, which pins `conn_status` to `"recovery"` and freezes the whole alert engine. Pre-creating it at boot would suppress the device for its entire uptime.
2. Seeding it `0666` would be **worse than not seeding it at all.** The claim logic treats a flag it can successfully write as one it owns — but www-data still cannot *unlink* a root-owned file in sticky `/tmp`, so the flag would be raised, "owned", and unclearable. Today that path is unreachable only because the sole creator writes it with `printf >` at umask `0022`, landing `0644`, which correctly falls into the "cannot claim, proceed unsuppressed" branch. A `0666` seed would make the stuck path the default one.

The flag is genuinely multi-UID. `qmanager_profile_apply` — which raises it around an APN attach cycle — runs as **root** when `qmanager_poller` (boot auto-apply) or `qmanager_watchcat` spawn it, and as **www-data** when the UI does: `profiles/apply.sh` invokes it with no `sudo`, and the binary is neither setuid nor covered by a sudoers rule. An older comment in that file asserted a single-UID ownership invariant; it was never enforced and was not true.

### Claim by verification, never by assumption

Because both write and unlink can fail silently in either direction, ownership is *proved*, not assumed. `_apn_rf_claim()` in `qmanager_profile_apply`:

1. `rm -f` the flag first. Every caller has already decided the flag is theirs to take (absent, dead PID, or aged out), so this destroys no live state. The unlink is load-bearing in the **root-reclaims-a-www-data-flag** direction: a bare `printf >` onto a www-data-owned file is refused by `protected_regular` with no root override, whereas after the unlink the write is an `O_CREAT` on a name that no longer exists, which the check never refuses. In the mirror direction the unlink simply no-ops (sticky bit) and the claim fails closed.
2. `printf '%s\n' "$$" >` the flag.
3. **Read it back.** `_apn_rf_owned=1` is set only when the file contains our own PID.
4. On failure: log which PID actually occupies the flag and **proceed without suppression**. An APN apply that cannot suppress alerts is still a correct APN apply — degrade loudly rather than block.

`cleanup()` and `apn_apply_on_bracket_end()` clear the flag only when `_apn_rf_owned=1`, and then **check the file is actually gone**, warning if it is not. A stranded flag mutes every alert until reboot; it must be findable in the log.

`qmanager_watchcat` raises the same flag at all six of its recovery sites with `printf '%s\n' "$$" > "$FLAG" 2>/dev/null || touch "$FLAG"`. The `touch` fallback is not padding: watchcat is root, so if a www-data apply already created the flag the redirect is refused — but `touch` on that same file still succeeds, because stamping mtime only needs `CAP_FOWNER`. Existence is the signal every consumer reads, so without the fallback root would fail to raise suppression at all.

### Ownership decision table

| Flag state at bracket start | Interpretation | Action |
| --------------------------- | -------------- | ------ |
| Absent | Nobody holds it | Claim (create + verify) |
| Present, **empty** | Foreign owner — an *older* watchcat raised it with a bare `touch` and wrote no PID, and during an OTA an old watchcat can be running against the new binary | Leave alone. Never aged out — an empty flag carries no owner to judge |
| Present, **dead PID** (`! -d /proc/$pid`) | Genuinely stale (e.g. a SIGKILLed prior run) | Reclaim |
| Present, **live PID**, age ≤ ceiling | A real holder mid-bracket | Leave alone |
| Present, **live PID**, age > ceiling | The "live" PID is almost certainly a wrapped, unrelated process | Reclaim |

### The staleness ceiling is 120s, and why

`APN_RECOVERY_FLAG_MAX_AGE=120`. `pid_max` is 32768 and PID churn was **measured** on this device at **~100 PIDs/s** (sampled from `/proc/loadavg`'s last field over 90s), so the PID space wraps in **~325 s**. A `/proc/$pid` lookup on a flag older than that can match a completely unrelated process, and nobody would ever reclaim it.

An earlier draft used `300`, on the strength of a *guessed* 60–90 PIDs/s. At the measured rate that is 92% of a full wrap — no margin — and PID *collisions* start well before a full lap, since the allocator skips live PIDs (birthday problem). 120 s is ~37% of a wrap and still an order of magnitude above any legitimate bracket, which is seconds of `AT` round-trips and sleeps. **Re-measure before raising it.**

> ℹ️ NOTE: `STALE_APPLY_AGE=300` in `profiles/apply_status.sh` is a *different* ceiling on a *different* signal — the mtime of `/tmp/qmanager_profile_state.json`, which the worker rewrites on every step transition. Don't unify them.

### An implausible age is *no evidence*, not strong evidence

This device has no battery RTC: every boot starts at **Jan 1970** and `ql_time_daemon` steps the wall clock ~24 s in (see [scheduled-timers.md](scheduled-timers.md) § "The 1970 boot window"). Both directions of `now - mtime` are corruptible across that step:

- mtime **after** the step, `now` read **before** it → a negative age. Harmless: a negative number is never `-gt` the ceiling, so it reads "not stale".
- mtime **before** the step (the poller's boot-time auto-apply at ~10 s uptime is a realistic source), `now` read **after** it → the age computes to **~56 years**. Naively that is `-gt 120`, so we would reclaim a flag whose owner is alive and mid-bracket — then unlink their flag, and their `cleanup()` would later delete ours, collapsing suppression for both.

A non-numeric guard cannot catch the second case: the arithmetic is perfectly valid, it just describes a bogus span. So `_apn_rf_stale_by_age()` treats any age above `APN_RECOVERY_FLAG_MAX_PLAUSIBLE_AGE=86400` as **no evidence** and falls back to the PID check — the conservative direction. A flag whose mtime predates the clock step simply cannot be aged out during that boot, which is correct: `/tmp` is tmpfs, so the flag cannot outlive the boot anyway.

Keeping the flag in `/tmp` is itself load-bearing. **Do not relocate it to a persistent path** — tmpfs is what bounds a stuck flag to a single uptime.

## Evidence: three bugs this protocol fixes

These were all confirmed on live hardware, not reasoned about.

### 1. `/tmp/qmanager_events.json` — every UI event silently dropped

The file was seeded **nowhere**, so root's poller won the boot race and created it `root:root 0644`. Plain mode, not the sysctl. Every event originating from a CGI script — `cellular/apn.sh`, `profiles/deactivate.sh`, `profile_mgr.sh`'s lazy loader — was dropped, while `append_event` logged `EVENT [...]` success unconditionally because the append was fire-and-forget.

*Confirmed live:* the file was `root:root 0644`, `sudo -u www-data test -w` failed, and it was actively growing with poller-only events.

*Fix:* seeded `root:root 0666` in `qmanager_setup`; `append_event`'s write is now checked and logs `EVENT DROPPED` on failure; the ring trim switched from `mv` to `cat tmp > file` with a PID-qualified scratch name. See [recent-activities.md](recent-activities.md).

### 2. `/tmp/qmanager_profile_state.json` — the stale apply dialog

Seeded, but as `www-data:www-data 0666`, and `write_state()` published with `mv`. The boot-time **root** apply's rename swapped in a root-owned inode at umask `0022`. From then on every www-data UI "Activate" silently failed to record progress, and the dialog showed the **stale boot-run result**.

*Confirmed live, with a smoking gun:* an orphaned `qmanager_profile_state.json.tmp` owned by `www-data`, the same byte size as the live file, stranded from a failed 11:03 apply — while the live file's mtime was frozen at boot+41 s. That orphan is also the evidence for the fixed-scratch-name hazard above.

*Fix:* seeded `root:root 0666`; `write_state()` builds into `${STATE_FILE}.tmp.$$`, refuses to publish a zero-byte render, then `cat`s it through the existing inode and warns loudly on denial. `profiles/apply.sh` no longer `rm`s the file to reset it — it writes a schema-valid `"applying"` envelope in place.

### 3. `/tmp/qmanager_profile_apply.pid` — two applies running concurrently

Seeded correctly, but `cleanup()` did `rm -f` on it at the end of every run. One root-run unlink voided the seed for the rest of the boot; the next UID to run recreated it at its own umask, and a root-created `0644` file locks www-data out of its own lock file. `echo $$ >` then failed silently, the lock was never recorded, and two applies could run at once.

*Confirmed live:* the file was simply **absent**, and the UI path had been running unlocked.

*Fix:* `cleanup()` truncates with `: >` instead. That is exactly equivalent for a lock that decides on **content** (`profile_check_lock` tests `[ -n "$pid" ] && [ -d /proc/$pid ]`) — an empty file yields an empty PID, which reads as unlocked — while keeping the shared inode alive.

**There was a second unlink**, missed in that pass and caught only by post-deploy verification: `profile_check_lock()` in `profile_mgr.sh` also did `rm -f` on the file, on its stale-PID branch. Fixing `cleanup()` alone was not enough — and this site was strictly worse, because it is not conditional on a stale run. The seeded file is **empty**, so the first acquire after *every* boot reads an empty PID, takes the stale branch, and unlinks the seed unconditionally. Verified on hardware after the v0.1.14 install: the file was `root:root 0644` and `sudo -u www-data` could not open it for write.

The general lesson: when a seeded file is found violating the never-`rm` rule, **grep for every writer of that path before declaring it fixed**. A release-by-unlink and an acquire-by-`>` are usually written in different functions, and the acquire looks innocent on its own.

## Checklist for a new shared `/tmp` file

1. Does **both** root and www-data write it?
   - **No, www-data only** → `www-data:www-data 0666`, or don't seed it at all.
   - **No, root only, but www-data reads it** → root-owned is fine; `0644` suffices for a reader.
   - **Yes** → seed it `root:root 0666` in `qmanager_setup`. There is no other option.
2. Is it a **flag** whose existence is the signal? Then do **not** seed it. Design a claim-and-verify protocol instead, and re-read the [recovery flag](#the-recovery-flag-the-deliberate-exception) section.
3. Grep every writer for `mv` and for a fixed `.tmp` name. Replace with in-place writes and `$$`-qualified scratch paths.
4. Grep every writer for `rm -f` on the file itself. Replace with `: >`.
5. Make every write **checked**. `2>/dev/null` on a redirect plus an unconditional success log is how all three bugs above stayed invisible.
6. Make every cross-UID `rm` **verified** — test `[ -f "$FILE" ]` afterwards and log if it is still there. `rm -f` exits 0 either way.
7. If it is polled by the frontend, make the reader validate with `jq -e .` and degrade to a valid envelope; you no longer have rename-atomicity.
8. Add a row to the `/tmp` file table in [../BACKEND.md](../BACKEND.md) with its correct owner.

## Related

- [../rm520n-gl-architecture.md](../rm520n-gl-architecture.md) § `fs.protected_regular=1` — the platform-level description and the `flock` read-only-FD workaround.
- [../BACKEND.md](../BACKEND.md) § Critical Constraints and the `/tmp` file inventory.
- [at-command-transport.md](at-command-transport.md) — why `/tmp/qmanager_at.lock` is www-data-owned and opened `9<`.
- [sim-profiles.md](sim-profiles.md) — the 4-step profile apply that owns the state file and the PID lock.
- [wan-profile-management.md](wan-profile-management.md) — `apn_apply.sh`, the UID-agnostic attach-cycle primitive and its bracket hooks.
- [connection-watchdog.md](connection-watchdog.md) — the other producer of the recovery flag.
- [recent-activities.md](recent-activities.md) — `events.sh` and the events ring.
- [qmanager-independence.md](qmanager-independence.md) — the parallel `/etc/qmanager` ownership rule (different directory, different mechanism, same class of mistake).
