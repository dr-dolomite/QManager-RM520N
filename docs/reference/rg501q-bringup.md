# RG501Q-EU probe — 2026-08-24

> **Applies to:** RG501Q-EU (SDX55) · measured 2026-08-24 over adb
> **RM520N-GL (SDX65):** comparison values quoted from [`platform-matrix.md`](./platform-matrix.md)

Device: adb serial `b7e3d6f1`, uid=0 root shell. All commands read-only.
Comparison column is RM520N-GL as documented in `docs/reference/platform-matrix.md`.

## Identity

| Fact | RG501Q-EU (measured) | RM520N-GL (documented) |
| --- | --- | --- |
| `Project Name:` | `RG501QEU_VD` | `RM520NGL…` |
| `Project Rev :` | `RG501QEUAAR12A11M4G_04.202` | — |
| `Branch  Name:` | `SDX55` | `SDX6X` |
| `Custom  Name:` | `STD` | — |
| Package Time | 2025-02-21 | — |
| Hostname / SoC | `sdxprairie` / SDXPRAIRIE | SDXLEMUR |
| `/etc/os-release` | `ID=mdm`, `VERSION=202502211319` | — |

Probe: `adb shell cat /etc/quectel-project-version`

## CPU / ABI

| Fact | Value |
| --- | --- |
| Arch | `armv7l`, ARMv7 Processor rev 5 (v7l) |
| Core | Cortex-A7 (`CPU part 0xc07`), **single core**, BogoMIPS 38.40 |
| Features | `half thumb fastmult vfp edsp neon vfpv3 tls vfpv4 idiva idivt vfpd32 lpae evtstrm` |
| Float | **hard-float capable** (vfpv3/vfpv4/neon), userspace loader `ld-linux-armhf.so.3` |
| glibc | **2.28** (RM520N-GL: 2.31) |
| Kernel | **4.14.206** PREEMPT (RM520N-GL: 5.4.210-perf) |
| RAM | 230960 kB ≈ 225 MB (RM520N-GL: 178 MB) |

Probes: `cat /proc/cpuinfo`, `ls -la /lib/ld-linux*`, `/lib/libc.so.6`, `uname -a`,
`head -5 /proc/meminfo`

## Filesystem

| Fact | Value |
| --- | --- |
| Boot cmdline | `noinitrd ro rootwait … rootfstype=ubifs root=ubi0:rootfs ubi.mtd=30 ubi.mtd=25` |
| Rootfs | `ubi0:rootfs` — **`ro` in cmdline**, currently mounted `rw` (same pattern as RM520N-GL) |
| Rootfs size | 87.2 MB, 69.9 MB used, **17.3 MB free (80%)** |
| Writable volume | `/dev/ubi2_0` — **130.7 MB total, 17.8 MB used, 112.9 MB available** |
| Shared on ubi2_0 | `/usrdata`, `/etc`, `/data`, `/cache`, `/systemrw`, `/persist`, **`/opt`** |
| `/opt` | **NOT a dedicated volume** — bind of `/usrdata/opt` on ubi2_0 (RM520N-GL has a dedicated UBIFS volume) |
| `/tmp` | tmpfs, 112.8 MB |
| `fs.protected_regular` | **0** (RM520N-GL: 1) |
| MTD | mtd29 `usrdata` (0x09e80000), mtd30 `system` (0x06ec0000) |

Probes: `cat /proc/cmdline`, `cat /proc/mounts`, `df -h`, `cat /proc/mtd`,
`sysctl fs.protected_regular`

## Toolchain present in the stock image

| Tool | RG501Q-EU | Note |
| --- | --- | --- |
| `curl` | **/usr/bin/curl** | stock — on RM520N-GL this is Entware |
| `lighttpd` | **/usr/sbin/lighttpd** | **stock** — on RM520N-GL this is Entware |
| `openssl` | /usr/bin/openssl | stock |
| `bash` | /bin/bash **4.4.23** | RM520N-GL: 3.2.57 (this is NEWER) |
| `busybox` | /bin/busybox **v1.29.3** | RM520N-GL: 1.31.1 (this is OLDER) |
| `tar` `gzip` `unzip` | present | |
| `systemd` | **239**, pid 1 | `/lib/systemd/system` present |
| `wget` | **MISSING** | |
| `jq` | **MISSING** | hard dependency of the QManager backend |
| `ssh`/`sshd`/`dropbear`/`scp`/`sftp` | **MISSING** | why only adb works today |
| `python3` | MISSING | |

Probe: `for t in …; do command -v $t; done`

## Network state

- Only `bridge0` 192.168.225.1/24 and `ecm0` 169.254.3.1/24 (USB) are up.
- **No default route, no DNS** — `/etc/resolv.conf` → `/etc/resolv-conf.systemd`, empty.
- All `rmnet_data0-5` **DOWN**; `rmnet_ipa0` UP. No cellular data session.
- **`eth0` EXISTS** but `NO-CARRIER` — answers a spec Phase-B open question: the
  RG501Q-EU carrier board *does* expose Ethernet.
- `curl http://bin.entware.net/...` → `Could not resolve host` (exit 6).
  `curl https://github.com` → same. **The device has no internet at all right now**,
  so the China-blocking hypothesis is untested from this device.

Probes: `ip -br addr`, `ip route`, `nslookup`, `curl -sS -m 10 -w %{http_code}`

## Existing install state (the important part)

QManager **v0.1.12** was installed on **2026-06-22** and is partially running.

- `/etc/qmanager/VERSION` = `v0.1.12`; config files present (`qmanager.conf`,
  `ping_profile.json`, `quality_thresholds.json`, `long_commands.list`).
- `/etc/qmanager` is `www-data:www-data drwxrwxrwx` — matches the documented
  "cannot hold a root-pinned file" constraint.
- `/usrdata/simpleadmin` and `/usrdata/simpleadmin-go` also present.
- 10+ `qmanager-*` systemd units installed.

### Entware bootstrap died partway

| Artifact | State |
| --- | --- |
| `/opt/bin/opkg` | **present**, 752572 bytes |
| `/opt/etc/opkg.conf` | **present** — `src/gz entware http://bin.entware.net/armv7sf-k3.2`, `arch armv7-3.2 160` |
| `/opt/lib/opkg/info` | **EMPTY — zero packages installed** |
| `/opt/lib/ld-*`, `/opt/lib/libc*` | **absent** — the Entware base was never installed |
| `/opt/bin` | contains **only** `opkg` |

This is exactly the failure the installer predicts at `install_rm520n.sh:803-806`:
`opkg update` fails → `die "opkg update failed — check internet connectivity"`.
Everything before that step succeeded; nothing after it ran.

### Unit states — the pattern is diagnostic

| Unit | State |
| --- | --- |
| `qmanager-ping` (Rust binary) | **active running** — and it works: `/tmp/qmanager_ping.json` 466 bytes, freshly written |
| `qmanager-poller` | active running, but **produces nothing** — `/tmp/qmanager_events.json` is 0 bytes, no `qmanager_status.json` at all |
| `qmanager-console`, `-cfun-fix`, `-setup`, `-ttl` | active |
| `qmanager-ethernet` | **failed** |
| `qmanager-firewall` | **failed** (exit code 4) |
| `qmanager-imei-check` | **failed** |
| `qmanager-mtu` | inactive dead |

**The only component that works is the one with no Entware dependency.** Everything
that needs `jq` runs but emits nothing.

### Clock

Unit timestamps read `Thu 1970-01-01 00:00:25 UTC`, `/tmp` files stamped
`Jan 1 00:00` / `11:01`. `journalctl` returns "No entries". The 1970 boot window
and the disabled-journald behavior both appear to apply here as on RM520N-GL —
**worth confirming explicitly, not yet proven.**

## Offline-install assets that already exist in the repo

`dependencies/` already ships pre-built `armv7-3.2` packages and the installer
already has an offline code path for them:

| File | Size | Installer path |
| --- | --- | --- |
| `jq.ipk` | 148888 | `install_rm520n.sh:891-893` — "jq installed from bundled package" |
| `dropbear_2024.86-1_armv7-3.2.ipk` | 108240 | `:921-923` and `:3040-3041` |
| `atcli_smd11` | 661616 | first-party binary, installed unconditionally |
| `sms_tool` | 439556 | first-party binary |

Entware packages the installer fetches **online only** today:
`entware-opt` (base), `lighttpd` + `lighttpd-mod-{cgi,openssl,redirect,proxy}`,
`sudo`, `coreutils-timeout`, and `msmtp` (`OPTIONAL_PACKAGES`).

Note `arch armv7-3.2 160` in the device's own `opkg.conf` matches the bundled
`.ipk` suffix exactly.

---

## The real blocker is GitHub, not Entware

This is the finding that reframes the work. It comes from the device owner
("Lae", in China), corroborated against on-device artifacts.

**What the owner reported, verbatim:**

- *"My country network have connection issue with github, GFW"*
- *"but, rm520n can not directly run simple admin through github"*
- *"I run modified simple admin through gitee (china version)"*
- *"no, original fw haven't opkg"* — see the correction below
- Asked whether Entware itself was reachable: *"I am not sure, how to check?"*

**The confirmed block is GitHub, and only GitHub.** The workaround already used
in practice is a **Gitee mirror**.

**Entware is not a blocker.** An earlier draft of this document treated it as an
open question; that came from a mis-recollection on our side, corrected by the
project owner on 2026-08-24, and the evidence supports the correction:

- `simpleadmin-source/installentware.sh` bootstraps Entware from
  `bin.entware.net`. SimpleAdmin cannot install without it.
- Lae runs SimpleAdmin on an RM520N **through Gitee** — so that chain, Entware
  bootstrap included, completes on their network.
- This RG501Q carries `simpleadmin-go` (8.6 MB, dated 2026-03-29) plus a
  generated `server.crt`/`server.key`, so a SimpleAdmin install ran here too.

**Measured 2026-08-24 — `bin.entware.net` returns HTTP 200 from inside China.**
Lae ran, over adb on a **T99W175** module on the same network (a third device,
not this RG501Q and not their RM520N):

```
curl -sS -m 10 -o /dev/null -w '%{http_code}
' http://bin.entware.net/armv7sf-k3.2/Packages.gz
200
```

That is the exact host, arch path and file `opkg update` fetches, so the Entware
package index — not just the installer binary — is reachable behind the GFW. The
inference above is now an observation: **GitHub is the only blocked dependency.**
Offline-Entware bundling is unnecessary.

### On-device evidence that Entware was reachable

| Artifact | Evidence |
| --- | --- |
| `/opt/bin/opkg` | 752572 bytes, dated 2026-06-22, runs: `opkg version d038e5b6d155784575f62a66a8bb7e874173e92e (2022-02-24)` — this is the **Entware** opkg |
| Where it came from | `install_rm520n.sh:726` fetches it from `http://bin.entware.net/armv7sf-k3.2/installer`. It is **not** in the repo's `dependencies/` |

So `bin.entware.net` served a 752 KB binary to this device successfully. That is
hard to reconcile with "Entware is blocked". Yet `/opt/lib/opkg/info` is empty,
so `opkg update` — which fetches `Packages.gz` from the **same host** — did not
succeed.

`/opt/var/opkg-lists` exists but is empty — the directory `opkg update` writes
package indexes into, created and never filled.

**Most likely explanation: no WAN at install time, not GFW filtering.** This
device has no default route and no DNS *today*, with every `rmnet_data*` down,
and `curl` fails to resolve **any** host — github.com and bin.entware.net alike.
An installer run in that state fails `opkg update` for want of any connectivity
at all. That is an ordinary offline failure, not evidence of a block.

Recorded as an observation, not a blocker. It does not need resolving before
Phase D is designed.

### Correction to the owner's account

*"original fw haven't opkg"* is contradicted by the device. `/usr/bin/opkg_old`
exists — 18924 bytes, dated **2025-02-21**, the factory build date — alongside
`/usr/bin/opkg-check-config`. That is the **factory** opkg, renamed by our own
installer at `install_rm520n.sh:729-733` ("Rename factory opkg if present").
`mv` preserves mtime, which is why it still carries the firmware date.

The owner may have meant the factory opkg is unusable (no repo configured), which
is plausible and untested. Either way the installer's rename path handled it, so
this is not a blocker — but the matrix should record what the device shows, not
the report.

## What GitHub dependence actually costs a China user

Every one of these fetches from GitHub and therefore fails behind the GFW:

| Path | Where |
| --- | --- |
| Installer / tarball download | `install_rm520n.sh`, README curl+wget one-liners |
| OTA update check + download | `qmanager_update:147`, `qmanager_auto_update:61`, `update.sh:245` |
| Language packs | the `language-packs` release |

So a China user cannot **install** and cannot **update**. Entware, if reachable,
is the smaller half of the problem.

## Current runtime state (2026-08-24)

`/tmp/qmanager.log` shows the Rust ping daemon looping every ~15s:
`primary http://cp.cloudflare.com/ failed, trying secondary
http://www.gstatic.com/generate_204` — consistent with the device having no WAN
at all, not with selective filtering. Nothing else writes to the log.

`lighttpd` is **not running**, so there is no web UI. `/usrdata/qmanager/www`
(16 entries) and `/usrdata/qmanager/lighttpd.conf` were deployed, so the failure
is at service start, not at file deployment.

## Open questions this probe could not answer

The device has **no WAN** (no default route, no DNS, all `rmnet_data*` down), so
every reachability question is untestable from here today:

1. Is a Gitee mirror the supported China path, or does QManager need a generic
   configurable mirror base URL? (Generic costs little more and does not bind the
   project to one Chinese host.)

   *(Entware reachability is no longer among these — it was measured at 200 on
   2026-08-24; see "The real blocker is GitHub, not Entware" above.)*
2. Which GitHub-facing paths need to honour that mirror base — installer, OTA
   check, OTA download, language packs — and how does `validate_url()` widen
   minimally to allow it without admitting arbitrary refs?
3. AT transport: `/dev/smd11` exists `root:dialout`, but nothing has exercised it
   here — `qcmd` does not exist without a working install.
4. Counter orientation on this firmware vs the SDX55 assumption in
   `data-counter-platform-matrix.md`.
5. Does this device attach to cellular at all with a SIM fitted? Everything
   network-facing here is untested because it currently has no WAN.

*(Offline-Entware questions — `file://` source support, `entware-opt` dependency
closure — are parked. They only matter if Entware turns out to be unreachable,
which nothing currently suggests.)*
