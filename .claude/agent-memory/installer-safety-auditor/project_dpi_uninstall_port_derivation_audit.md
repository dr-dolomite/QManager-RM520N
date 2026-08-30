---
name: dpi_uninstall_port_derivation_audit
description: Phase 5 CLEAR verdict on qmanager_dpi_install's hardcoded-989 -> $DPI_PORT fix, plus two pre-existing non-blocking DPI teardown gaps surfaced along the way
type: project
---

Audited 2026-08-30: `scripts/usr/bin/qmanager_dpi_install`'s `_dpi_uninstall_run` (lines ~109-128) changed its two inlined `iptables -t nat -D ... --to-ports 989` teardown lines to `--to-ports "$DPI_PORT"`. This is the F16 follow-up (commit e0374dc fixed `DPI_RULE_SIG` in `dpi_state.sh` the same way; this closes the second site the `busybox-portability-checker` flagged as out-of-scope at the time). Verdict: **CLEAR** — no installer/uninstaller/sudoers/systemd/OTA file touched, test harness `scripts/test/dpi-rule-signature-port.sh` section [3] pins both drain lines and passes (7/7).

Key reasoning, reusable for future DPI/teardown audits:
- **Do NOT recommend swapping the hand-written `iptables -D` for `dpi_remove_rule()`.** `dpi_remove_rule` (`dpi_state.sh`) only drains **PREROUTING**. `_dpi_uninstall_run` also drains an **OUTPUT** chain rule (`-D OUTPUT -p tcp --dport 443 -j REDIRECT --to-ports $DPI_PORT`) that `dpi_state.sh` does not know about at all — nothing in the codebase ever *creates* that OUTPUT rule via `-A`/`-I` (grepped clean); it predates any explanation in git history (introduced in `71db6b9` with no rationale beyond "modem-originated"). A naive swap to the library helper would silently stop draining it.
- **Fail-safe direction is not worse.** `DPI_PORT` is a fixed literal (`"989"` in `dpi_state.sh:60`), never user input, so there's no injection surface. If a future refactor ever left it unset/empty at the call site, `--to-ports ""` fails iptables' target-arg parse (rejected before any rule match is attempted) — the `-D` no-ops, same "LAN outage, not a leak" class the docs already document for port drift (`docs/reference/dpi.md` teardown section). The old hardcoded-989 form isn't more failure-resistant here since the function already depends on `dpi_state.sh` for `$DPI_BINARY`/`dpi_binary_installed` in the same function body — the coupling isn't new.
- **Two pre-existing, non-blocking gaps surfaced (not caused by this diff, not fixed by it):**
  1. `docs/reference/dpi.md:57` is now stale — it says `DPI_RULE_SIG` is "the literal string `--to-ports 989`, not interpolated from `$DPI_PORT`", which commit e0374dc made false. Needs a docs follow-up.
  2. `scripts/uninstall_rm520n.sh` Step 1 calls `qmanager_dpi_run --clear` → `dpi_remove_rule()`, which **never drains the OUTPUT rule** `_dpi_uninstall_run` drains. So a full device uninstall (not the UI "Remove engine" button) while Traffic Engine mode was ever active could strand that OUTPUT redirect. Worth a spawn_task if someone touches uninstall_rm520n.sh's DPI step again.
- `docs/reference/dpi.md`'s "never hand-write an iptables -D in a caller" rule is now a **known, justified exception** for this one call site (OUTPUT chain) — the new code comment at `qmanager_dpi_install:97-106` documents why; the doc itself doesn't carve out the exception yet.

See also [[project_traffic_engine_dpi_audit]] for the earlier PR #11 DPI uninstaller audit (uninstaller not removing `$QMANAGER_ROOT/bin`).
