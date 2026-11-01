# S1 — central `+QMAP` guard + qmi flake (2026-11-02)

Board: `2026-10-26-atd-poller-port.md` (S1). Design: `2026-10-31-r6-proofs.md` > T-C. Branch `claude/s1-qmap-guard-ee4a56`.

## Understand

- Worktree base was 299 commits behind `development`; fast-forwarded to c2b39b37 (0 own commits, clean).
- Device read-only (both serials proven, b7e3d6f1 / 61368cd2): QCMAP runs as comm `QCMAP_Connectio` (pid 430 / 456).
  **The design's off-switch path `/usr/bin/QCMAP_ConnectionManagerd` does not exist on either device.** The unit runs
  `/usr/bin/QCMAP_ConnectionManager /etc/data/mobileap_cfg.xml d` (`Restart=no`), `/proc/<pid>/exe` agrees. Plan uses that path.
- Flake cause (`client/qmi.rs`, measured 299.93 ms vs a 300 ms floor): `SO_RCVTIMEO` can fire a fraction of a ms early;
  `ask_broker` treats that `WouldBlock` as final and returns before its own deadline. Fix the code, not the test.

## Plan (stop for OK)

1. `at/classify.rs`: `is_qmap(cmd)` — ASCII case-insensitive `+QMAP` anywhere (compounds included; also matches `+QMAPWAC`). Unit tests.
2. `at/qcmap.rs` (new): `Qcmap { proc_root, bin, cache }`; `running()` scans `<proc_root>/[0-9]*/comm` for `QCMAP_Connectio`,
   cached 2 s; `bin` absent → guard off (always "allowed"). `Qcmap::system()` = `&'static` for `/proc` + `/usr/bin/QCMAP_ConnectionManager`.
   WARN `QCMAP not running: refusing AT+QMAP` once per down transition, INFO on recovery, DEBUG per refusal.
3. `at/exec.rs`: `Executor` gains `qcmap: &'a Qcmap`; `run_after` checks after `is_at_command`, before the long gate and lock →
   `Outcome::Err(Code::ModemNotReady)`. Five construction sites pass `Qcmap::system()`. Test: injected fake proc root
   (no QCMAP comm) + lock held by another holder + panicking channel → modem_not_ready fast; with the comm present → reaches the lock.
4. `client/qmi.rs`: `WouldBlock`/`TimedOut` in the read loop re-checks the deadline instead of returning. Test unchanged.
5. Read-only diagnostic for the device proof: `qmanager_atd --qcmap` prints `qcmap=running|stopped|absent` (no AT, no lock).
6. Crate 0.7.4 → 0.7.5 (proto stays 3), `proto.rs` version assert, armv7 musl build (WSL, toolchain 1.99.0), refresh `dependencies/qmanager_atd`.
7. Docs: `docs/reference/at-command-transport.md` error-code section.

Validation: `cargo test` user + root; armv7 build; RG501Q-EU `/tmp` copy run `--qcmap` as root and as www-data (proves `/proc/*/comm`
is readable to the fallback; checks hidepid). No service restart, no broker replace, no AT sent. Blind `qm-verifier`.
Risk: a QCMAP restart window refuses QMAP for ≤2 s past recovery (cache). Rollback: revert the branch; wire code unchanged.

## Build + validate (plan approved by the user 2026-11-02)

- Commit 73398ad7: plan items 1–7 as written. Crate 0.7.5, proto 3.
- `cargo test`: 324 passed as user and as root (`wsl -u root`). Flaky test 10/10 after the fix.
- armv7 musl release (toolchain 1.99.0): md5 **d5b06114** = `dependencies/qmanager_atd`. Two build warnings predate this change (`fetch_update` deprecated, `Executor::run` unused in release).
- RG501Q-EU (b7e3d6f1), PM slot "read-only /tmp only": `/tmp` copy md5 d5b06114, `--version` = 0.7.5 proto=3,
  `--qcmap` = `qcmap=running` as root and as www-data (pid 430 comm matches), `/proc` mounted without hidepid. Files self-deleted. No AT sent, nothing restarted.
- Not proven on a device: the refusal itself (needs QCMAP stopped = disruptive) and the WARN/INFO log lines; covered by the exec.rs test with a fake proc root.
- Blind `qm-verifier` on 73398ad7: **PASS_WITH_NOTES** (all 6 criteria; 324 user + root; flake 20/20; fresh armv7 md5 = d5b06114).
  Notes, none fixed: (a) the in-process fallback logs the WARN once per process, not once per spell (poller's `qcmap_up` is in front);
  (b) the 2 s cache can still say Running for up to 2 s after QCMAP exits, so one QMAP may slip through in that window (design's cache, accepted);
  (c) unreadable comm reads Stopped = fail closed (device shows no hidepid, www-data reads it).
