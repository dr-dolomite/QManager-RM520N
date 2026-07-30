---
name: speedtest-live-probe-facts
description: Probing Ookla speedtest on the live RM520N-GL — 400MB/run data cost, the NDJSON progress file is deleted on harvest, Ookla config never persists, and the /tmp cache-file ownership trap
type: project
---

Probing the Speedtest feature on the live modem has four costs/traps that are invisible from the source tree.

**1. A full run costs ~400 MB of cellular data, not "tens of MB".**
Measured 2026-07-29 on the Smart Communications test SIM: `download.bytes` 269,932,312 + `upload.bytes` 128,185,297 = **398 MB** for one default run (15.0s each direction at ~177 Mbps down / ~70 Mbps up). A *truncated* run killed at t=11s (through ping + ~7s of download) still consumed **136 MB** on `rmnet_data0`. Ookla auto-scales to the link, so a fast LTE carrier makes this far more expensive than intuition suggests.
**Why:** the test is duration-bounded, not volume-bounded — faster link means proportionally more data.
**How to apply:** state the real number before running one, and treat even a "quick partial capture" as ~100 MB+. Measure the true cost from `/proc/net/dev` deltas on `rmnet_data0`, not from an estimate.

**2. `speedtest_status.sh` DELETES `/tmp/qmanager_speedtest_output` on harvest.**
On the first poll after the process dies it writes the result line to `qmanager_speedtest_result.json` and then `rm -f "$OUTPUT_FILE"`. The mid-run NDJSON progress lines are therefore **unrecoverable once the test completes** — you cannot go back for them.
**Why:** the progress file grows large and the harvest path cleans it up.
**How to apply:** if you need progress-line shapes, `cp /tmp/qmanager_speedtest_output` to a side file *while the test is still running*, before any status poll harvests it. Otherwise you will pay another full run.

**3. Ookla can never persist its config on this device — the license banner re-runs every single invocation.**
`/root` does not exist. `www-data`'s passwd home is `/var/www`, which also does not exist. `find / -xdev -name '*ookla*'` returns nothing before or after runs. Under lighttpd CGI, `HOME` is not in the server's environ at all, so `speedtest_servers.sh`'s `HOME="${HOME:-/root}"` resolves to a nonexistent dir either way. Live stderr proves it:
`"Failed to save settings: boost::filesystem::create_directories: Permission denied [system:13]: \"/var/www/.config/ookla\", \"/var/www\""`
**Why:** the RM520N-GL rootfs has no home directories for these accounts.
**How to apply:** `--accept-license --accept-gdpr` are load-bearing on *every* call, not just the first. Don't "optimize away" the bootstrap. It costs nothing measurable — server-list refresh is ~1.2s wall clock, cold or warm.

**4. Restoring a `/tmp/qmanager_speedtest_*` file as root breaks the feature.**
`/tmp` is sticky (1777) and the files are normally `www-data:www-data`. If you `cp` a backup back as root, the file becomes root-owned and `www-data` can then neither overwrite it (0644) nor unlink it (sticky bit) — `speedtest_start.sh`'s `rm -f "$RESULT_FILE"` silently fails and the cache is frozen forever.
**How to apply:** always `chown www-data:www-data` after restoring any `/tmp/qmanager_*` file you touched, and verify with `sudo -u www-data cp <file> /tmp/_t && echo OK`. Same failure family as [[root_poller_tmp_flags_unwritable_by_cgi]].
