---
name: boot-chown-defeats-ownership-pins-in-etc-qmanager
description: qmanager_setup's boot-time `chown -R www-data:www-data /etc/qmanager` silently undoes any install-time root:root pin inside that dir; prove it with ctime vs mtime
metadata:
  type: project
---

Any per-file ownership carve-out inside `/etc/qmanager` set by the installer survives only until the next reboot. `qmanager-setup.service` (oneshot, `Before=` the daemons) runs `/usr/bin/qmanager_setup`, whose `chown -R www-data:www-data /etc/qmanager` has **no exclusion list** — it flattens every entry back to `www-data:www-data`.

**Why:** the installer pins some files (historically `environment`) to `root:root` for security, but the pin is only re-applied on install/OTA, while the recursive chown runs on every boot. Verified live 2026-08-03: `/etc/qmanager/environment` was `www-data:www-data` despite an install-time `chown root:root`.

**How to apply:** when auditing ownership inside `/etc/qmanager`, never trust the installer source — probe the device. The decisive evidence is **ctime vs mtime**: content mtime frozen at an old date while ctime equals the last boot time means a metadata-only change, i.e. the recursive chown. Cross-check against `systemctl show qmanager-setup.service -p ExecMainExitTimestamp`. The corollary: files that are `root:root` in that directory (`last_boot_id`, `reboot_history.json`) got that way by being **recreated by a root daemon after** setup ran, not by any pin.

Related: [[root_poller_tmp_flags_unwritable_by_cgi]], [[etc_qmanager_is_0777_www_data_writable]]
