# QManager Independence (RM520N-GL)

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** mostly unverified — see [`platform-matrix.md`](./platform-matrix.md). Verified 2026-10-29 on `b7e3d6f1`: the OTA install path (`--force --skip-packages --no-reboot`) with the broker unit, 55 read-only CGIs through lighttpd as `www-data`, and a full health-check run

> QManager installs standalone with no SimpleAdmin/RGMII-toolkit dependency — it owns its directory, bootstraps Entware, configures lighttpd, and manages all services itself.

---

## Directory layout & bootstrapping

- **Own directory**: `/usrdata/qmanager/` — contains web root, lighttpd config, and TLS certs.
- **Bootstraps Entware** from `bin.entware.net` if not *complete* (see the completeness guard under HTTP transport below). The bootstrap process creates the `opt.mount`, `start-opt-mount.service`, and `rc.unslung.service` systemd units, and pre-creates `/opt/sbin` — normally the `entware-opt` package's job, but `dropbear.service` hardcodes `ExecStart=/opt/sbin/dropbear` and the directory was measured absent on the RG501Q-EU.
- **Installs lighttpd + modules** from Entware: `lighttpd-mod-cgi`, `lighttpd-mod-openssl`, `lighttpd-mod-redirect`, `lighttpd-mod-proxy`. This happens **even where the vendor firmware ships its own `/usr/sbin/lighttpd`** (RG501Q-EU): QManager's config, TLS cert and module set are built against the Entware server, and lighttpd rejects modules whose version does not match it.
- **lighttpd module version sync**: The installer runs `opkg upgrade` on lighttpd and all its modules together when they are already installed — this prevents `plugin-version doesn't match` errors that occur if modules are at different versions during upgrades.
- **lighttpd keep-alive**: `/usrdata/qmanager/lighttpd.conf` sets `server.max-keep-alive-idle = 30`. lighttpd's default of 5 s is no longer than the UI's 5 s poll, so most polls opened a new connection and redid the TLS handshake. Every OTA overwrites the conf, so the value needs no migration. The three port lines are re-rendered from `/usrdata/qmanager/web_port` by the installer and by `lighttpd.service`'s `ExecStartPre`, so a custom web port survives OTA — [web-port.md](web-port.md#lifecycle). The uninstaller removes the port file and its temp files.
- **Install banner uses the real LAN address**: `print_summary()` takes the gateway from `qm_lan_read` (`scripts/usr/lib/qmanager/lan_subnet.sh`) for the browser, console and SSH lines, and falls back to `192.168.225.1` when it is unreadable or not a dotted IPv4. On an RG501Q-EU (`Project Name:` starts with `RG501Q`) the banner and the model check (also under `--force`) print one info line, `RG501Q-EU — community-supported model`, with no prompt.
- **Creates `www-data:dialout`** user and group if missing. The `dialout` group membership grants `www-data` access to `/dev/smd11`.
- **Bundled first-party binaries** are copied from `dependencies/` by `install_bundled_binaries()`, which runs even with `--skip-packages` (so on every OTA): `qmanager_atd` (the Rust AT/SMS/QMI broker, plus the relative link `/usr/bin/qsms -> qmanager_atd`) and the optional `qmanager_discord`. A missing `qmanager_atd` is fatal (`die`); `build.sh` refuses to package without it. The broker binary and `qsms` land on every model; `qmanager-atd.service` ships, boot-links and starts where `qm_hw_atd_enabled` is true (RM520N-GL and RG501Q-EU) — see [Service persistence](#service-persistence-systemd-symlinks) and [platform-matrix.md](./platform-matrix.md#at-transport). On every model `install_backend()` also makes `/usr/bin/qcmd` a link to `qmanager_atd` (`ln -sf` to a temp name, then `mv -f`, so it is never missing). Contract: [at-command-transport.md](./at-command-transport.md#qcmd-serialization).
- **Retired binaries are removed after their replacement answers.** `sms_tool` and `atcli_smd11` no longer ship; `retire_legacy_at_binaries()` runs last under `DO_START` (OTA included) and deletes each from `/usr/bin/` only once `qsms status` / `qcmd AT` answers. See [at-command-transport.md > Retired binaries](./at-command-transport.md#retired-binaries-atcli_smd11-and-sms_tool).
- **Installer stops socat-smd11** services if they are running — `qcmd` needs exclusive access to `/dev/smd11` and cannot co-exist with a socat bridge holding it open.
- **Windows line ending safety**: The installer strips `\r` from all deployed shell scripts, systemd units, and sudoers rules using `sed -i 's/\r$//'`. This prevents BusyBox and sudoers parse failures that occur when tarballs are built on Windows.

### ⚠️ Directory creation rule: `install -d`, never `mkdir -p`

**Any directory that root reads code, libraries, configuration, or keys from
must be created with `install -d -o root -g root -m 0755`, not `mkdir -p`.**

Why `mkdir -p` is the wrong tool here — two reasons that compound:

1. It **honours the ambient umask**. A permissive umask at install time bakes a
   permissive mode into the directory.
2. It is a **silent no-op on an existing directory**. It never re-applies the
   mode, so once a directory is wrong in the field it stays wrong through every
   subsequent install and OTA, forever.

`install -d` re-applies owner and mode on **every** run, so a single OTA
self-heals already-drifted devices.

The failure mode this prevents is not subtle. On Unix, **directory write
permission governs create/rename/delete of entries inside it, regardless of
those entries' own modes** — think of a locked filing cabinet in an unlocked
room: the folders' own locks don't matter if anyone can swap the folder out.
So a world-writable directory means `www-data` can delete a root-owned `0644`
file and put its own there. Where root later reads that file as code, that is
root code execution.

Directories covered by this rule today (all were found at `0777` on fielded
devices and fixed in `install_rm520n.sh` / `qmanager_setup`):

| Directory | Why it matters |
|-----------|----------------|
| `/usr/lib/qmanager` | Root helpers (`qmanager_*_apply`, reachable by `www-data` through a NOPASSWD sudo grant) `.` source these libraries **as root**. Created in two places — `install_backend()` and `install_udev_rules()` — plus `qmanager_setup` at every boot; **all three** use `install -d`. |
| `/usrdata/qmanager` (`$QMANAGER_ROOT`) | `qmanager-console.service` has no `User=`, so it runs as root with `ExecStart=$QMANAGER_ROOT/console/ttyd … console.sh`. A writable parent lets `console/` be replaced wholesale and executed as root at next start, with no auth gate. |
| `/usrdata/qmanager/certs` | `server.key`'s own `0600` is moot if the *directory* is writable — the key and cert can be deleted and replaced, enabling a TLS MITM of the admin UI. Deliberately `0755` and not `0750`: lighttpd reads the key as root at startup before dropping to `www-data`, and `www-data` legitimately reads the public cert. File modes are also re-asserted unconditionally each run (`chmod 600 server.key`, `chmod 644 server.crt` — the cert was shipping `0666`). |
| `/usrdata/qmanager/www` (`$WWW_ROOT`) and `$WWW_ROOT/cgi-bin` | lighttpd serves this tree and runs CGI from `cgi-bin/`. The subtree's own modes were correct; a writable **parent** made that moot — the whole `cgi-bin/` could be swapped. |
| `/etc/qmanager` (`$CONF_DIR`) | **Ownership is `www-data`, but the MODE must still be `0755`.** `0777` would extend create/rename/unlink here to *every* local user, not just the owner. Note that `0755` does **not** wall `www-data` out — it owns the directory, and `0755` grants the owner `rwx` — which is why nothing that must be protected *from* `www-data` may live here at all (see below). Created in two places — `mark_version_pending()` (mode only; `www-data` does not exist yet at that point) and `install_backend()` (owner **and** mode, once the user exists); **both** use `install -d`. |

> ℹ️ NOTE: `/etc/qmanager` is an exception to the **ownership** half of this
> rule, not the **mode** half. It is intentionally `chown -R www-data:www-data`
> because the CGI legitimately writes `auth.json`, `profiles/`, and similar —
> a known, accepted boundary, see the "Honest threat model" section in
> [sim-detection.md](sim-detection.md). It is **not** an exception to `0755`:
> `www-data` owning the directory already lets it manage its own files, so
> group/world write buys nothing and only widens the blast radius. It was
> found at `0777` on fielded devices, created by a bare `mkdir -p` that honoured
> the ambient umask and then no-op'd on every subsequent OTA.

`/var/spool/cron/crontabs` is covered by the same rule and for the same reason,
even though **nothing on this device consumes it** — see
[scheduled-timers.md](scheduled-timers.md#varspoolcroncrontabs-is-still-created-and-still-re-tightened).

### ⚠️ Temp-file rule: in-directory `mktemp`, and set mode/owner *before* the rename

**A temp file destined for `/etc` or `/usrdata` must be created with an
in-directory `mktemp` template — never a bare `mktemp`.**

```sh
# WRONG — lands in /tmp
tmp=$(mktemp)

# RIGHT — lands beside the destination
tmp=$(mktemp /etc/qmanager/.ping_profile.json.XXXXXX)
```

`mv` is only an atomic `rename(2)` **within one filesystem**. `/tmp` is tmpfs,
`/etc` and `/usrdata` are UBIFS — different filesystems. A cross-filesystem
`mv` gets `EXDEV` from `rename(2)` and BusyBox `mv` silently falls back to
copy + unlink, so the destination is briefly a half-written file rather than
flipping from old to new in one step. On flash that means a power loss
mid-install can leave a truncated config behind.

**Set mode *and* owner on the temp file before the rename, not on the
destination after it.** BusyBox `mktemp` creates its file `0600 root:root`, and
`mv` carries **both** mode and owner to the destination. The `chmod`-after-`mv`
shape therefore has two defects, not one: a window where the live file is
`0600`, and a silent ownership change on the destination.

```sh
chmod 644 "$tmp"
chown www-data:www-data "$tmp" 2>/dev/null || true   # || true: missing user must not abort
mv "$tmp" "$target"
```

Reference implementations in `install_rm520n.sh`: `migrate_sim_registry()`,
`migrate_ping_targets()`, `migrate_ping_environment()`,
`prune_stale_ping_environment()`, `migrate_environment_location()`.

> ℹ️ NOTE: `stop_services()` runs before `install_backend()`, so the poller and
> every other QManager daemon are already stopped when these migrations run —
> the justification is crash-atomicity on flash and the mode/owner defect, not
> a concurrent-reader race. The one genuine live-writer case is
> `/etc/qmanager/ping_profile.json`: lighttpd is **not** stopped during an OTA,
> so `settings/ping_profile.sh` and `monitoring/watchdog.sh` can still write it.
> Even there, an atomic rename does not close the read-modify-write race — no
> lock is held on either side, and none was added.

### ⚠️ `set -e` rule: functions called bare from `install_backend()` must be fail-soft

`install_rm520n.sh` runs under `set -e`. Any function invoked **bare** (not in an
`if`, `&&`, or `||`) from `install_backend()` aborts the entire installer on a
non-zero return — mid-OTA, *after* `stop_services()` has already torn down every
QManager daemon, with no rollback. A half-finished install is far worse than a
skipped migration.

So every such function warns to stderr and `return 0` on failure:

```sh
tmp=$(mktemp /etc/qmanager/.sim_registry.json.XXXXXX) || {
    echo "  WARNING: failed to create temp file for sim_registry.json seed — skipping" >&2
    return 0
}
```

The same applies to bare commands inside them: `qm_config_set` /
`qm_config_delete` calls in `migrate_watchcat_fail_threshold()` carry `|| true`
(they return 1 on a `jq` failure over a corrupt `qmanager.conf`), and the `cp`
in `install_ping_profile()` and the backup `cp` in `migrate_ping_environment()`
are `if`-guarded.

### ⚠️ Nothing that must be protected FROM `www-data` may live in `/etc/qmanager`

**The parent-directory rule: a file's own owner and mode are irrelevant if
`www-data` can write the directory it sits in.** Unlinking, renaming, or
replacing a directory entry requires write permission on the **parent
directory**, not on the file. `www-data` *owns* `/etc/qmanager`, and `0755`
grants the owner `rwx` — so `www-data` can unlink any file in there and drop in
its own, whatever that file says it is. Verified live: `sudo -u www-data` can
both create and unlink in `/etc/qmanager`.

The daemon `EnvironmentFile` is the file that taught us this, the expensive way.

| File | Location | Owner | Why |
|------|----------|-------|-----|
| `/etc/qmanager.env` | **Outside** `$CONF_DIR` | `root:root` `0644` | It is the systemd `EnvironmentFile=` for four **root-run** daemons (`qmanager-poller`, `qmanager-ping`, `qmanager-watchcat`, `qmanager-discord`) and **no CGI reads or writes it**. `/etc` is `root:root 0755` and unwritable by `www-data` (verified live), so the file is genuinely out of reach. |
| `/etc/qmanager-secrets/` | **Outside** `$CONF_DIR` | `root:root` `0700` | The alert-channel credentials (Discord bot token, Gmail app password, `msmtprc`). No CGI reads them; `www-data` writes them only through the `qmanager_secret_set` root helper. Relocated in v0.1.14 by `migrate_alert_secrets()` — full rationale, helper contracts and support-bundle rules in [alerts.md](alerts.md#secret-storage-etcqmanager-secrets). |
| `/etc/qmanager-backups/` | **Outside** `$CONF_DIR` | `root:root` `0700` | Timestamped `auth.json` snapshots — the QManager login password, one per install/OTA run, newest 5 kept. Only the installer reads or writes it, and a password *history* is precisely what a `www-data` compromise must not be able to read or replace. Relocated in v0.1.14 by [`migrate_backup_location()`](#migration-migrate_backup_location) below. |
| `/usrdata/qmanager/crash.log` | **Outside** `$CONF_DIR` | `root:root` `0644`, dir `root:root 0755` | The reboot-cause log. Every writer is root (watchdog Tier 4, `qmanager_scheduled_reboot`, `qmanager_crash_log_append`); readers only need `0644`. In `/etc/qmanager` it could be swapped for a symlink under a root writer, and the boot `chown -R` handed it back to `www-data`. Relocated 2026-10 by `qm_crash_log_prepare` (`scripts/usr/lib/qmanager/crash_log.sh`), which merges the legacy file once, reading it as `www-data` — full contract in [alerts.md](alerts.md#the-user-breadcrumb-root-helper). |
| `/etc/qmanager/ping_profile.json` | Inside `$CONF_DIR` | `www-data:www-data` | The CGI genuinely writes it (`settings/ping_profile.sh`, `monitoring/watchdog.sh`) — correct place, correct owner. |
| `/etc/qmanager/sim_registry.json` | Inside `$CONF_DIR` | `www-data:www-data` | Same: a real `www-data` writer (the dismiss/undismiss CGI via `sim_registry.sh`). |

#### Why the old `root:root` pin did not work

Until v0.1.14 the file lived at `/etc/qmanager/environment` and was pinned
`root:root 0644` by a carve-out in `install_backend()`, immediately after the
blanket `chown -R www-data:www-data "$CONF_DIR"`. **That framing — "a
root-owned file inside a www-data directory" — was the wrong mental model, and
it is what let the hole survive review.** It failed for two independent
reasons, both confirmed on live hardware:

1. **The parent-directory rule above.** `www-data` owns `$CONF_DIR`, so it
   could unlink the pinned file and substitute its own. The pin only ever
   guarded the file's *contents-in-place*, which was never the attack.
2. **`qmanager_setup` runs `chown -R www-data:www-data /etc/qmanager` on every
   boot**, with no exclusion list. The install-time pin therefore survived
   exactly one boot cycle. Fielded devices were found with the file sitting
   `www-data:www-data` — directly writable, no unlink trick even needed.

The impact is root code execution from the web user. systemd does **not**
shell-source an `EnvironmentFile=`, but it *does* inject every `KEY=VALUE` it
finds there into those four root daemons — including `PATH=` and `LD_PRELOAD=`
— and they shell out constantly.

#### Why it could not be fixed in place

- `/etc/qmanager` **must** stay `www-data`-writable. The CGI genuinely writes
  `auth.json`, `profiles/`, `ping_profile.json`, and the `*_alerts.json` blobs.
- A **root-owned subdirectory** does not help: `www-data` owns the parent, so
  it can rename the subdirectory out of the way and put its own there.
- The **sticky bit** (`+t`) does not help either. Its exemption covers "root,
  the directory's owner, or the file's owner" — and `www-data` **is** the
  directory's owner.
- Adding a **chown exclusion list** to `qmanager_setup` is not a fix. It would
  address reason 2 while leaving reason 1 untouched, and reason 1 alone is
  sufficient for the escalation.

Moving the file out has a second benefit beyond closing the hole: it makes
`qmanager_setup`'s blanket `chown -R` *harmless* for this file. That **removes**
a lockstep hazard rather than adding another carve-out that two scripts have to
keep in sync forever.

#### Migration: `migrate_environment_location()`

`install_rm520n.sh` moves the file on install and on every OTA, preserving
content byte-for-byte so an operator's `QLOG_LEVEL=DEBUG` or `PING_TARGET_*`
overrides carry across. It writes a temp file in `/etc` (the **destination**
directory) and renames — `/etc` and `/etc/qmanager` are the same UBIFS volume
(`/dev/ubi2_0`, the same one as `/usrdata`), confirmed live, so `mv` between
them is a true atomic `rename(2)`. A bare `mktemp` would land in `/tmp`, which
is tmpfs — a different filesystem, where `mv` silently degrades to copy+unlink.
See the temp-file rule above. The original is removed only after both the copy
and the rename succeed, and every failure path warns and `return 0`s per the
`set -e` rule above, so a bad migration cannot abort an in-flight OTA. If
`/etc/qmanager.env` already exists, the stale original is simply unlinked so no
later reader — or a downgraded unit file — can pick up the abandoned copy.

> ⚠️ WARNING: **Ordering is load-bearing.** `migrate_environment_location()`
> must run **after** `migrate_ping_environment()` and
> `prune_stale_ping_environment()`. Both of those are deliberately left
> hardcoded to the **old** path and open with
> `[ -f "$env_file" ] || return 0`. If the relocation ran first, a device still
> carrying the pre-v0.1.9 cycle-count format (`FAIL_THRESHOLD=3` rather than
> `FAIL_SECS=15`) would have the unconverted file moved out from under them;
> both would find nothing, `return 0`, and that device would never get its
> conversion — not on that OTA and not on any future one. After the first
> successful relocation the old path stays empty forever and both become
> permanent no-ops. That is expected, not a bug — do not "tidy up" by
> retargeting them.

#### Migration: `migrate_backup_location()`

The auth-backup store is the **third and last** thing to leave `/etc/qmanager`,
and reading it as a member of that family is more useful than reading it on its
own. All three left for the identical reason — the parent-directory rule plus
`qmanager_setup:177`'s unconditional boot-time `chown -R www-data:www-data
/etc/qmanager` — and all three left the same way, by relocating rather than by
pinning:

| Moved | From | To | Function |
| ----- | ---- | -- | -------- |
| systemd `EnvironmentFile` | `/etc/qmanager/environment` | `/etc/qmanager.env` (`0644 root:root`) | `migrate_environment_location()` |
| Alert-channel credentials | `/etc/qmanager/{discord_bot,email_alerts}.json`, `/etc/qmanager/msmtprc` | `/etc/qmanager-secrets/` (`0700 root:root`) | `migrate_alert_secrets()` |
| Auth-backup store | `/etc/qmanager/backups` | `/etc/qmanager-backups` (`0700 root:root`) | `migrate_backup_location()` |

F15 had already raised the old directory from a bare `mkdir -p` (measured `0777`
on both shipped devices) to `install -d -o root -g root -m 0700`. That removed
every *other* local uid, but it could not make the directory root-only while it
sat inside the swept tree. **The relocation is what makes F15's mode pin mean
what it says.** A chown exclusion list is explicitly not the alternative —
`qmanager_setup:144-156` forbids that pattern in its own comment, because an
exclusion addresses the boot-time sweep and leaves the parent-directory rule
untouched, and the parent-directory rule alone is sufficient for the
escalation.

> ⚠️ WARNING: **Ordering is load-bearing, in two independent ways.**
> `migrate_backup_location()` is called bare from `main()`, immediately after
> `stop_services` — not from `install_backend()`'s migration block where the two
> sibling relocations live and where this one would naturally be filed. Both
> constraints are real:
>
> 1. It must run **before** `backup_originals()`. That function creates the
>    store, copies in the fresh snapshot **and** prunes to the newest 5, all in
>    one call. Migrating afterwards delivers the legacy snapshots after the
>    prune has already happened, leaving up to 10 files with no further prune
>    pass until the *next* OTA. Running first lets the existing prune operate
>    over the merged set once, correctly.
> 2. It must sit **outside** the `if [ "$DO_FRONTEND" = "1" ]` block, because
>    `backup_originals()` is gated on that flag. A `--backend-only` run would
>    otherwise never migrate — leaving the password snapshots in the swept
>    directory on exactly the devices an operator was repairing. The function
>    therefore creates the destination itself (`install -d -o root -g root -m
>    0700`) rather than depending on `backup_originals` having done so.

> ℹ️ NOTE: **Accepted consequence of that same asymmetry.** On a
> `--backend-only` run the migration executes but `backup_originals` — and so
> the prune-to-5 — does not, so a device whose legacy store held more than 5
> snapshots can sit above the retention cap until the next ordinary run. Those
> files were already unpruned in the old location; they are merely unpruned in a
> safer one now. Deliberately not worth gating the security fix on.

**It is not a copy of the two functions above it, because it moves a DIRECTORY
OF N FILES rather than one file.** Two codings that are correct for a single
file are actively wrong here:

- **No directory-level `mv "$src" "$dst"`.** BusyBox `mv dir dir` does not fail
  when the destination exists — it **nests** the source inside it. The
  destination is created by `backup_originals()` on every run, so a bare `mv`
  would bury every snapshot at `$BACKUP_DIR/backups/`, one level below the prune
  loop's `ls -1 "$BACKUP_DIR"/auth.json.*` glob, orphaned on flash forever.
  Hence a per-file copy loop.
- **The "already migrated" gate keys on the OLD path (`[ -d
  "/etc/qmanager/backups" ] || return 0`), never on the destination.** The
  destination's existence carries no information about whether this migration
  has run; the old path's presence is the only signal that means "there is still
  work to do". Substituting a destination-existence check is the specific defect
  the regression harness pins, which is why the literal path is spelled out
  again at the gate rather than reusing `$src`.

Within the loop it is copy → verify → unlink, one file at a time, with `cp -p`
so mtimes survive; a partial failure leaves the remaining snapshots where they
were rather than losing them. A same-name collision keeps the destination copy
and discards the source — once this fix ships nothing writes to the old path
again, so the only reachable collision is an earlier run whose trailing `rm -f`
did not take effect, where the two files are byte-identical. `${f##*/}` rather
than `$(basename "$f")`: a command substitution is the one construct in that
loop whose non-zero exit is unguarded, so under `set -e` a `basename` failure
would abort the installer mid-loop instead of warning and returning 0 like every
other path there.

Verified by a real migration run on the live RM520N-GL (serial `61368cd2`): five
genuine snapshots at `/etc/qmanager/backups` (`700 www-data:www-data`) arrived at
`/etc/qmanager-backups` (`700 root:root`) with identical md5 per file and mtimes
preserved, the old directory was removed, and `/etc/qmanager` itself was
untouched (still `755 www-data:www-data`). A second run was a clean idempotent
no-op.

**Uninstall.** `uninstall_rm520n.sh` removes `/etc/qmanager-backups` with its own
explicit `rm -rf` inside the `--purge` branch, beside the two sibling paths —
each needs its own line, because all three are outside `$CONF_DIR` and the
`rm -rf "$CONF_DIR"` cannot reach them. Without it a purge leaves a history of
the user's login password on a device they believe is clean. The non-purge run
names the new path in its "config preserved" warning and says plainly that it
still holds up to 5 password snapshots.

`migrate_sim_registry()` is the other writer under `$CONF_DIR` and `chown www-data:www-data`s
its temp — `sim_registry.json` **does** have a `www-data` writer (the
dismiss/undismiss CGI via `sim_registry.sh`). Because the blanket `chown -R` runs
*earlier* in `install_backend()` than the migration functions, a temp left at
`mktemp`'s default `root:root` would silently **downgrade** a live www-data-owned
file. Always set the owner explicitly on the temp; never rely on the blanket chown.

### ⚠️ Any root helper writing into `/etc/qmanager` with a plain `>` is redirectable

**Short version: because `www-data` owns `/etc/qmanager`, it can plant a symlink
at the exact path a root helper is about to write, and a plain `>` redirect will
follow it — so root's write lands wherever the link points.** This is the same
directory-ownership fact as [Nothing that must be protected FROM
`www-data`](#-nothing-that-must-be-protected-from-www-data-may-live-in-etcqmanager)
above, with a sharper consequence: that section is about *files you cannot
protect*; this one is about *writes whose destination you cannot trust*.

Reproduced live on **both** devices (commit `e079004`): `www-data` planted a
symlink at `/etc/qmanager/platform.json.tmp`, root ran the generator's exact
redirect, and root's JSON appeared in the linked file rather than in the temp
file. A link can point at anything root can write — `/etc/shadow`, a file under
`/etc/sudoers.d`, a systemd unit.

Three specifics that get this wrong in review:

- **`fs.protected_symlinks=1` does not help here.** That sysctl is `1` on both
  devices (measured 2026-08-26), and it is irrelevant to this directory: it only
  engages for world-writable **sticky** directories such as `/tmp`.
  `/etc/qmanager` is `0755` and **not sticky**, so the protection never applies.
  "The sysctl is on" reads as protection and is not — the attack succeeded with
  it enabled.
- **`[ -f "$path" ]` is not a guard.** It *follows* the symlink and reports true
  for one. Only **`[ -L "$path" ]`** inspects the link itself.
- **`[ -L ]` followed by an open is still racy.** A link planted in the gap
  between the check and the open wins. Use `( set -C; … > "$tmp" )` — the shell's
  `noclobber` option, which gives the redirect `O_CREAT|O_EXCL` semantics, so the
  kernel refuses atomically if *anything* — regular file, live symlink, or
  dangling symlink — occupies the path. Verified identical on BusyBox **1.31.1**
  (RM520N-GL) and **1.29.3** (RG501Q-EU).

Two more shapes worth guarding, both measured:

- **`mv` onto a symlinked destination replaces the link** rather than following
  it, so the final rename was already safe. Guard `$dest` with `[ -L ]` anyway as
  defence in depth.
- **`mv "$tmp" "$dest"` where `$dest` is a *directory* does not fail** — it moves
  the temp file *inside* it and exits `0`. A helper without a `[ -d "$dest" ]`
  refusal reports success having written nothing at the expected path.

Also `chmod` the temp file explicitly before the `mv`. Without it the mode comes
from whatever umask happened to be ambient: the live RG501Q-EU's `platform.json`
was found world-writable (`0666`) because the install shell that wrote it ran at
umask `0`.

> ⚠️ WARNING: **only some root writers into `/etc/qmanager` have been audited and fixed.** The
> reference implementation is `qm_hw_write_profile` in
> `scripts/usr/lib/qmanager/hw_profile.sh` (see
> [platform-profile.md](platform-profile.md#the-write-path-and-its-symlink-defence)).
> Fixed since (2026-10): `qmanager_ethernet_apply` writes `ethernet_speed` through
> an in-directory `mktemp` (random name, `O_EXCL`) then `mv -f`; `sim_registry.sh`
> creates its lock file the same way, replacing a planted symlink instead of
> creating its target as root; and `crash.log` left the directory entirely (see
> the table above). Every *other* root writer into `/etc/qmanager` — installer
> helpers, other root helpers invoked via `sudo -n`, anything `qmanager_setup`
> does in that directory — is still **unaudited** against this. If you are
> writing a new one, copy the refuse-then-`set -C` or `mktemp`-then-`mv` shape; if
> you are touching an existing one, check it.

### ⚠️ Migration rule: repair drifted state, don't just gate on existence

A migration guarded only by `[ -f "$target" ] && return 0` cannot fix anything it
previously got wrong — the first (broken) run creates the file, and every later
run sees it and returns. That converts a one-release bug into a permanent one,
exactly like "fixing" a bad `chmod` by deleting the line (see the `install -d`
rule above): **a fix that never revisits the drifted state is not a fix.**

This is not hypothetical. `migrate_sim_registry()` shipped with a jq `gsub()` call
that aborts on this platform (Entware's jq has no regex — see
`docs/rm520n-gl-architecture.md`), so the seed failed on every device and
`sim_registry.json` got created lazily by `sim_registry_refresh_active()`'s
auto-vivify holding only the **active** SIM. The existence gate then locked that
in permanently.

It now does a **content check** — count the `known_iccids` entries that have no
record — and is strictly **additive**:

- Merge with jq's `+` (shallow, right-hand-wins: `seed + existing`), so an
  existing record replaces the seeded stub **wholesale**. Never `*`, which
  deep-merges and would reach *inside* live records, resurrecting fields the
  poller or CGI deliberately left absent and clobbering a user's dismissal.
- If nothing is missing, **write nothing**. Beyond avoiding pointless flash
  churn, this bounds the one real race here: `stop_services()` stops the poller
  before `install_backend()`, but **lighttpd is never stopped during an OTA**, so
  a CGI dismissal write can overlap. The in-directory `mktemp` + rename keeps
  that atomic — a concurrent write can be *lost*, but the file cannot be torn.
- A target that exists but does not parse is left **untouched** with a warning;
  destroying a user's dismissal state is worse than skipping the backfill.

**Never `2>/dev/null` a jq/command whose failure you then report.** The original
did, so a live install printed only `WARNING: failed to seed sim_registry.json`
with the actual ONIGURUMA error discarded. Capture stderr into the warning text.

### ⚠️ OTA-reach rule: a fix inside `install_dependencies()` reaches zero deployed devices

Every OTA invokes the installer with `--skip-packages`, which sets `DO_PACKAGES=0`
and skips `install_dependencies()` in its entirety. So a repair written there — and
especially one written as `if [ ! -f "$unit" ]; then …` inside it, which additionally
refuses to touch anything that already exists — runs only on a **fresh** install. It
looks correct in review, passes on a clean device, and never reaches a single machine
in the field.

The pattern that does reach the field is an **unconditional `ensure_*` function called
from `main()`**, which rewrites the drifted state whether or not the file already
exists and then confirms the result with a `systemctl show`-based read-back rather
than trusting the write. `ensure_dropbear_unit_ordering()` is the precedent;
`ensure_rc_unslung_unit_ordering()` was added on the same shape. Both run before
`stop_services()` so the repair lands even on a run that never reaches
`install_dependencies()`. Worked example and the defect that forced it:
[scheduled-timers.md](scheduled-timers.md).

### Installer permission hardening: `umask`, early `visudo`, world-writable files

Three installer steps exist to keep `www-data` from reaching root through files
root later reads. All three run on a fresh install **and** on every OTA.

| Step | Where | What it does |
|------|-------|--------------|
| `umask 022` | Top of `main()`, before `log_init` | The install shell inherits umask `0000` on both measured devices, so every `opkg` file and heredoc it wrote landed `0666`. Setting `022` stops new files from being created world-writable. |
| Early `visudo -c -f` | `preflight()`, when `DO_BACKEND=1` | Checks the shipped `scripts/etc/sudoers.d/qmanager` before anything is stopped or installed and `die`s on a parse error. New helpers paired with a drop-in that failed to install (so the old, broader grants stay live) is worse than aborting. Skipped without a message when no `visudo` is found; the late staged check in `install_backend()` still runs ([BACKEND.md §7](../BACKEND.md#7-sudoers-rules)). |
| `harden_world_writable_modes()` | `main()`, right after `harden_entware_unit_modes`, i.e. after `install_dependencies` so a later `opkg` run cannot undo it | `chmod 0644` on `/opt/etc/opkg.conf`, `/opt/lib/opkg/status`, `/lib/systemd/system/dbus.service.d/dbus.conf`, `/bin/timezone21.bin`, `/bin/iana_tzdb` (each only if present — the RG501Q-EU lacks some); `find /opt/lib/opkg/info -type f -perm -0002 -exec chmod 0644` for the per-package lists; `chmod 0755 /opt/tmp`. Never `die`s, never returns non-zero. |

These files were root-owned but world-writable, so `www-data` could rewrite
`opkg` state, a `dbus` config drop-in, or the timezone tables root reads. The
Entware bootstrap's own `chmod 777 /opt/tmp` is now `chmod 0755` as well; only
root uses `/opt/tmp`.

> ℹ️ NOTE: `/var/spool/cron/crontabs` used to be `0777`; that was fixed before
> this change, and `qmanager_setup` re-asserts `0755` on it at every boot.

---

## Device permissions (/dev/smd11 & udev)

`/dev/smd11` defaults to `crw------- root:root` — completely inaccessible to `www-data`. QManager uses two complementary paths to fix this, both of which are idempotent:

### Primary: udev rule

- Rule file: `/etc/udev/rules.d/99-qmanager-smd11.rules`
- Fires on every kernel `add` event for the `smd11` device.
- Executes `/usr/lib/qmanager/qmanager_smd11_udev.sh`, which runs `chmod 660` and `chown root:dialout` on `/dev/smd11`.
- The rule intentionally **omits `SUBSYSTEM==`** — the subsystem on RM520N-GL is `glinkpkt` (sysfs at `/sys/class/glinkpkt/smd11`), but omitting the subsystem filter makes the rule work across both this platform and others (e.g. RG502Q/RM502Q). `KERNEL=="smd11"` is already specific enough.
- Source path for the udev helper script is `scripts/etc/udev/scripts/qmanager_smd11_udev.sh` — deliberately placed **outside** `usr/lib/qmanager/` to prevent `install_backend`'s glob copy from resetting its file mode to 644.

### Fallback: boot-time setup

- `qmanager_setup` runs the same `chown`/`chmod` at boot, in case udev has not loaded the rule yet (e.g. on fresh install before a udev reload).
- This covers PRAIRE-derived platforms (RG502Q/RM502Q) where the modem re-creates `/dev/smd11` **after** `qmanager-setup.service` completes, leaving the one-shot's `[ -e ]` guard false when udev fires later.

---

## CGI environment & auth

- **CGI PATH problem**: lighttpd starts CGI scripts with a stripped-down `PATH` that excludes `/opt/bin` — so Entware tools like `jq` are invisible to CGI scripts by default.
  - Fix 1: `cgi_base.sh` exports the full PATH including `/opt/bin`.
  - Fix 2: The installer symlinks `jq` to `/usr/bin/` so it is always found regardless of PATH.
- **Cookie-based session auth** is used at the CGI layer. There is no HTTP Basic Auth and no `.htpasswd` file.
- **The auth path is on every request, so keep it fork-free.** `cgi_base.sh` + `require_auth` run before every CGI's own work; an authenticated request forks twice (`date +%s` and one more), down from 19 (T6.2, measured on RM520N-GL — see [`poller-cpu-profile.md`](poller-cpu-profile.md#dashboard-cgi-cost-t62-2026-102728)).
  - Read a cookie with **`qm_cookie_var NAME VAR`** (`cgi_auth.sh`): it sets `VAR` with no subshell and returns `0` if the cookie is present (value may be empty), `1` if not. Split rules match the old awk: `;` plus any run of spaces/tabs, exact name match, value up to the next `=`, first match wins. `qm_get_cookie NAME` still exists for `logout.sh` / `password.sh`, but `$(qm_get_cookie …)` costs a fork — prefer `qm_cookie_var` in new code.
  - The `/opt/bin/timeout` probe in `platform.sh` is **deferred under lighttpd** (`GATEWAY_INTERFACE` set) to the first `qm_timeout` call, and stays **eager for daemons**, which call `qm_timeout` inside `$(…)` where a lazy probe would be lost with the subshell. See [The `timeout` contract](#the-timeout-contract).
- **AT transport in CGI**: `qcmd` reaches `/dev/smd11` directly (through the `qmanager_atd` broker on the RM520N-GL and the RG501Q-EU, in-process when the broker is unreachable or on an unknown model) — no socat-at-bridge is needed.

---

## Privilege boundary: sudoers grants for `www-data`

lighttpd runs every CGI as `www-data`. Anything that needs root goes through `sudo -n` and the drop-in `scripts/etc/sudoers.d/qmanager`, installed to `/opt/etc/sudoers.d/qmanager` (0440) when Entware sudo is present. **The rule since 2026-10: `www-data` is granted a bare helper path, and the helper validates its own arguments.** Raw system commands with wildcard arguments are gone.

| Grant | Replaces | Contract |
|-------|----------|----------|
| `Defaults:www-data secure_path="/opt/bin:/opt/sbin:/usr/bin:/usr/sbin:/bin:/sbin"` | nothing (new) | This sudo (1.8.31) has no built-in `secure_path`, so the caller's `PATH` reached every root helper. Opt-first order matches `cgi_base.sh`. |
| `/usr/bin/qmanager_svc` | `systemctl start/stop/restart/is-active/reset-failed qmanager-*`, `ln -sf …/qmanager*.service …`, `rm -f …/qmanager*.service` | See [`qmanager_svc`](#qmanager_svc) below |
| `/bin/systemctl {start,stop,restart,is-active} tailscaled` | same, unchanged | Exact lines; `tailscaled` is the one third-party unit `www-data` controls |
| `/usr/bin/qmanager_fw_apply` | `/usr/sbin/iptables`, `ip6tables`, `iptables-restore`, `ip6tables-restore` with any arguments | Exact allow-list of the TTL/HL and Traffic Engine rule shapes — [dpi.md](dpi.md#architecture), [ttl-mtu.md](ttl-mtu.md#the-rules-the-backend-actually-installs) |
| `/usr/bin/qmanager_dns_apply` | `mv` of the staging file over `/etc/data/dnsmasq.conf`, `chown radio:radio`, `killall -HUP dnsmasq` | Re-validates only the sentinel block — [custom-dns.md](custom-dns.md#apply-pipeline) |
| `/usrdata/tailscale/tailscale <exact args>` (8 lines) | `/usrdata/tailscale/tailscale` (any arguments), `tailscaled --version` | One line per call form — [tailscale.md](tailscale.md#sudoers-surface) |
| `/sbin/reboot ""` | `/sbin/reboot` (any arguments) | The empty `""` restricts the grant to the no-argument form; every caller passes none |
| `/usr/bin/qmanager_web_port` | nothing (new) | Bare path; the helper validates the ports, and refuses `render` / `apply` when `SUDO_UID` is set — [web-port.md](web-port.md) |

Every other grant (`qmanager_crash_log_append`, the `*_arm` helpers, `qmanager_secret_set`, `qmanager_update`, …) was already a bare helper path and is unchanged. [BACKEND.md §7](../BACKEND.md#7-sudoers-rules) maps each grant to its callers.

**Why the wildcards had to go.** In a sudoers command line, `*` in the arguments matches any text — **including spaces and `/`**. So `systemctl start qmanager-*` did not mean "one QManager unit": it also matched extra unit names and extra options after the prefix, and the `ln`/`rm` lines matched paths outside the unit directory. Raw `iptables` with any arguments was broader still. Each of these allowed more than the one operation the CGI needed. sudoers cannot express "one token matching `[a-z0-9-]+`"; a helper can.

**Root is unaffected.** `platform.sh` checks `$_SUDO`: as root (daemons, the installer, systemd units) `svc_*` call `/bin/systemctl` / `ln` / `rm` and `run_iptables` calls `/usr/sbin/iptables` directly. Only the `www-data` path goes through the helpers. That split is why a rule-shape mismatch shows up only from the UI — validate CGI changes as `www-data`, never from a root shell.

### `qmanager_svc`

```sh
sudo -n /usr/bin/qmanager_svc <verb> <unit>
```

| Input | Accepted |
|-------|----------|
| `verb` | `start` · `stop` · `restart` · `reset-failed` · `is-active` · `enable` · `disable` |
| `unit` | `qmanager-` followed by at least one more character, only `[a-z0-9-]`, at most 64 characters, **no `.service` suffix** (the helper appends it) |
| arg count | exactly 2 |

Behavior:

- Every verb except `disable` requires `/lib/systemd/system/<unit>.service` to be a **regular file, not a symlink**. If it is not, `is-active` prints `inactive` and exits `3` (what `systemctl` itself returns); the other verbs exit `2`.
- `enable` runs `ln -sf` from the unit file into `/lib/systemd/system/multi-user.target.wants/` — the same manual-symlink mechanism as the rest of [Service persistence](#service-persistence-systemd-symlinks).
- `disable` removes the wants entry **only if it is a symlink**; a regular file at that path is refused (exit 2), never deleted.
- Any refusal prints `qmanager_svc: <reason>` to stderr and exits `2`. Otherwise the exit status is `systemctl`'s, `ln`'s or `rm`'s.

`platform.sh` maps names with `_svc_unit` (underscores → dashes, so `svc_restart qmanager_discord` reaches `qmanager-discord`), then `_svc_ctl` / `_svc_link` route: root → direct; `www-data` + `tailscaled` → the exact `systemctl` / `ln` / `rm` lines; `www-data` + anything else → `qmanager_svc`.

> ⚠️ WARNING: **A new non-QManager unit controlled from the CGI needs two changes.** `_svc_ctl` sends every unit except `tailscaled` to `qmanager_svc`, which refuses names that do not start with `qmanager-`. Add exact sudoers lines for the new unit **and** a matching branch in `_svc_ctl` / `_svc_link`; never widen `qmanager_svc`'s unit check or reintroduce a wildcard.

> ⚠️ WARNING: **`qmanager_svc` handles `.service` units only.** Timers are armed by their own root helpers (`qmanager_auto_update_arm`, `qmanager_scheduled_reboot_arm`, `qmanager_tower_schedule_arm`, `qmanager_scenario_schedule_arm`), not through `svc_enable`.

### Root-helper hardening that shipped with it

- **`PATH` pinned** at the top of the helpers this change touched (`qmanager_svc`, `qmanager_fw_apply`, `qmanager_dns_apply`, `qmanager_crash_log_append`, `qmanager_ethernet_apply`, `qmanager_health_check`, `qmanager_language_pack_apply`, `qmanager_sim_registry_apply`, `qmanager_timezone_apply`), independent of `secure_path`.
- **`qmanager_health_check --clear`** removes `/tmp/qmanager_health_check_*` job directories only when they are real directories (not symlinks) owned by uid 0. `/tmp` is sticky but shared, so `www-data` can create entries with matching names.
- **`qmanager_language_pack_apply`** refuses a symlinked staging path, snapshots the staging tree with `cp -RP` into a private `mktemp -d` dir (`0700`), rejects links, special files, hard-linked files and names outside `[A-Za-z0-9._-]`, then validates and commits **only that copy**. `www-data` owns the staging tree and could otherwise change files between the check and the copy.
- **`qmanager_ethernet_apply`** and **`sim_registry.sh`** write into `/etc/qmanager` through `mktemp` + `mv` — see [the redirect rule](#-any-root-helper-writing-into-etcqmanager-with-a-plain--is-redirectable).
- **`crash.log`** moved out of `/etc/qmanager` — see [the table above](#-nothing-that-must-be-protected-from-www-data-may-live-in-etcqmanager).

---

## Service persistence (systemd symlinks)

- **Boot persistence is implemented via direct symlinks** into `/lib/systemd/system/multi-user.target.wants/` (and `timers.target.wants/` for timer units), managed through `svc_enable`/`svc_disable`/`svc_is_enabled` in `platform.sh` — use those helpers everywhere; do not mix in raw `systemctl enable/disable`, because they write to a *different* wants dir (see next point). The same `/lib` manual-symlink mechanism is what the root helper `qmanager_auto_update_arm` uses to arm/disarm the auto-update timer live (see [Auto-update timer](#auto-update-timer)).
- **Those symlinks live on the rootfs, which boots read-only.** `svc_enable`/`svc_disable` ensure `rw` (root path only — `www-data` has no `mount` grant), verify the symlink's presence/absence rather than trusting the exit code, and **return 0/1**. Every call site must check that return and surface a `service_enable_failed` / `service_disable_failed` error; an unchecked call loses boot persistence silently. Read [BACKEND.md §2.1 — Rootfs mount-mode contract](../BACKEND.md#21-rootfs-mount-mode-contract) before touching any of this.
- **`qmanager-atd.service` is boot-linked on the RM520N-GL and the RG501Q-EU.** `qcmd` is its client on every model; elsewhere it runs AT in-process. `enable_services()` links it when `qm_hw_atd_enabled` is true (`RM520N*|RG501Q*`) and skips it otherwise. `start_services()` runs `systemctl reset-failed qmanager-atd` (`StartLimitBurst` counts start attempts, so repeated installs would trip it) and starts it after `qmanager-setup` and before the poller; it is in the verify list. The unit file and its wants link are removed only on a **definite** model outside that allow-list (`_atd_definitely_off`); an unknown model leaves them as they are and warns (see [platform-profile.md](./platform-profile.md#consumers)). The health check reports `svc.atd` as `pass` when active, `fail` when `failed` or `inactive` where the broker runs (a stopped broker is otherwise invisible, because `qcmd` falls back in-process), `warn` for any other state, and `skip` on other models.
- **The `/lib` manual symlink is the deliberate single source of truth — do NOT migrate to `systemctl enable`.** A live-probed migration to `systemctl enable/disable/is-enabled` was evaluated and **rejected**; see [The `systemctl enable` migration was evaluated and rejected](#the-systemctl-enable-migration-was-evaluated-and-rejected) below. The `platform.sh` comment above `svc_enable` records the same verdict.

### `systemctl is-enabled` is unreliable here

`systemctl is-enabled <unit>` reports **"disabled"** for every QManager unit — even on a device where that unit boots perfectly every time. This is a direct consequence of the symlink approach above: QManager writes its wants-symlinks into `/lib/systemd/system/*.target.wants/`, but `is-enabled` only inspects `/etc/systemd/system/...`. It never sees QManager's symlinks, so it always answers "disabled."

> ⚠️ WARNING: Never use `systemctl is-enabled` to decide whether a QManager unit will survive a reboot — it will lie. Verify boot persistence by checking the wants-symlink directly (e.g. `test -L /lib/systemd/system/multi-user.target.wants/<unit>`). Validators and health checks must do the same, never `is-enabled`.

> ℹ️ NOTE: `systemctl is-enabled` is unreliable *because* QManager symlinks into `/lib/...wants/` while `is-enabled` inspects `/etc/...wants/`. This split is exactly why the `systemctl enable` migration was rejected — see the next subsection.

### The `systemctl enable` migration was evaluated and rejected

A recurring temptation is to "simplify" `platform.sh`'s `svc_enable`/`svc_disable`/`svc_is_enabled` (and the parallel `qmanager_auto_update_arm` timer helper) to plain `systemctl enable`/`disable`/`is-enabled`. **This was live-probed on the device's systemd 244 and rejected — do not re-attempt it.** The `platform.sh` comment block above `svc_enable` records the same verdict.

The problem is a *split brain* between two different symlink locations:

- `systemctl enable` writes its wants-symlink into `/etc/systemd/system/*.target.wants/`, and `systemctl is-enabled` **only ever reads `/etc`**.
- But every deployed QManager unit is enabled via a **manual `/lib/systemd/system/*.target.wants/` symlink** — created by `install_rm520n.sh`'s `enable_services()`, by `platform.sh`, and (for the auto-update timer) by `qmanager_auto_update_arm`. `is-enabled` never sees those, so it always answers "disabled."

Mixing the two is worse than either alone. `systemctl disable` removes only the `/etc` copy and **leaves the legacy `/lib` symlink orphaned** — so a unit the UI just "disabled" (e.g. the connection watchdog) would **still autostart at every boot**, a silent regression detectable only by rebooting, which can't be exercised on the live device. A correct migration would have to relocate the entire fleet's symlinks `/lib` → `/etc` in lockstep across the installer, `qmanager_health_check`, and the uninstaller, plus a reboot test that can't be run here. Not worth it: the `/lib` manual-symlink mechanism stays as the one source of truth.

### Condition placement — unit-health lesson

Two QManager units — `qmanager-ethernet.service` and `qmanager-imei-check.service` — historically showed as `Active: failed` on a completely healthy device that simply had nothing to do. The root cause was systemd directive placement, and the rule is worth internalizing for any new no-op-capable unit:

- **`Condition*=` (e.g. `ConditionPathExists=`) MUST live in `[Unit]`.** systemd **silently ignores** a `Condition*=` placed in `[Service]` — the guard never fires, the unit's real command runs and exits non-zero, and the unit lands in `failed`. Moved to `[Unit]`, systemd skips the unit cleanly when the precondition isn't met (the unit reports `condition failed`/inactive, not `failed`). This was the Ethernet-unit fix.
- **`ExecCondition=` belongs in `[Service]`** and behaves differently on purpose: a non-zero `ExecCondition` marks the run **`skipped`**, not `failed`. `qmanager-imei-check.service` uses `ExecCondition=` so an idle "nothing to check" exit reads as skipped.

> ⚠️ WARNING: `ExecCondition=` needs systemd 243. The RM520N-GL runs 244; the RG501Q-EU runs **239**, which ignores the directive and runs the service anyway. Never use `ExecCondition=` to keep a unit off a model — remove the unit file on that model instead, as the installer does for `qmanager-atd.service`.

Net effect after the fix: `systemctl --failed` comes back clean on a healthy box, on both a fresh install and an OTA upgrade of an existing device. When authoring a unit that should no-op under some condition, decide up front which directive you want and put it in the correct section.

---

## SSH password management

- Helper: `qmanager_set_ssh_password`
- Reads the new password from stdin (`IFS= read -r`, so leading/trailing spaces are kept; 6–128 bytes) and writes a SHA-512 (`$6$`) hash via `openssl passwd -6`, falling back to MD5 (`$1$`) only if openssl cannot make `$6$`. The `/etc/shadow` update is atomic (`cp -p` + `awk` + `mv`). dropbear checks passwords through Entware's glibc 2.27 `libcrypt` (`/opt/lib`), which accepts `$6$`; existing `$1$` hashes keep working.
- Whitelisted in sudoers for `www-data` so the CGI layer can invoke it without a password.
- Called automatically during onboarding to sync the web UI password to the root account. A failed sync no longer fails silently: first-time setup in `auth/login.sh` returns `ssh_synced:false` and the onboarding password step shows a warning toast (`common:login.ssh_sync_failed`).
- **No fixed default password.** On a fresh install, `setup_ssh_early` sets root to a random 16-hex password through the shipped copy of this helper and prints it **once** in the install summary. It never goes through `info()`/`warn()`, because `/tmp/qmanager_install.log` is world-readable. (Before this, every fresh install set root to `qmanager`.)
- Also called from **System Settings → Device Access → SSH Password** (`auth/ssh_password.sh`).
- **`--verify` mode** compares a stdin password against root's existing hash and changes nothing; `ssh_password.sh` uses it to check the current root password, because `www-data` cannot read `/etc/shadow`. The bare-path sudoers line already allows the argument. The helper carries a `# qm-capability: verify` line that `cgi_auth.sh` greps before sending `--verify` — an older helper would treat the candidate as a new password and set it — and refuses any other argument with `unknown_mode`. See [passwords.md](passwords.md#checking-the-current-root-password).

---

## Networking & firewall

- **Port firewall**: `qmanager-firewall.service` keeps a `QMANAGER_FW` chain hooked at `INPUT` 1 in **both** `iptables` and `ip6tables`, plus an IPv6 `QMANAGER_FWD6` chain in `FORWARD` (below).
  - Web UI (80, 443, plus the configured and in-change custom web ports from `wp_fw_ports` — [web-port.md](web-port.md)), IPv4: allowed on `lo`, `bridge0`, `eth0`, and `tailscale0` (if installed), dropped everywhere else. IPv6: dropped on `rmnet+` (lighttpd binds IPv4 only today; this is defence in depth).
  - SSH (22): dropped on `rmnet+` (the cellular WAN) for IPv4 and IPv6, open on every other interface. This is a **block list on the WAN, not an allow list**, on purpose: SSH is the emergency path, and an allow list would lock out LAN-side interfaces QManager does not know about (QCMAP VLAN bridges `bridge+`, USB dial-up `ppp0`).
  - Before this, ip6tables `INPUT` had no rules at all and dropbear listens on `:::22`, so on a carrier that hands out a public IPv6 without inbound filtering, SSH was reachable from the internet.
- `start`/`reload` build the rules in a `QMANAGER_FW_NEW` staging chain, insert its jump, retire the old chain and rename (`-E`), so re-applying never leaves a window with no rules. Matching is by interface name, so rules apply to `rmnet_data*` whenever it comes up — no re-apply on data-call events.
  - Every call passes `-w 5`. `QCMAP_ConnectionManager` adds its own INPUT rules when the data call comes up at boot, and iptables 1.6.2 without `-w` exits 4 at once on a held xtables lock. Before this fix, those failures were ignored and left a half-built chain that dropped LAN HTTPS (RG501Q, 2026-10-31). Unit ordering cannot prevent this, because QCMAP is a daemon that runs iptables whenever a data call comes up.
  - IPv4 rules are added in an order where every prefix is safe: the `rmnet+` DROPs for 22/80/443 come first, then the trusted ACCEPTs, then the catch-all 80/443 DROPs. A chain cut short therefore blocks the WAN first and never drops LAN HTTPS before its ACCEPT is in place.
  - A partial chain is never renamed into place. If a build fails while a `QMANAGER_FW` is hooked at INPUT, that chain is kept and the staging chain is dropped. With none hooked, the partial `QMANAGER_FW_NEW` stays hooked. A failed rename retries only the rename and keeps the complete staging chain hooked, never rebuilding it. Each family gets 3 attempts, 2 s apart. A final failure is logged and exits 1, so the unit shows `failed`. Recover with `systemctl restart qmanager-firewall`.
  - Known limits:
    - A lock timeout on `-C` reads as "not hooked", and a later run starting from a degraded state (a staging chain left hooked) unhooks it before rebuilding. Either can briefly leave no rules active; both need repeated 5 s lock timeouts.
    - If the lock is held the whole time, the worst-case start is minutes (each call waits 5 s), and dropbear and lighttpd wait behind it (`Before=`).
- **IPv6 forward filter** (issue #23): `QMANAGER_FWD6` is hooked at `FORWARD` 1 as `-i rmnet+ -j QMANAGER_FWD6`. It RETURNs `ESTABLISHED,RELATED` and ICMPv6 types 1, 2, 3, 4, 128 and 129, then DROPs. RETURN (not ACCEPT) leaves QCMAP's own FORWARD rules in force. DROP is last, so a partial build is permissive, never a lock-out. It is built with the same staging swap as `QMANAGER_FW` (`use_input` / `use_forward` switch `HOOK`, `HOOK_ARGS`, `CHAIN`, `STAGE`).
  - Why: with IPv6 up, LAN clients get the WAN /64 with no NAT (`EnableIPv6NAT=0`, QCMAP sets up `ra-stateless`). The reporter's RM502Q-AE (SDX55) then measured `all/forwarding=2`, FORWARD policy ACCEPT, and only `-i bridge0 -o bridge0 -j ACCEPT`. QCMAP's own IPv6 firewall is off (`FirewallEnabled=0` in `mobileap_firewall.xml`). Without IPv6, `all/forwarding=0` on both test devices, so nothing is forwarded.
  - QCMAP owns FORWARD and runs `ip6tables --flush FORWARD` when the backhaul changes, which removes the hook. On the RM520N-GL it also runs `ip6tables -t mangle -F`, so mangle is no safer. `qmanager-firewall-watch.service` (`qmanager_firewall watch`, `PartOf=qmanager-firewall.service`) puts the jump back if the chain exists, so a stopped firewall stays stopped. QCMAP's ~200 iptables calls never pass `-w` and fail at once on a held xtables lock, so the watch does not poll iptables. Every 3 s it reads `all/forwarding` and the `rmnet*` lines of `/proc/net/if_inet6` (one `awk`; a `while read` loop over that file hangs forever on BusyBox 1.29.3 ash, measured on the RG501Q-EU). After a change it checks the hook on the next 3 ticks (≈ 6–12 s window), otherwise once a minute.
  - Accepted gaps: the OTA stops the watch while the firewall stays up, so a QCMAP flush mid-OTA leaves FWD6 unhooked until `start_services`. On a device without `ip6tables` the watch exits 0 and the installer's verify step warns.
  - `start`, `stop`, `restart` and each watch tick take `flock` on `/run/qmanager_firewall.lock` (`/run`, because www-data could pre-create a `/tmp` lock). BusyBox `flock` on both devices has no `-w`, so the wait is a 30 × `flock -n` + `sleep 1` loop.
  - Live test 2026-11-03 on both devices (no IPv6 SIM): `start`/`reload` exit 0 and leave `QMANAGER_FW` unchanged, a held lock makes `reload` wait (3.4 s / 4.1 s for a 4 s hold), a removed jump is re-hooked in ~3 s after a change and ~53 s by the once-a-minute check, and after `stop` the watch re-creates nothing.
  - Open follow-ups:
    - **No external proof yet.** No test SIM gives IPv6. Proof needs a LAN client with a global address and a scan from outside (a phone hotspot), with `ip6tables -L QMANAGER_FWD6 -v -x` counters read before and after.
    - **IPA offload path.** ipacm installs IPv6 prefix filter and routing rules, and QCMAP turns the Q6 firewall off when `FirewallEnabled=0`. Whether IPA can route unsolicited WAN→LAN IPv6 without the CPU (bypassing netfilter) is unmeasured. Check `/sys/kernel/debug/ipa/ip6_flt*` and `Ip6OutForwDatagrams` with IPv6 up. If it can, QCMAP's own `FirewallEnabled=1` is the fix (it also programs IPA). What `FirewallPktsAllowed` means there is unknown.
    - **Long offloaded flows.** A flow offloaded to IPA sends no packets through conntrack. If its entry expires, the next packet the CPU sees reads as NEW and is dropped. QCMAP's own RM520N rule (`! -i bridge+ -o bridge0 -j DROP`) has the same exposure.
    - **Inbound pinholes.** UPnP IPv6 pinholes and any user-set QCMAP IPv6 allow rules are blocked by this chain. Neither is used today (`UPnP=0`).
    - **IP passthrough / bridge mode.** QCMAP skips its IPv6 firewall there. Whether `rmnet+`→LAN forwarding still passes through this chain in that mode is unchecked.
- Lifecycle: the OTA keeps the firewall **running** (`stop_services` skips it) and `start_services` runs `systemctl reload-or-restart` (a plain `start` is a no-op on an active `RemainAfterExit` oneshot), then starts `qmanager-firewall-watch` (which `stop_services` does stop). On a fresh install `setup_ssh_early` runs the shipped script before dropbear first listens. The unit is ordered `Before=dropbear.service`. Uninstall removes both families' chains, including `QMANAGER_FWD6`.
- This service replaces SimpleAdmin's `simplefirewall` — it is QManager-owned and installed by default.

---

## Tailscale VPN

Tailscale is installed on-demand via the `qmanager_tailscale_mgr` helper. The install flow is aligned with the rgmii-toolkit convention (validated 2026-04-10). There are many non-obvious gotchas — read this section fully before touching any Tailscale code.

### Version & download

- Arch `arm`; the latest stable version and its `.sha256` are resolved at install time (no pin, no fallback). Every curl is bounded (`--connect-timeout`, `-m`, stall detection on the download), and the install fails closed. See [`tailscale.md`](./tailscale.md).
- The tarball is never written: `/usrdata` has too little room for tarball plus binaries (measured 2026-11-03: 59 MB free, 37 MB tarball, 70 MB unpacked), and `/tmp` is RAM. The download streams through `sha256sum` into `tar`, and the staged binaries are installed only after the checksum matches.
- The old "no `-fSL`, no timeouts" rule is retired: the hang came from an unbounded version lookup, and the bounded curls ran cleanly on the RM520N-GL.
- Binaries live at `/usrdata/tailscale/`.

### Two-layer execution pattern

The helper uses a deliberate two-layer design to survive CGI disconnects:

1. An **outer wrapper** stages an inner install script and a temporary systemd oneshot unit (`qmanager_tailscale_install.service`), fires the unit, and returns immediately.
2. The **inner script** runs detached under systemd, independent of the CGI caller's lifetime.

The helper calls `sleep 2` after `daemon-reload` and before `start` to give systemd time to register the new unit.

### Symlinks (both are required)

CLI accessibility requires **two symlinks**:
- `/usrdata/root/bin/tailscale` — rgmii-toolkit convention
- `/usr/bin/tailscale` — QManager's default root shell uses `HOME=/home/root` and does not have `/usrdata/root/bin` in its PATH

### Systemd units

Units come from `/usr/lib/qmanager/tailscaled.service` and `tailscaled.defaults` (bundled by the installer). The helper includes an inline fallback for these files if they are missing.

### tailscale up flag restriction

`tailscale up` must **NOT** use the `--json` flag. Its output is fully buffered on RM520N-GL (there is no `stdbuf` available) and never flushes to a file. Use interactive mode and grep for the auth URL instead.

### tailscaled state directory reset

`tailscaled` resets its state directory permissions to `700` on every start, making the binary inside inaccessible. To work around this:
- CGI `is_installed()` checks for the **systemd unit file** (world-readable) plus directory existence — not binary executability.
- `ExecStartPost=/bin/chmod 755` in the service unit restores access after each start.
- `qmanager_setup` also restores access at boot as belt-and-suspenders.

### Rootfs flush — `sync`, and never remount `ro`

**All rootfs writes must be flushed with `sync`.** `qmanager_tailscale_mgr` calls `sync` after every rootfs mutation (binary install, unit staging, uninstall removals) so a write reaches flash and survives an unclean power cut.

> ⚠️ WARNING: `qmanager_tailscale_mgr` and `qmanager_console_mgr` used to pair that `sync` with `mount -o remount,ro /`. **Both `ro` restores have been removed and must not come back.** They left `/` read-only for the rest of the uptime, after which every boot-symlink write in `platform.sh` failed with `EROFS` — so toggling Watchdog, SMS Forwarding, tower failover or Discord in the UI appeared to succeed while silently losing boot persistence. The tree now has a single convention: **remount `rw` once, never restore `ro`**. The `sync` is unrelated to mount mode and stays. Full contract: [BACKEND.md §2.1](../BACKEND.md#21-rootfs-mount-mode-contract).

### Firewall restart

The helper restarts `qmanager-firewall.service` after install so `tailscale0` is recognized as a trusted interface.

### PID tracking across install phases

PID tracking spans the full install lifetime to keep the CGI's `pid_alive` concurrency check working:
1. The outer wrapper writes its own PID initially.
2. It overwrites with the systemd oneshot's `MainPID` after unit start.
3. The inner script overwrites with its own PID via an `EXIT` trap that also handles cleanup on completion.

### Progress & log files

- Progress file (CGI poll target): `/tmp/qmanager_tailscale_install.json`
- Log file: `/tmp/qmanager_tailscale_install.log`
- No dependency on SimpleAdmin.

---

## Web console

- Service: `qmanager-console.service`
- Runs **ttyd v1.7.7** (armhf) on `localhost:8080`.
- Reverse-proxied by lighttpd at `/console` with WebSocket upgrade support.
- Binary location: `/usrdata/qmanager/console/ttyd`
- Downloaded during install — non-fatal if the device is offline at install time.
- Theme matches QManager dark mode. Shell startup script sets PATH to include Entware tools.

---

## Email & SMS alerts

### Email alerts

- MTA: `msmtp`, installed from Entware at `/opt/bin/msmtp`.
- Config file: `/etc/qmanager-secrets/msmtprc` (`0600 root:root`, inside the `0700 root:root` alert-secrets store — it embeds the Gmail app password by construction). Relocated from `/etc/qmanager/msmtprc` in v0.1.14; `www-data` cannot read it, which is why the test send goes through the `qmanager_email_send` root helper. See [alerts.md](alerts.md#secret-storage-etcqmanager-secrets).
- **Do NOT include a `logfile` directive** in msmtprc. If msmtp cannot write its log file, it returns `rc=1` even when the email was sent successfully. This causes false failures.
- The `email_alerts.sh` library detects msmtp at `/opt/bin/msmtp` explicitly — the poller's `PATH` does not include `/opt/bin`.
- Recovery emails wait **30 seconds** after connectivity returns before the first send attempt, to allow DNS and SMTP to stabilize.

### SMS alerts

- Transport: `qsms send` (the bundled `qmanager_atd` binary; QMI WMS on the RM520N-GL) — no package install needed.
- `sms_alerts.sh` is sourced by the poller and reads poller globals directly: `conn_internet_available`, `modem_reachable`, `lte_state`, `nr_state`.
- **Registration guard is mandatory before every send.** The modem must be reachable AND (`lte_state="connected"` OR `nr_state="connected"`). Waiting for registration is unbounded at the state machine level, but `_sa_do_send` caps real send attempts at 3. Unregistered skips do not consume the retry budget — they are bounded separately by `_SA_MAX_SKIPS`.
- **Recovery path has two branches**:
  - If `downtime-start` status is `"sent"`: send a separate recovery SMS.
  - Otherwise: send a combined dedup message ("was down for X, now restored").
- **Recovery is silenced** when `status="none" && duration < threshold_secs` — sub-threshold blips never generate notifications.
- Phone numbers are stored with a leading `+` but stripped via `${_sa_recipient#+}` before passing to `qsms send` (same convention as `normalize_phone()` in `scripts/www/cgi-bin/quecmanager/cellular/sms.sh`).
- No AT lock is taken for the send on the RM520N-GL; a failed send logs `qsms`'s `.detail` via `_sa_send_error`.
- **Test sends from the CGI** override `_sa_is_registered() { return 0; }` because CGI context lacks poller globals. The override must be placed **after** sourcing the library — the library has a `_SMS_ALERTS_LOADED` guard that prevents re-sourcing from clobbering the override.
- Config file: `/etc/qmanager/sms_alerts.json`
- NDJSON log: `/tmp/qmanager_sms_log.json` (capped at 100 entries)
- Reload flag: `/tmp/qmanager_sms_reload`
- Config writes are atomic: write to `.tmp`, then `mv` into place.

---

## OTA update pipeline

- **sudoers rule**: `www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_update` — allows the `update.sh` CGI to invoke the update worker as root via `sudo -n`.
- **Log file ownership trick**: The CGI spawn-line redirects to `/dev/null 2>&1` (not `>>log`) so the worker (`qmanager_update`) creates `/tmp/qmanager_update.log` as root. This sidesteps `fs.protected_regular=1`, which would block root from truncating a log file previously created by `www-data`.
- **Atomic status writes**: The worker uses `write_status` (`.tmp` + `mv`) for all status updates.
- **Progress validation**: Progress is tracked by tailing `=== Step N/M: <label> ===` lines from the installer log.
- **Two-phase VERSION write**:
  - Installer writes `/etc/qmanager/VERSION.pending` early via `mark_version_pending()`.
  - `finalize_version()` moves it to `/etc/qmanager/VERSION` at the end.
  - A surviving `.pending` file after reboot indicates a failed install.
- **Filesystem-driven cleanup**: `cleanup_legacy_scripts()` and service enable/disable scan `/lib/systemd/system/qmanager-*.service` and `/usr/bin/qmanager_*` at runtime — not a hardcoded list.
- **`UCI_GATED_SERVICES`**: Controls which services are only re-enabled if their `multi-user.target.wants/` symlink existed before the upgrade. See [OTA self-heal for gated services](#ota-self-heal-for-gated-services) — symlink state is no longer the *only* input.
- **Watchdog suppression**: The watchcat lock `/tmp/qmanager_watchcat.lock` is touched before stopping services and released via an `EXIT` trap, suppressing the watchdog during the install window.
- **Shared semver library**: `/usr/lib/qmanager/semver.sh` — sourced by both `update.sh` CGI and `qmanager_auto_update`.
- **Shared downloader library**: `/usr/lib/qmanager/downloader.sh` — sourced by `update.sh` CGI, `qmanager_update` (OTA worker), and `qmanager_auto_update` (run by the auto-update systemd timer). The two worker/timer scripts source it *guarded*, with an inline fallback so they still run if the lib is missing. See "HTTP transport & installer resilience" below — note the 3-copy maintenance hazard.
- **v0.1.4 → v0.1.5 requires ADB/SSH**: v0.1.4's CGI has no sudo and v0.1.4's sudoers has no `qmanager_update` rule, so OTA cannot self-update from v0.1.4. From v0.1.5 onward, OTA works via the UI.

### The OTA worker runs in its own transient unit; the lighttpd restart is deferred

A UI OTA starts as `update.sh` → `sudo -n qmanager_update`, so the worker begins inside `lighttpd.service`'s cgroup. Left there, any stop of lighttpd kills the whole cgroup, worker and installer included, and a `systemctl restart lighttpd` from inside it cannot finish (lighttpd sat in `final-sigterm` until the reboot). The auto-update timer has the same problem one level down: `stop_services()` stops `qmanager-auto-update.service`, the oneshot whose process `exec`s the worker.

**Detach.** At the top of `qmanager_update`, before any side effect, when `/proc/self/cgroup` names `lighttpd.service` or `qmanager-auto-update.service` and `systemd-run` exists, the worker re-launches itself and the outer copy exits:

```sh
systemd-run --unit=qm-update-worker --no-block --collect --quiet -E QM_UPDATE_DETACHED=1 /usr/bin/qmanager_update "$@"
```

- **No sudoers change.** The worker already runs as root through its bare-path grant; www-data never calls `systemd-run`.
- **The name is not `qmanager-*`** on purpose: `qmanager_svc` accepts any `qmanager-` unit, and the installer's unit globs scan `/lib/systemd/system`, never `/run/systemd/transient`.
- **The fixed name refuses a second update.** If the unit already exists the worker retries once after 2 s (a finished `download` unit may still be deactivating), then exits 1 **without** writing the status file, which belongs to the live update. Any other `systemd-run` failure (`LoadState` reads `not-found`) runs the worker in place, as before.
- **An argument containing `$` skips the detach.** systemd 239/244 expand `$VAR` in a unit's arguments and drop the word when it is empty (measured: `'$HOME'` vanished; `""` and `%n` passed through unchanged). `--expand-environment=no` only exists from systemd 254.
- `--collect` unloads the unit when it ends, failed or not, so nothing persists and the uninstaller has nothing to remove.
- Measured on both devices (2026-11-02, systemd 244 / 239): the unit gets its own cgroup, `-E` reaches the child, a duplicate name fails with rc 1, and `systemctl show -p LoadState --value` works on 239.

**Deferral.** `start_services()` skips the lighttpd restart when `QM_DEFER_LIGHTTPD_RESTART=1` (set by `qmanager_update` on its `sh install_rm520n.sh` line; a reboot always follows a successful install) **or** `/proc/self/cgroup` names `lighttpd.service`. The cgroup arm covers an older worker still running inside lighttpd — the first OTA *to* this version runs the device's old worker.

| Install path | lighttpd |
| ------------ | -------- |
| Any `qmanager_update` run (UI OTA, auto-update), or an old worker inside lighttpd's cgroup | Not restarted. Logs `lighttpd restart deferred to the reboot`; the verify loop skips lighttpd; after the other services start, runs `/opt/sbin/lighttpd -tt -f /usrdata/qmanager/lighttpd.conf` and `die`s on failure (`lighttpd config test failed — not rebooting into a broken web server`), else logs `lighttpd config test passed`. The reboot that follows starts the new config. |
| SSH install | `systemctl restart lighttpd` as before (`lighttpd restarted with QManager config`, or the warning `Could not restart lighttpd`) |

The deferral stays even though the restart can no longer kill the worker: a restart leaves a ~1 s gap, and a 2 s status poll that lands in it takes the hook's `catch` branch to `/reboot/` early, whose one-shot `reboot_ack` `wait_for_reboot_ack` then discards.

The config test runs at the end of `start_services()`, not at the deferral point, so a bad conf fails the install with the QManager daemons already running again instead of leaving them all stopped. `qmanager_update` reboots only after a successful install, so it never reboots into a conf that failed the test.

Measured on the RM520N-GL (`61368cd2`, 2026-10-31, UI OTA with sms-forward and watchcat running): lighttpd stayed `active (running)` for the whole install, the page reached `rebooting`, `reboot_ack` arrived and the reboot followed at once; after boot no qmanager unit was `failed` and every unit had `NRestarts=0`.

> ⚠️ WARNING: A **rollback or downgrade** (the CGI `rollback` action, or picking an older release in the version list) runs the target release's own installer, and inherits its bugs. Running the current installer on the old payload is not an option: `build.sh` bakes `VERSION` into the installer and its file lists and cleanup assume the current tree. Since the worker detaches, an old installer's unconditional `systemctl restart lighttpd` is a ~1 s restart instead of a hang; the page may reach `/reboot/` early and the reboot then waits out the 20 s ack timeout.

`stop_services()` also changed for the OTA window:

- **sms-forward**: `systemctl --no-block stop qmanager-sms-forward`, then `systemctl kill -s KILL qmanager-sms-forward`, before the batched stop. Daemons from v0.1.14–v0.1.18 never exited on SIGTERM, so a plain stop waited out the 90 s default and left the unit `failed`. Queuing the stop job first keeps `Restart=on-failure` from respawning it after the KILL. The unit now also has `TimeoutStopSec=10`.
- **Failed state**: after the stragglers are killed, `systemctl reset-failed $_units qmanager-watchcat`, named units only, never a bare `reset-failed`.
- **Old long flag**: `rm -f /tmp/qmanager_long_running`. The flag moved to `/run/qmanager_at/long_running`; see [at-command-transport.md > The long-command flag trust rule](./at-command-transport.md#the-long-command-flag-trust-rule).

`uninstall_rm520n.sh` stops sms-forward the same way and runs `systemctl reset-failed $_units` after its batched stop.

### OTA self-heal for gated services

**Short version: the config file is now the sole authority on whether a gated service boots. Prior symlink state is no longer consulted at all, so an OTA repairs a device that lost a symlink instead of preserving the loss forever — and honours a disable the user made since the last run.**

`enable_services()` in `install_rm520n.sh` originally restored the `UCI_GATED_SERVICES` set purely from **pre-install symlink state** — it snapshotted `multi-user.target.wants/` before wiping the tree, then recreated whatever it found. That is a reasonable "don't turn on what the user turned off" rule, but it has a trap: symlink state is not the user's *intent*, it is a cache of it. A device that lost a symlink to a transient read-only rootfs (see [BACKEND.md §2.1](../BACKEND.md#21-rootfs-mount-mode-contract)) has configured intent the snapshot can never see, so the feature stayed disabled through **every future OTA**. Discord happened to escape this because it already had a second, config-gated pass; watchcat, tower-failover and SMS forwarding did not.

`enable_services()` now routes all four through the single `_apply_gated_symlink()` helper, reading the same file each service's own CGI already treats as authoritative:

| Service | Unit | Config source | Enabled when |
|---------|------|---------------|--------------|
| Discord bot | `qmanager-discord.service` | `/etc/qmanager/discord_bot.json` | `.enabled == true` |
| Connection watchdog | `qmanager-watchcat.service` | `/etc/qmanager/qmanager.conf` (JSON despite the name), key `.watchcat.enabled` | `== true` or `== 1` |
| Tower failover | `qmanager-tower-failover.service` | `/etc/qmanager/tower_lock.json` | `.failover.enabled == true` |
| SMS forwarding | `qmanager-sms-forward.service` | `/etc/qmanager/sms_forwarding.json` | `.enabled == true` |

The helper is **symmetric** — it enables *and* disables — which is only safe because of the property that makes it so:

- **Only an explicit value acts. Everything else leaves the symlink alone.** `ln -sf` on `true`/`1`, `rm -f` on `false`/`0`, and on *anything else* — file missing, `jq` parse failure, key absent — the existing symlink is untouched with a warning. "I could not read your setting" is not the same claim as "you turned this off", and a jq `// false` cannot tell them apart, so the mapping is done by hand rather than through a default. This is what makes a never-configured device (`sms_forwarding.json` is lazily created by the CGI on first save) and a device with one corrupt config file both harmless.
- **The helper never returns non-zero.** Its call sites are bare statements under `set -e`, so a failed cosmetic `[ -L ]` test inside it would otherwise abort the installer.

> ℹ️ NOTE: All twelve `VAR=$(...)` config reads in `enable_services()` now carry an `|| VAR=<default>` fallback. The installer runs under `set -e`, so a single malformed JSON file would otherwise abort the whole run **before** `finalize_version()` — leaving `VERSION.pending` behind and the device reporting a failed install for what is really one bad config field.

### Dev-box version footgun

Running `scripts/install_rm520n.sh` **directly from a git checkout** stamps the placeholder `VERSION="v0.1.5"` — `build.sh` injects the real release version only at *package* time, never into the tracked source. A dev box installed straight from the repo therefore always believes it is on v0.1.5 and **perpetually shows "update available."** This is expected on dev boxes, not a bug.

R1's **semantic** version compare in `qmanager_update`'s `post_install_check` also fixes a related false-failure: a release whose version differs only by a **pre-release suffix** (e.g. installed `v0.1.13-draft` vs expected `v0.1.13`) no longer reports failure. The check compares the numeric core (`0.1.13`) and treats a suffix-only mismatch as **warn-and-succeed**; a real numeric-core mismatch still **fails** the install. Previously the exact-string compare threw a false "update failed" at the very last step of an otherwise-successful OTA.

### OTA URL pinning and SHA-256 verification

**Short version: every OTA mode refuses to install unless the release's own `sha256sum.txt` verifies, and only URLs of the form `<release prefix><tag>/qmanager.tar.gz` are accepted.**

- **Every mode fails closed** — `install`, `download`, `install_staged` and `rollback`. A missing checksum file, a missing `sha256sum`, an unparseable value (must be 64 hex for `qmanager.tar.gz`) or a mismatch all stop the install. The old "manual path warns and proceeds" rule and the `raw/*/qmanager-build/` URL are gone; `--unattended` is still accepted and changes nothing. Every published release (v0.1.1–v0.1.17) ships `sha256sum.txt`, so rollback still works.
- **The checksum URL is derived, never passed in.** `verify_checksum()` builds it from the validated tarball URL; `download` mode ignores its `<checksum_url>` argument.
- **Why the tag check matters.** The old pin was a `case` glob, and `*` matches `/`. curl removes `../` segments before it sends the request (measured on the device), so `.../releases/download/x/../../../../<other>/<repo>/releases/download/t/qmanager.tar.gz` passed the glob and fetched another repo's release together with its own matching `sha256sum.txt`. Tags are now limited to `[A-Za-z0-9._-]`, with no leading dot and no `..`, in `qmanager_update` (`is_safe_tag` / `validate_url`), `system/update.sh` (`version`, the saved rollback version), `qmanager_auto_update` (the API tag) and `language_packs.sh` (`lp_manifest_url_is_safe` also rejects `..`, `%`, `?`, `#`, `\`, whitespace and `//`).
- **Root-only staging.** Downloads and extraction happen in `/tmp/qmanager_stage`, recreated by root as `0711` on every run (`reset_stage_dir`). www-data can stat the staged files, which the CGI needs to show "ready", but it cannot create, swap or plant anything there. `install_staged` checks that the dir and files are root-owned and not symlinks, and re-checks the SHA-256 recorded by the verified download. Before this, www-data could write its own `/tmp/qmanager_staged.tar.gz` and run `sudo qmanager_update install_staged`, or swap files inside `/tmp/qmanager_install` before the installer ran.
- **What the checksum does not prove.** `sha256sum.txt` sits in the same GitHub release as the tarball, so it proves integrity, not who published it. Release signing was considered and deferred (2026-10-29).
- **Rollout.** An OTA *to* this version still runs the device's old worker. The new checks protect the update after that.

### OTA atomicity — known limitation

The frontend and CGI trees are deployed **wipe-and-recopy**, not staged-and-swapped. A power loss *mid-copy* can therefore leave a mixed tree (some new files, some old). The two-phase `VERSION` / `VERSION.pending` marker (above) **detects** this — a surviving `.pending` after reboot surfaces as `previous_install_failed` — but detection is not recovery.

> ⚠️ WARNING: The built-in recovery is a **user-invoked UI rollback**, which itself needs a working web UI — precisely what a half-copied tree may have broken. The real safety net is **SSH**: dropbear is installed independently and survives from the original install, so a bricked web UI is always recoverable over SSH.

**Recommended future direction (documented, not built):** stage the extract into a sibling directory and swap it in with an atomic `rename()` (or a symlink flip), so an interrupted update can never leave a partially-copied *live* tree.

### Auto-update timer

A dormant auto-updater ships as a systemd timer pair — `qmanager-auto-update.service` + `qmanager-auto-update.timer` — **default-OFF**. It is gated on the config key `update.auto_update_enabled` (surfaced at **System Settings → Software Update**). `qmanager_auto_update` re-checks the config key at runtime, so a timer that somehow fires while disabled still no-ops. When it does run, it honors the SHA-256 rules above (unattended path hard-fails on a missing/unverifiable checksum).

**Two paths arm the timer, both using the same `/lib` manual symlink:**

1. **Install / OTA** — `enable_services()` in `install_rm520n.sh` creates the `/lib/systemd/system/timers.target.wants/qmanager-auto-update.timer` symlink when the config key is on.
2. **The UI toggle — live.** Flipping the **Software Update** switch now arms/disarms the timer *immediately*, not just at the next install/OTA. `update.sh`'s `save_auto_update` action writes the config key and then calls `sudo -n /usr/bin/qmanager_auto_update_arm on|off` (sudoers: one bare-path line, `www-data ALL=(root) NOPASSWD: /usr/bin/qmanager_auto_update_arm`). The root helper mirrors the installer exactly — it creates/removes the *same* `/lib/.../timers.target.wants/` symlink (**not** `systemctl enable`, for the split-brain reason above) and `systemctl start|stop`s the unit so the change also takes effect for the current boot.

`qmanager_auto_update_arm` guarantees:
- **Strict `on`/`off` validation** — the unit name is hardcoded; any other argument is rejected.
- **Missing-unit no-op success** — a device whose OTA base predates the `.timer` unit has nothing to arm, so the helper returns `{"success":true,"armed":false,"reason":"unit_absent"}` instead of surfacing a hard error to the UI.
- **Best-effort from the CGI's view** — the config write is the source of truth (`qmanager_auto_update` re-checks it), so an arm/disarm hiccup is logged via `logger` but never fails the save.

> ℹ️ NOTE: The cadence is **not** user-configurable. The timer is `OnCalendar=daily` with `RandomizedDelaySec=3h` — a deliberate fleet-spread design so devices don't all hit GitHub at the same instant. The old "auto-update time" picker in the UI was removed (it never controlled anything), and the config key `update.auto_update_time` is now inert. The check runs once daily at a randomized time.

> ℹ️ NOTE: There was never a working cron path. An earlier `save_auto_update` wrote a crontab entry to `/var/spool/cron/crontabs/root`, but **RM520N-GL runs no `crond`**, so that entry never fired — and CGI (as `www-data`) couldn't write root's crontab anyway. That dead writer has been fully removed in favor of the systemd timer + `qmanager_auto_update_arm`.

---

## Uninstaller coverage

`scripts/uninstall_rm520n.sh` reverses the install. It is mostly **filesystem-driven** — Step 1 stops every `qmanager-*.service` it finds and Step 2 removes those unit files plus their `multi-user.target.wants/` boot symlinks by globbing the disk, so it needs no hardcoded service list. But that glob has two blind spots that each need an explicit teardown block, and the `--purge` path has a class of artifacts that must be removed by name or they strand the final directory removal.

### Timers the service glob misses

The Step 1/Step 2 globs only match `qmanager-*.service` and `qmanager*.target` in `/lib/systemd/system/`, and they only look in `multi-user.target.wants/`. Every QManager **`.timer`** unit is therefore invisible to them, for two separate reasons — its extension isn't `.service`, and its boot symlink lives in `timers.target.wants/` (systemd routes timer units through the `timers.target`, a different wants directory). Each timer gets its own teardown block in Step 1, and they come in two shapes:

| Timer | Shape | Teardown mechanism |
| ----- | ----- | ------------------ |
| `qmanager-scenario-schedule.timer` | Runtime-armed | Prefer `qmanager_scenario_schedule_arm teardown`; manual `stop` + symlink `rm` fallback |
| `qmanager-scheduled-reboot.timer` | Runtime-armed | Prefer `qmanager_scheduled_reboot_arm teardown`; manual fallback |
| `qmanager-tower-schedule-apply.timer` + `…-clear.timer` | Runtime-armed (pair) | One `qmanager_tower_schedule_arm teardown` call drops both; manual fallback |
| `qmanager-auto-update.timer` | **Static installer-shipped** | Direct `stop` + `rm` of the `timers.target.wants/` symlink **and** the unit file |

- **Runtime-armed timers** are created on demand by an arm helper (there is no `.timer` file on disk until a schedule is set — RM520N-GL has no `crond`, so schedules are implemented as runtime-generated systemd timers; see [Auto-update timer](#auto-update-timer) for the same `/lib` manual-symlink mechanism). Their teardown prefers the helper's own `teardown` verb (authoritative and idempotent) and falls back to a manual `stop` + symlink/unit `rm` if the helper binary is already gone (partial install). These blocks **must run before Step 3** deletes the arm-helper binaries from `/usr/bin/`.
- **The auto-update timer is different: it is static — shipped by the installer as a real unit file** that exists whether or not the feature is enabled. So it is caught by *neither* the `.service` glob (wrong extension) *nor* any arm-helper teardown (the helper `qmanager_auto_update_arm` only ever adds/drops the boot symlink — it never removes the unit file). Its block removes both the `timers.target.wants/` symlink and the unit file directly.

> ℹ️ NOTE: If you add a new static-shipped `.timer` in the future, it needs its own explicit removal block here — the Step 2 glob will silently leave the unit file and its `timers.target.wants/` symlink behind, and the orphaned symlink will still try to start a now-deleted unit at every boot.

### The broker's files the globs miss

The Step 2 / Step 3 globs already remove `qmanager-atd.service`, its wants link and `/usr/bin/qmanager_atd`, and Step 10's `/tmp/qmanager_*` covers `/tmp/qmanager_qmi.json` (also removed by name) and a leftover legacy `/tmp/qmanager_at.lock`. Five things need their own lines:

| Artifact | Step | Why |
| -------- | ---- | --- |
| `/usr/bin/qcmd` | 3 | Not `qmanager_*`; a link to `qmanager_atd` since T5.1 S6. Removed by name with `rm -f`, together with any leftover `atcli_smd11` / `sms_tool` |
| `/usr/bin/qsms` | 3 | Not `qmanager_*`. Removed only if it is a symlink (`[ -L ]`), never a real directory |
| `/var/run/qmanager_atd.sock`, `/var/run/qmanager_atd.proto` | 10 | Broker runtime lives in `/var/run`, not `/tmp` |
| `/var/run/qmanager/` | 10 | Same; `rm -rf` |
| `/run/qmanager_at/` | 10 | The AT lock dir since T4.3 (`at.lock`, and the `bridge` marker if an OTA left one). `rm -rf` by name: the `/var/run/qmanager` line does not match it |

**Rollback to v0.1.17** (`qmanager_update` re-runs the previous release's own installer) removes the binary, the unit and its wants link through that installer's `cleanup_legacy_scripts()`, because neither exists in its source. It leaves a **dangling `/usr/bin/qsms`** — nothing in v0.1.17 calls it. A later install that ships the broker re-points it, and an uninstall removes it.

### Artifacts that strand the final `rmdir`

The uninstaller's last act (Step 12) is `rmdir "$QMANAGER_ROOT"` (`/usrdata/qmanager`) — a **non-recursive** removal that only succeeds if the directory is already empty. Anything left directly under `/usrdata/qmanager/` that the earlier steps didn't remove will silently block it, leaving the whole tree behind. The trap is that `install_frontend`'s wipe-and-recopy only ever touches `www/`, so any state file or directory placed as a **sibling** of `www/` survives both OTA and the frontend teardown and must be removed **by name**:

| Artifact | When removed | Why it's not caught elsewhere |
| -------- | ------------ | ----------------------------- |
| `apn_setting.json`, `apn_names.json` | `--purge` only (config) | **Legacy path.** Both sidecars now live in `$CONF_DIR` (`/etc/qmanager/`), which the `--purge` `rm -rf` already covers — they moved there because `/usrdata/qmanager` is `0755 root:root` and both writers run as `www-data`, so every write silently no-op'd (see [wan-profile-management.md](wan-profile-management.md#why-the-sidecars-live-in-etcqmanager)). `install_rm520n.sh`'s `migrate_apn_sidecars()` moves fielded devices across, but a device uninstalled **before** it ever OTA'd through that migration still has them here — and either one left behind re-strands the `rmdir`. Keep this line. |
| `locales-packs/`, `locales-staging/` | `--purge` only (config) | Language-pack persistent store + staging quarantine, siblings of `www/` (see [i18n runtime downloader](i18n.md)) |
| `crash.log`, `crash.log.*`, `.crash_log_migrated` | `--purge` only (config) | Reboot-cause log and its one-time migration marker, moved here from `/etc/qmanager` in 2026-10 (see [alerts.md](alerts.md#the-user-breadcrumb-root-helper)). The old location was covered by the `$CONF_DIR` purge; this one is not, so it is removed by name. A plain uninstall keeps it, like other config. |
| `/etc/data/qmanager/` | **Every uninstall** (unconditional) | Installer-created DNS staging scratch dir (`www-data:www-data` 0700) — not user config, so it isn't gated on `--purge` (see [custom-dns](custom-dns.md)) |

### `/tmp` runtime state: one prefix glob, not a roster

Step 10's `/tmp` cleanup is **one line**: `rm -f /tmp/qmanager_*`, plus a second line for `/tmp/qmanager.log*` because a dot rather than an underscore follows the prefix there and the first glob does not match it.

It used to be twelve lines: three extension globs (`*.json`, `*.pid`, `*.lock`) and a hand-kept roster of named files. **Every extension-less runtime file the product writes therefore leaked through an uninstall** and survived until the next reboot cleared the tmpfs — both scan error files, the `/tmp/qmanager_long_running` maintenance marker, three watchcat flags, `qmanager_events_reload` and `qmanager_install.log` among them. The roster had already been extended three times without anyone noticing that the *class* was open; a prefix glob closes it permanently, because every file this product writes to `/tmp` is named `qmanager_*` by convention.

Two things make the broader glob safe rather than reckless:

- **Uninstall is terminal and standalone.** It is never invoked from the OTA path (`qmanager_update`), so there is no in-flight staging state (`qmanager_staged.tar.gz`, `VERSION.pending`'s companions) that a live update still needs.
- **Directories under the prefix are skipped harmlessly.** `qmanager_install/` and the session directory fail a plain `rm -f` with `EISDIR`, which the trailing `|| true` swallows exactly as the old form did; `$SESSION_DIR` is still removed explicitly by the `rm -rf` on the next line.

> ⚠️ This step is also what makes deleting `/tmp/qmanager_scan.lock` safe *here and nowhere else*. Unlinking a lock file detaches the name without releasing the lock, so a later opener gets an independent lock on a fresh inode and mutual exclusion silently disappears. The uninstaller gets away with it only because Step 1 already stopped lighttpd and killed every worker. Do not copy this `rm` into a boot-time or periodic `/tmp` tidy-up. See [cell-scanner.md](cell-scanner.md).

### Same bug class, twice

The language-pack store and the older APN sidecars are the same bug class: `apn_names.json` was a pre-existing orphan that was never purged, so it silently blocked the `rmdir` and left `/usrdata/qmanager/` behind after every `--purge` uninstall. The rule for any new persistent state written outside `www/`: **if the installer or a runtime feature creates it under `$QMANAGER_ROOT` but outside `www/`, the uninstaller must remove it explicitly** — on `--purge` if it's user config, unconditionally if it's scratch/derived state.

---

## HTTP transport & installer resilience

- **`curl` is NOT a hard requirement.** The install and OTA pipeline auto-detect whichever HTTP downloader the device has — `curl` or `wget` — and use it. `curl` is preferred when both are present, but it is **never force-installed**.
- **Shared downloader library**: `/usr/lib/qmanager/downloader.sh` (POSIX sh) is the canonical implementation. Functions:
  - `qm_downloader()` — echoes `curl`, `wget`, or `""` (empty if neither). Non-network presence detection only; curl preferred.
  - `qm_https_ok()` — **advisory** HTTPS probe. Warn-only — it never gates a download.
  - `qm_download <url> <dest> [timeout]` — downloads; removes `<dest>` on failure.
  - `qm_download_headers <url> <body> <hdr> [timeout]` — downloads and captures response headers (used for GitHub rate-limit detection).
  - Sourcing the lib also exports an Entware-inclusive `PATH`.
- **Detection is non-network**: it checks tool presence and curl-preference only. The HTTPS probe (`qm_https_ok`) is advisory — the installer preflight *warns* if it cannot confirm `wget` does HTTPS, but **never aborts**. The real download is the authoritative test.
- **opkg bootstrap is hash-pinned.** `opkg` and `opkg.conf` are fetched over https first, then plain http, and must match `ENTWARE_OPKG_SHA256` / `ENTWARE_CONF_SHA256` (`dl_get_pinned`), so the transport no longer matters. The http fallback exists because **BusyBox `wget` fails the TLS handshake with bin.entware.net** (alert 40, measured 2026-10-29), and it also does no certificate checks at all. If Entware rebuilds its installer, both hashes must be updated or fresh installs stop with "Failed to download a verified opkg".
- **The Entware package feed is still plain HTTP, on purpose.** `/opt/etc/opkg.conf` keeps `src/gz entware http://bin.entware.net/...` because opkg can only download through `wget`, and BusyBox `wget` cannot do https with that mirror; an https feed would break every package install on the RM520N-GL. Closing this gap needs Entware `wget-ssl` (which validates certificates against `ca-bundle`) installed before the feed is switched, an open follow-up.
- **Other pinned third-party downloads:** Ookla speedtest 1.2.0 (`install_speedtest_cli`) is checked against a pinned SHA-256; bumping the version means updating its hash. Tailscale is not pinned: `qmanager_tailscale_mgr` resolves the latest stable version and its published SHA-256 at install time. zapret `tpws` was already pinned.
- **⚠️ `opkg` itself is not downloader-agnostic — it shells out to `wget`, hardcoded.** The rule above ("curl is not a hard requirement") describes *QManager's own* downloads. Entware's `opkg` is a third-party binary and has no such flexibility: there is no `option downloader` in `/opt/etc/opkg.conf` and no such string in the binary (version `d038e5b6`, 2022-02-24), so `curl` cannot be selected. On a device with **no `wget` at all** — the RG501Q-EU, whose BusyBox 1.29.3 lacks the applet — `opkg` can fetch nothing, including a `wget` to fix itself with. `install_dependencies()` breaks that cycle with a **temporary** curl-backed `wget` shim in `/tmp`, gated on `command -v wget` failing, then installs the real `wget-ssl` from Entware as the permanent handoff and deletes the shim before returning. The RM520N-GL ships `/usr/bin/wget` and never takes the path. Full mechanism and the per-device facts: [`platform-matrix.md`](platform-matrix.md) and [`rg501q-bringup.md`](rg501q-bringup.md).
  - **The shim must never become persistent.** `/opt/bin` precedes `/usr/bin` in the *vendor* default `PATH`, so an `/opt/bin/wget` would shadow the real system `wget` for CGI, the OTA downloader and every root helper — and `uninstall_rm520n.sh` deliberately never removes anything under `/opt`, so it would outlive QManager.
  - **The shim's `--version` output must not contain the string "GNU Wget", in any form.** `downloader.sh:115` does a case-insensitive substring match on it to pick a header-dump strategy, and a substring match does not care that the mention was a disclaimer.
- **Bootstrap completeness is checked, not just presence.** The guard is `qm_entware_complete()`: `$OPKG` executable **AND** `/opt/etc/init.d/rc.unslung` present **AND** `opkg list-installed` non-empty. A bare `[ -x "$OPKG" ]` was a poison pill — the binary is written part-way through the bootstrap block, so a device that died after that point reported "Entware already installed" forever and skipped ~120 lines that never ran. Both `die` paths now remove the half-written binary first.
- **⚠️ OTA cannot deliver a bootstrap fix.** `qmanager_update` always invokes the installer with `--skip-packages` (`scripts/usr/bin/qmanager_update:260,464,576,651`) and `install_dependencies()` is gated behind `DO_PACKAGES` (`scripts/install_rm520n.sh:3426`). A device stranded half-bootstrapped needs a **fresh full installer run**, not a Software Update. Deliberate scoping decision, not an oversight.
- **`qm_download_headers` portability**: GNU `wget` uses `-S` for full headers; BusyBox `wget` has no header-dump option, so the function falls back to harvesting the HTTP status line from stderr. Coarse rate-limit detection still works — only the precise reset time is lost.
- **ELF sanity check**: `install_rm520n.sh` verifies the downloaded opkg binary's ELF magic bytes, because `wget` (unlike `curl -f`) writes HTTP error pages to disk on a 4xx/5xx.
- **Maintenance hazard — three copies of the detection logic.** The canonical `downloader.sh` lib, plus inline copies in `qmanager-installer.sh` (bash) and `install_rm520n.sh` (sh). The inline copies exist because the install scripts run *before* the lib is on disk. **Bug fixes must be applied to all three.** The inline copies carry a comment pointing at the canonical lib.
- **`opkg update` failure is handled gracefully**: all Entware package installs are skipped with clear warnings, but the rest of the install (scripts, frontend, systemd units) continues normally. The warning names **both** plausible causes and leads with opkg's own first error line — "Package list download failed (opkg: … wget returned 4.) — check connectivity, or opkg has no usable wget" — via `qm_opkg_update`, which also writes the full opkg output to the install log on failure. Both causes stay named because the old connectivity-only wording once misdiagnosed the RG501Q-EU (no wget then). The opkg line makes the cause visible: in S11 (2026-11-03) the RG501Q-EU's failure was a DNS timeout with no signal, not wget.

---

## The `timeout` contract

**Short version: never call `timeout` directly in QManager shell code — call
`qm_timeout SECS COMMAND [ARGS...]`.** BusyBox moved the seconds value from an
option (`-t SECS`, ≤1.29) to the first positional argument (≥1.30), and the two
supported devices straddle that release, so no single literal invocation works on
both. Per-device behaviour, the two misdiagnoses it caused, and the applet census:
[`platform-matrix.md`](platform-matrix.md).

- **Canonical implementation**: `scripts/usr/lib/qmanager/platform.sh`. Callers
  always write the coreutils (positional) form; the wrapper dispatches to whatever
  the resolved binary accepts.
- **⚠️ Detect the interface, not the name.** The old guard was
  `command -v timeout`, which always succeeds because BusyBox ships the applet —
  so the `coreutils-timeout` package it gated was **never installed on either
  device**. `qm_timeout` instead probes *behaviour* once (at load in daemons,
  at the first `qm_timeout` call in a lighttpd CGI): run
  `timeout 1 true` and check for exit **127**, which means this build could not
  exec `1` as a program and therefore wants the legacy `-t` form. Generalize the
  rule: **never detect a tool with `command -v` when what matters is which
  interface it implements.**
- **⚠️ Resolve Entware binaries by absolute path when the caller may be a root
  helper.** A helper invoked as `setsid sudo -n …` from a `www-data` CGI receives
  `PATH=/bin:/usr/bin` — **no `/opt/bin`** (measured 2026-08-25, before the
  drop-in set `Defaults:www-data secure_path` in 2026-10; with that line the
  sudo'd `PATH` should now start with `/opt/bin`, not yet re-measured). Keep
  resolving by absolute path anyway: systemd-started root code still runs
  without `/opt/bin`. `qm_timeout` tries `/opt/bin/timeout` then
  `/usr/bin/timeout` by literal path. Installing an Entware binary is *not*
  sufficient to make it reachable from the privileged path.
- **⚠️ The 143→124 remap is load-bearing — do not "simplify" it away.** GNU
  coreutils `timeout` hardcodes exit **124** when it enforces the deadline;
  BusyBox relays the killed child's wait status instead (SIGTERM → 128+15 =
  **143**). Since neither device shipped `coreutils-timeout`,
  `qmanager_health_check`'s `rc = 124` "DNS timed out" branch was dead on **both**
  devices for its entire existence. The remap is deliberately scoped *inside*
  `qm_timeout` only — it is not a codebase-wide "143 means timeout" rule.
- **Fail open, never unbounded.** If no usable binary is found, `qm_timeout`
  bounds the command itself with a background PID and a `kill -TERM` loop. An
  unbounded call inside a `set -e` installer would hang the whole install, which
  is the exact hazard `timeout` exists to prevent.
- **Maintenance hazard — three copies, same as `downloader.sh`.** The canonical
  lib plus local copies in `install_rm520n.sh` (runs *before* the libs are
  deployed, and `--frontend-only` never deploys them while still running the
  verification code that calls it) and `qmanager_health_check` (redeployed by OTA
  independently of the lib, so a device mid-upgrade can have a `platform.sh` that
  predates `qm_timeout`). **Fixes must be applied to all three.** Since T6.2 the
  canonical lib wraps the probe in `_qm_timeout_probe` and defers it under
  lighttpd; the two copies still probe at load, which is equivalent because
  neither ever runs as a CGI. Compare the probe body, not the wrapper.
  `scripts/test/timeout-portability.sh` used to fail the build if they diverged — it
  compared the code with comments stripped, so comments could abbreviate but logic
  could not. `scripts/test/` was deleted 2026-09-03; diff the three copies by hand
  (with comments stripped) if drift is suspected.
- **`getent` is absent on BOTH devices**, so `qmanager_health_check`'s
  `command -v getent` DNS arm was unreachable everywhere and has been removed.
  `nslookup` is the only live DNS path. Worth knowing before "fixing" a branch
  that has never executed on hardware.
- **`platform.sh`'s load guard must stay `${_PLATFORM_LOADED:-}`.** With a bare
  `$_PLATFORM_LOADED` the lib's *first line* aborts any caller running `set -u`
  (`qmanager_health_check` does), and a `. lib || { fallback; }` guard cannot
  rescue that — the shell is already gone.

### Health check on the RG501Q-EU, and the poller it pauses

**F7 is fixed** (`80cf0639`): `t_perm_tmp_writable` no longer shells out to
`su`, which hung forever when the check already ran as `www-data`. It now
measures the write with `sudo -n -u www-data touch`. A full run finished on the
RG501Q-EU on 2026-10-29 (`b7e3d6f1`): 38 pass, `svc.atd` pass; `net.ping`
failed only because that device has no working internet.

> ⚠️ WARNING: `svc.poller` reads `inactive` (warn) on every run that found the
> poller running, on both models. The check stops `qmanager-poller` for its own duration
> (`_pause_poller_if_running`, so per-test `qcmd` calls are not starved by the
> AT lock) and restarts it from an `EXIT`/`INT`/`TERM` trap. The warning is the
> check observing its own pause, not a stopped poller. Open, not fixed.

---

## Supplemental assets

- **Speedtest CLI**: Downloaded from `install.speedtest.net` (package: `ookla-speedtest-1.2.0-linux-armhf.tgz`) during install. Placed at `/usrdata/root/bin/speedtest` with a `/bin/speedtest` symlink. CGI scripts discover it via `command -v speedtest`. Non-fatal if the download fails.
- **Cell scanner operator lookup**: `qmanager_cell_scanner` uses `operator-list.json` from `/usrdata/qmanager/www/cgi-bin/quecmanager/` for MCC/MNC → provider name resolution. The `jq` expression handles both `--slurpfile` (wrapped array) and `--argjson` (direct) operator input formats.
