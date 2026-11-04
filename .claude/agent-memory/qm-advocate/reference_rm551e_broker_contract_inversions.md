---
name: rm551e-broker-contract-inversions
description: RM551E qmanager_atd assumes contracts RM520N inverts - modem ERROR is rc 0 on stdout there, rc 1 + stderr here; root-only peers; O_CREAT on /tmp files www-data owns
metadata:
  type: reference
---

Found 2026-10-26 attacking the atd/poller port roadmap. RM551E broker `client/qcmd.rs` emit(): a modem `ERROR` is `Reply::Ok(raw)` -> stdout, rc 0 (at-broker.md "AT+FOOBAR -> ERROR rc 0"). RM520N shell `qcmd:174-179` returns rc 1, empty stdout, stderr `ERROR: command_failed`, and the b4d87ef sweep made callers rely on that.

Also: broker `LockFile::open` and `write_nofollow` use O_CREAT; RM520N `qmanager_setup:75-77` seeds `/tmp/qmanager_at.lock` www-data-owned, so protected_regular refuses ROOT. Broker peer policy is uid 0 only, and the frozen-broker restart marker lives in root-0755 `/var/run`.

**Why:** the roadmap's parity gate listed only the echo framing and missed all of these.
**How to apply:** when a plan ports RM551E native code, diff the error contract, file-open flags vs /tmp ownership, and peer uid against RM520N before accepting "selective merge".
