# QManager Firewall — Migration to Dedicated `QMANAGER_FW` Chain

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `qmanager_firewall` from direct-`INPUT` rule manipulation to a dedicated `QMANAGER_FW` user chain. Drain orphan rules from prior versions on the live device atomically and prevent recurrence.

**Architecture:** Replace per-rule `iptables -C ... || -A INPUT ...` (which works in steady-state but accumulates orphan rules across version drift) with a single user chain `QMANAGER_FW` that QManager owns end-to-end. Start = `iptables -N + -F + -A` populate + one `-I INPUT 1 -j QMANAGER_FW` hook. Stop = unhook + flush + delete chain. Both `start` and `stop` also drain pre-chain `INPUT`-direct rules so devices upgrading from the old layout converge to a clean state. The systemd unit interface (`start` / `stop`) is preserved — no callers change.

**Tech Stack:** POSIX `/bin/sh` (BusyBox ash on-device), `iptables` 1.8.4 legacy backend, systemd 244 oneshot service.

**Probe-confirmed environment** (RM520N-GL, 2026-05-09):
- Script runs as root from systemd; idempotent across calls
- Live `INPUT` chain currently has orphan `DROP -i rmnet_data0 -p tcp --dport {80,443}` rules from a prior implementation that the current `do_stop` cannot remove (its `-D` patterns are interface-less)
- Tailscale's `ts-input` jump occupies `INPUT` line 1 — must NOT be disturbed; we hook *after* it conceptually but use `-I INPUT 1` to re-insert at top so cellular-side traffic hits our DROP before falling through

---

## File Map

### Modified Files

| File | Lines | Change |
|------|-------|--------|
| `scripts/usr/bin/qmanager_firewall` | full rewrite (~100 lines) | Migrate to `QMANAGER_FW` user chain; add `cleanup_legacy_input_rules()`; preserve `start\|stop\|restart` CLI |
| `scripts/uninstall_rm520n.sh` | 389-401 | Replace iptables-D loops with chain teardown (unhook + flush + delete + legacy drain) |
| `docs/BACKEND.md` | §14 Common Pitfalls | Replace the "iptables orphan-rule risk" entry with a simpler note pointing to `QMANAGER_FW` as the canonical pattern |
| `docs/rm520n-gl-architecture.md` | "Known Discrepancies" subsection in Platform Tooling Inventory | Same — soften from "orphan-rule risk" to "fixed in <version>" |

### New Files

| File | Responsibility |
|------|---------------|
| `scripts/test/qmanager-firewall-chain.sh` | Functional harness: source the script in a sandbox using a fake `iptables` and assert chain operations are idempotent across multiple `start` cycles |

### Untouched (verified)

- `scripts/etc/systemd/system/qmanager-firewall.service` — service interface preserved (`ExecStart=qmanager_firewall start`, `ExecStop=qmanager_firewall stop`)
- `scripts/install_rm520n.sh:1191,1223` — already invokes the service by name; no edits
- `scripts/etc/sudoers.d/qmanager` — not affected (script runs from systemd, not www-data CGI)
- TTL implementation (`scripts/usr/lib/qmanager/ttl_state.sh`, `scripts/etc/systemd/system/qmanager-ttl.service`) — already idempotent and probe-confirmed working; **no changes**

---

## Task 1: Add functional test harness with a fake `iptables`

The harness exercises the chain logic without touching real iptables. It works by injecting a `iptables` shim on PATH that records its arguments to a tempfile and replies plausibly to `-C` / `-N` / `-D` so the script's control flow can be observed.

**Files:**
- Create: `scripts/test/qmanager-firewall-chain.sh`

- [ ] **Step 1: Write the failing test harness**

```sh
#!/usr/bin/env bash
# Functional test for qmanager_firewall chain-based implementation.
# Uses a fake `iptables` on PATH to record invocations and simulate a
# stateful rule set. Asserts:
#   - First `start` creates the chain, populates it, hooks INPUT
#   - Second `start` does NOT stack rules (chain flushed before re-populate)
#   - `stop` unhooks, flushes, and deletes the chain
#   - `cleanup_legacy_input_rules` drains pre-chain INPUT rules
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/usr/bin/qmanager_firewall"
[ -x "$SCRIPT" ] || { echo "FAIL: $SCRIPT not executable" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Fake iptables: tracks rules in $WORK/state.txt. One rule per line.
# Each line is the literal argv after dropping `-w <n>` if present.
# Supports: -N (add chain), -X (delete chain), -F (flush), -A, -D, -I, -C, -L
cat >"$WORK/iptables" <<'FAKE'
#!/usr/bin/env bash
STATE="$IPTABLES_STATE"
LOG="$IPTABLES_LOG"
# Drop -w <secs> if present
args=()
skip=0
for a in "$@"; do
    if [ $skip -eq 1 ]; then skip=0; continue; fi
    if [ "$a" = "-w" ]; then skip=1; continue; fi
    args+=("$a")
done
echo "iptables ${args[*]}" >> "$LOG"
case "${args[0]}" in
    -N)  # -N CHAIN
        chain="${args[1]}"
        grep -q "^CHAIN $chain$" "$STATE" 2>/dev/null && exit 1
        echo "CHAIN $chain" >> "$STATE" ;;
    -X)  # -X CHAIN
        chain="${args[1]}"
        sed -i "/^CHAIN $chain$/d; /^RULE $chain /d" "$STATE" ;;
    -F)  # -F CHAIN
        chain="${args[1]}"
        sed -i "/^RULE $chain /d" "$STATE" ;;
    -A)  # -A CHAIN ...rule...
        chain="${args[1]}"
        rest="${args[*]:2}"
        echo "RULE $chain $rest" >> "$STATE" ;;
    -I)  # -I CHAIN [pos] ...rule...
        chain="${args[1]}"
        rest="${args[*]:2}"
        echo "RULE $chain $rest" >> "$STATE" ;;
    -D)  # -D CHAIN ...rule...
        chain="${args[1]}"
        rest="${args[*]:2}"
        line="RULE $chain $rest"
        grep -qF "$line" "$STATE" || exit 1
        # Remove first match only (mirrors real iptables -D semantics)
        awk -v t="$line" 'BEGIN{d=0} (!d && $0==t){d=1; next} {print}' \
            "$STATE" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE" ;;
    -C)  # -C CHAIN ...rule...
        chain="${args[1]}"
        rest="${args[*]:2}"
        grep -qF "RULE $chain $rest" "$STATE" || exit 1 ;;
    -t)  # -t TABLE -X|-N|-F ...
        # We only model the filter table; for any other table just exit 0
        if [ "${args[1]}" != "filter" ]; then exit 0; fi
        # Drop -t filter and recurse
        exec "$0" "${args[@]:2}" ;;
    *) exit 0 ;;
esac
FAKE
chmod +x "$WORK/iptables"

export IPTABLES_STATE="$WORK/state.txt"
export IPTABLES_LOG="$WORK/log.txt"
: > "$IPTABLES_STATE"
: > "$IPTABLES_LOG"

PATH="$WORK:$PATH"
export PATH

# --- Test 1: First start creates and populates chain ---
"$SCRIPT" start
grep -q '^CHAIN QMANAGER_FW$' "$IPTABLES_STATE" || { echo "FAIL: chain not created"; exit 1; }
rule_count1=$(grep -c '^RULE QMANAGER_FW ' "$IPTABLES_STATE" || true)
[ "$rule_count1" -gt 0 ] || { echo "FAIL: no rules in chain"; exit 1; }
grep -q '^RULE INPUT -j QMANAGER_FW$' "$IPTABLES_STATE" \
    || { echo "FAIL: INPUT not hooked"; exit 1; }

# --- Test 2: Second start does NOT stack rules (idempotent) ---
"$SCRIPT" start
rule_count2=$(grep -c '^RULE QMANAGER_FW ' "$IPTABLES_STATE" || true)
[ "$rule_count1" = "$rule_count2" ] \
    || { echo "FAIL: rule count drifted ($rule_count1 -> $rule_count2)"; exit 1; }
hook_count=$(grep -c '^RULE INPUT -j QMANAGER_FW$' "$IPTABLES_STATE" || true)
[ "$hook_count" = "1" ] \
    || { echo "FAIL: hook count is $hook_count, expected 1"; exit 1; }

# --- Test 3: stop unhooks and removes chain ---
"$SCRIPT" stop
grep -q '^CHAIN QMANAGER_FW$' "$IPTABLES_STATE" \
    && { echo "FAIL: chain not deleted by stop"; exit 1; }
grep -q '^RULE INPUT -j QMANAGER_FW$' "$IPTABLES_STATE" \
    && { echo "FAIL: hook not removed by stop"; exit 1; }

# --- Test 4: cleanup_legacy drains pre-chain INPUT-direct rules ---
# Simulate orphan rules from old implementation
echo "RULE INPUT -i rmnet_data0 -p tcp --dport 443 -j DROP" >> "$IPTABLES_STATE"
echo "RULE INPUT -i rmnet_data0 -p tcp --dport 80 -j DROP" >> "$IPTABLES_STATE"
echo "RULE INPUT -p tcp --dport 80 -j DROP" >> "$IPTABLES_STATE"
echo "RULE INPUT -i bridge0 -p tcp --dport 80 -j ACCEPT" >> "$IPTABLES_STATE"
"$SCRIPT" start
# After start, all legacy INPUT rules should be drained
remaining_orphans=$(grep -E '^RULE INPUT -(i [^ ]+ )?-p tcp --dport (80|443) -j (ACCEPT|DROP)$' "$IPTABLES_STATE" | wc -l)
[ "$remaining_orphans" = "0" ] \
    || { echo "FAIL: $remaining_orphans legacy orphan rules remain"; cat "$IPTABLES_STATE"; exit 1; }

echo "PASS"
```

- [ ] **Step 2: Run test to verify it fails (script still has old impl)**

```bash
bash scripts/test/qmanager-firewall-chain.sh
```

Expected: FAIL on Test 1 (`chain not created`) — current script doesn't use a chain.

- [ ] **Step 3: Commit the failing test**

```bash
git add scripts/test/qmanager-firewall-chain.sh
git commit -m "test(firewall): add chain-migration harness (fails against current impl)"
```

---

## Task 2: Rewrite `qmanager_firewall` to use the `QMANAGER_FW` chain

Replace the body of the script. Preserve the `#!/bin/sh` shebang, `PORTS`, `TRUSTED`, dynamic Tailscale detection, and `start|stop|restart` CLI exactly so the systemd unit and any external callers still work.

**Files:**
- Modify: `scripts/usr/bin/qmanager_firewall` (full body, lines 1–67)

- [ ] **Step 1: Replace the script body with the chain-based implementation**

```sh
#!/bin/sh
# qmanager_firewall — Port firewall for QManager web UI (chain-based)
#
# Restricts HTTP/HTTPS access to trusted interfaces only. All rules live in
# a dedicated user chain (QMANAGER_FW) hooked into INPUT, so start/stop is
# atomic and cannot leak rules across upgrades. Replaces SimpleAdmin's
# simplefirewall as a QManager-managed service.
#
# Usage: qmanager_firewall {start|stop|restart}
#
# Protected ports: 80 (HTTP), 443 (HTTPS)
# Trusted interfaces: lo, bridge0, eth0, tailscale0 (if installed)
# SSH (22) is intentionally NOT blocked — emergency access must remain open.
#
# Service: qmanager-firewall.service (Type=oneshot, RemainAfterExit=yes)

PORTS="80 443"
TRUSTED="lo bridge0 eth0"

if [ -x /usrdata/tailscale/tailscale ]; then
    TRUSTED="$TRUSTED tailscale0"
fi

CHAIN="QMANAGER_FW"

ensure_chain() {
    iptables -t filter -N "$CHAIN" 2>/dev/null || true
}

unhook_chain() {
    # Remove every existing INPUT->CHAIN jump (handles past duplicate hooks)
    while iptables -C INPUT -j "$CHAIN" 2>/dev/null; do
        iptables -D INPUT -j "$CHAIN" 2>/dev/null || break
    done
}

drop_chain() {
    iptables -F "$CHAIN" 2>/dev/null || true
    iptables -X "$CHAIN" 2>/dev/null || true
}

# Drain INPUT-direct rules from the pre-chain implementation.
# Loops per rule because -D removes only one match per call.
cleanup_legacy_input_rules() {
    iface=""
    port=""
    for iface in lo bridge0 eth0 tailscale0 rmnet_data0; do
        for port in $PORTS; do
            while iptables -C INPUT -i "$iface" -p tcp --dport "$port" -j ACCEPT 2>/dev/null; do
                iptables -D INPUT -i "$iface" -p tcp --dport "$port" -j ACCEPT 2>/dev/null || break
            done
            while iptables -C INPUT -i "$iface" -p tcp --dport "$port" -j DROP 2>/dev/null; do
                iptables -D INPUT -i "$iface" -p tcp --dport "$port" -j DROP 2>/dev/null || break
            done
        done
    done
    for port in $PORTS; do
        while iptables -C INPUT -p tcp --dport "$port" -j DROP 2>/dev/null; do
            iptables -D INPUT -p tcp --dport "$port" -j DROP 2>/dev/null || break
        done
    done
}

do_start() {
    cleanup_legacy_input_rules
    ensure_chain
    iptables -F "$CHAIN" 2>/dev/null || true
    for iface in $TRUSTED; do
        for port in $PORTS; do
            iptables -A "$CHAIN" -i "$iface" -p tcp --dport "$port" -j ACCEPT
        done
    done
    for port in $PORTS; do
        iptables -A "$CHAIN" -p tcp --dport "$port" -j DROP
    done
    unhook_chain
    iptables -I INPUT 1 -j "$CHAIN"
}

do_stop() {
    unhook_chain
    drop_chain
    cleanup_legacy_input_rules
}

case "${1:-}" in
    start)   do_start ;;
    stop)    do_stop ;;
    restart) do_stop; do_start ;;
    *)
        echo "Usage: qmanager_firewall {start|stop|restart}" >&2
        exit 1
        ;;
esac
```

- [ ] **Step 2: Verify shell syntax**

```bash
sh -n scripts/usr/bin/qmanager_firewall
```

Expected: no output (clean parse).

- [ ] **Step 3: Run the harness — Test 1, 2, 3 should now pass**

```bash
bash scripts/test/qmanager-firewall-chain.sh
```

Expected: `PASS`

- [ ] **Step 4: Run the broader pre-build gate to confirm no regressions**

```bash
bash scripts/test/run-all.sh
```

Expected: passes the bash -n syntax stage and CRLF stage. (Do not require harness pass at this gate; run-harnesses runs separately.)

- [ ] **Step 5: Commit**

```bash
git add scripts/usr/bin/qmanager_firewall
git commit -m "refactor(firewall): migrate qmanager_firewall to QMANAGER_FW user chain

- All rules now live in a dedicated user chain (QMANAGER_FW) instead of
  appended directly to INPUT. start = create+flush+populate+hook (atomic);
  stop = unhook+flush+delete. Eliminates the orphan-rule drift observed
  on RM520N-GL (DROP -i rmnet_data0 entries left by a prior version).
- Adds cleanup_legacy_input_rules() that drains pre-chain INPUT-direct
  rules so devices upgrading from older versions converge to a clean
  state on the next start/stop.
- CLI (start|stop|restart) and systemd unit interface are unchanged."
```

---

## Task 3: Update `uninstall_rm520n.sh` Step 9 to use the chain teardown

The uninstaller currently has a manual fallback that mirrors the *old* `do_stop` (per-iface `-D INPUT`). With the chain-based implementation, the service's own `ExecStop` already does the right thing, but the fallback path needs to be updated to drop the chain too in case the service is gone before uninstall runs.

**Files:**
- Modify: `scripts/uninstall_rm520n.sh:386-401`

- [ ] **Step 1: Replace the manual fallback block**

Find lines 386-401 (the `step "Cleaning up firewall rules"` block). Replace the body **after** the `step` line with:

```sh
# Legacy TTL/MTU helper files that may persist independently of the service
rm -f /etc/firewall.user.ttl /etc/firewall.user.mtu 2>/dev/null || true

# The qmanager-firewall service (stopped in Step 1) runs ExecStop to flush
# its rules. The fallbacks below cover the case where the service was
# already gone before uninstall started — both the new chain-based layout
# and any pre-chain INPUT-direct rules from older installs are cleaned.
if command -v iptables >/dev/null 2>&1; then
    # New layout: tear down the QMANAGER_FW chain
    while iptables -C INPUT -j QMANAGER_FW 2>/dev/null; do
        iptables -D INPUT -j QMANAGER_FW 2>/dev/null || break
    done
    iptables -F QMANAGER_FW 2>/dev/null || true
    iptables -X QMANAGER_FW 2>/dev/null || true

    # Legacy layout: drain INPUT-direct rules from pre-chain installs
    for port in 80 443; do
        while iptables -C INPUT -p tcp --dport "$port" -j DROP 2>/dev/null; do
            iptables -D INPUT -p tcp --dport "$port" -j DROP 2>/dev/null || break
        done
        for iface in lo bridge0 eth0 tailscale0 rmnet_data0; do
            while iptables -C INPUT -i "$iface" -p tcp --dport "$port" -j ACCEPT 2>/dev/null; do
                iptables -D INPUT -i "$iface" -p tcp --dport "$port" -j ACCEPT 2>/dev/null || break
            done
            while iptables -C INPUT -i "$iface" -p tcp --dport "$port" -j DROP 2>/dev/null; do
                iptables -D INPUT -i "$iface" -p tcp --dport "$port" -j DROP 2>/dev/null || break
            done
        done
    done
fi

info "Firewall rules cleared"
```

- [ ] **Step 2: Verify shell syntax**

```bash
bash -n scripts/uninstall_rm520n.sh
```

Expected: clean parse.

- [ ] **Step 3: Run the pre-build gate**

```bash
bash scripts/test/run-all.sh
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add scripts/uninstall_rm520n.sh
git commit -m "refactor(uninstall): tear down QMANAGER_FW chain + drain legacy INPUT rules

Step 9 fallback now handles both the new chain-based layout (unhook +
flush + delete chain) and pre-chain legacy rules (per-iface -D INPUT
loops with -C guards). Idempotent and safe to run on devices in any
state — fresh, upgraded, or partially uninstalled."
```

---

## Task 4: Update docs to reflect the chain-based layout

The recent edits to `BACKEND.md` and `rm520n-gl-architecture.md` flag orphan-rule risk and recommend the chain pattern. Now that the patch is in, soften those entries to "fixed in this version — here is the canonical layout" so future maintainers don't think there's still a live bug.

**Files:**
- Modify: `docs/BACKEND.md` (in §14 Common Pitfalls)
- Modify: `docs/rm520n-gl-architecture.md` (in "Known Discrepancies" subsection)

- [ ] **Step 1: Replace the BACKEND.md entry**

In `docs/BACKEND.md`, find the entry beginning `**iptables orphan-rule risk in INPUT chain.**` and replace its full text with:

```markdown
**`iptables` rules live in a dedicated `QMANAGER_FW` user chain.** All web-UI port-firewall rules (ports 80/443 ACCEPT on trusted interfaces, DROP on others) live in the user chain `QMANAGER_FW` hooked from `INPUT`. `qmanager_firewall start` creates the chain (`-N`), flushes it (`-F`), populates the rules (`-A`), and hooks `INPUT` exactly once (`-I INPUT 1 -j QMANAGER_FW`). `qmanager_firewall stop` unhooks, flushes, and deletes the chain. This replaces an earlier direct-`INPUT` layout that left orphan rules across version drift (e.g. `DROP -i rmnet_data0 -p tcp --dport 80` rules from a prior trusted-interface set). Both `start` and `stop` also call `cleanup_legacy_input_rules()` to drain such orphans on devices upgrading from the old layout. Inspect with `iptables -L QMANAGER_FW -n -v` — single source of truth.
```

- [ ] **Step 2: Replace the architecture doc entry**

In `docs/rm520n-gl-architecture.md`, find the bullet beginning `- **`qmanager-firewall.service` orphan-rule risk**` and replace it with:

```markdown
- **`qmanager-firewall.service` uses a dedicated `QMANAGER_FW` user chain** (since 2026-05). Probe-validated layout: `iptables -L QMANAGER_FW -n -v` is the single source of truth; `INPUT` carries one `-j QMANAGER_FW` jump and nothing else QManager-owned. The script also drains pre-chain orphan rules (e.g. legacy `DROP -i rmnet_data0`) on every `start`/`stop` so upgrades self-heal. See `docs/BACKEND.md` §14 for the full pattern.
```

- [ ] **Step 3: Verify both docs still build / are well-formed**

```bash
grep -n '^## ' docs/BACKEND.md | head -20
grep -n '^## ' docs/rm520n-gl-architecture.md | head -20
```

Expected: section structure unchanged from before (no missing headings, no duplicates).

- [ ] **Step 4: Commit**

```bash
git add docs/BACKEND.md docs/rm520n-gl-architecture.md
git commit -m "docs(firewall): reflect QMANAGER_FW chain migration

Soften the orphan-rule risk notes in BACKEND.md §14 and the
rm520n-gl-architecture.md Known Discrepancies section now that the
chain-based implementation is in. Document inspection command and
upgrade-self-heal behaviour."
```

---

## Task 5: End-to-end verification on the dev device

This is a manual deployment + re-probe step. The earlier probe (`D:\tmp\probe_iptables.py`) is reusable.

**Files:**
- None — verification only

- [ ] **Step 1: Build and stage the install tarball**

```bash
bun run package
```

Expected: tarball produced under `dist/` (or wherever the repo's package script writes — check output).

- [ ] **Step 2: Deploy to the dev device**

The repo's standard install path is via SCP + `install_rm520n.sh`. The user should drive this manually (do not push from the agent):

> *Manual step:* SCP the tarball to `/usrdata/` on the device, untar, run `install_rm520n.sh`. Confirm the upgrade completes and `systemctl status qmanager-firewall.service` reports `active (exited)`.

- [ ] **Step 3: Re-probe live iptables state**

Run from the repo root with `.env` loaded:

```bash
python D:/tmp/probe_iptables.py
```

Expected:
- `iptables -L INPUT -n -v --line-numbers` shows **exactly one** `QMANAGER_FW` jump (after `ts-input`) and **no** direct ACCEPT/DROP rules for ports 80/443 in `INPUT`
- `iptables -L QMANAGER_FW -n -v --line-numbers` shows 4 ACCEPT rules (lo/bridge0/eth0/tailscale0 × ports 80/443 — 8 lines total) followed by 2 trailing DROP rules (ports 80/443 with no `-i`)
- The legacy orphan `DROP -i rmnet_data0 -p tcp --dport {80,443}` lines are **gone**

- [ ] **Step 4: Restart the service to confirm idempotency on real hardware**

> *Manual step on device:*
> ```sh
> systemctl restart qmanager-firewall
> iptables -L QMANAGER_FW -n -v --line-numbers
> ```
> Rule count must be identical to the post-deploy probe.

- [ ] **Step 5: Confirm web UI still reachable from LAN**

> *Manual step:* Open the web UI on `https://192.168.225.1` from a LAN client. Should load normally.

- [ ] **Step 6: Confirm web UI is blocked from cellular**

> *Manual step:* If reachable, curl the device's WAN IP on port 443 from outside the cellular NAT. Connection should hang/timeout (DROP). If not externally reachable, this step is informational.

---

## Self-Review Checklist (run before handoff)

- [x] Spec coverage: every change listed in the analysis (chain migration, legacy drain, uninstall fallback, doc soften) has a task.
- [x] No placeholders — every step has the actual code or command.
- [x] Type/identifier consistency — `QMANAGER_FW`, `cleanup_legacy_input_rules`, `ensure_chain`, `unhook_chain`, `drop_chain` referenced consistently across Tasks 1–4.
- [x] No changes to TTL — verified the live probe shows TTL/HL rules already correct and idempotent (`ttl_state.sh` drain loop).
- [x] Systemd unit is untouched — `start`/`stop` interface preserved.
- [x] Test harness asserts the four behaviours that matter (chain creation, idempotency, full teardown, legacy drain) — Task 1.
- [x] Risk-bounded: every iptables-touching loop has a `-C` guard before `-D` and `|| break` so bad fake/real states don't loop forever.
