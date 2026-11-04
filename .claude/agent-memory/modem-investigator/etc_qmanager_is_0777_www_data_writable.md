---
name: etc-qmanager-is-0777-www-data-writable
description: /etc/qmanager is www-data-OWNED (0755 as of 2026-09-07, not 0777) — CGI persists JSON configs directly, no root helper/sudoers needed; the write blocker is /tmp only
metadata:
  type: reference
---

Live probe 2026-09-07 (RM520N-GL): `stat -c '%a %U:%G' /etc/qmanager` → **`755 www-data:www-data`**, non-sticky. The earlier 2026-07-27 reading of `drwxrwxrwx` (0777) is STALE — the mode tightened, but the load-bearing fact is unchanged and is OWNERSHIP, not mode: www-data owns the directory, so it holds w+x on it and can unlink/replace **any** file inside regardless of that file's own mode (`auth.json` is 0600 www-data:www-data and is still replaceable by www-data). 0755 additionally means no *other* unprivileged uid can write there.

Also 2026-09-07: nearly every file inside (`ping_profile.json`, `alert_routing.json`, `sms_forwarding.json`, `known_iccids`, `qmanager.conf`, …) is `-rw-r--r-- www-data www-data`. Only poller/root-written files (`last_boot_id`, `reboot_history.json`) are root-owned.

**Why:** repeatedly assumed the "www-data can't write config" limitation is general. It is not — it applies **only** to root-created `/tmp/qmanager_*` flag files (644 root:root, see [[root_poller_tmp_flags_unwritable_by_cgi]]). Persistent config under `/etc/qmanager/` is fully www-data-writable via the ordinary `config.sh` jq→tmp→mv pattern.

**How to apply:** when a feature needs UI-settable persistent state, propose a plain `/etc/qmanager/<feature>.json` written directly by the CGI. Do NOT propose a new `qmanager_*_apply` root helper + sudoers line for that alone — sudoers helpers on this device exist for systemctl/iptables/reboot/binary-privileged actions, not for config file writes. `/etc/sudoers.d/` does not exist; the rules live in a single sudoers file (inspect with `sudo -l -U www-data`).

Caveat: root-owned files already sitting in `/etc/qmanager/` (e.g. `last_boot_id`) still can't be overwritten by www-data — check ownership of the specific file, not just the directory.
