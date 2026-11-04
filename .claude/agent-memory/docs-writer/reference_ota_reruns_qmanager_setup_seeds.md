---
name: reference-ota-reruns-qmanager-setup-seeds
description: An OTA (install --no-reboot) DOES re-run qmanager_setup, so new /tmp seeds land without a reboot; a builder note claiming otherwise was wrong
metadata:
  type: reference
---

A `/tmp` seed added to `qmanager_setup` lands on an OTA too, not only after a boot. `qmanager_update` runs `install_rm520n.sh --force --skip-packages --no-reboot`; `--no-reboot` does not set `DO_START=0`, so `start_services()` runs `systemctl restart qmanager-setup`, whose `chown root:root` / `chmod 666` re-owns an existing first-writer file in place.

**Why:** the 2026-10-12 alerts run's builder note (in the run ledger) said "OTA --no-reboot keeps first-writer ownership"; the conductor's ticket repeated it. The source says the opposite. See [[reference-commit-is-archive-doc-is-forward-looking]].

**How to apply:** when a ticket or ledger states install/boot/OTA behaviour, trace `main()` flags in `install_rm520n.sh` (`DO_START`, `DO_REBOOT`) before writing it; only `--no-start` skips the setup restart.
