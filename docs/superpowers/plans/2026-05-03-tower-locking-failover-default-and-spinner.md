# Tower Locking: Failover Default-Off + Spinner Scope Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Signal Failover opt-in (off by default and not auto-enabled by locking) and confine the lock/unlock loading spinner to the lock toggle only — it currently also appears next to the Simple Mode toggle.

**Architecture:** Two surgical changes. (1) Backend: flip the `failover.enabled` default in `TOWER_DEFAULT_CONFIG` from `true` to `false`, and remove the two `tower_config_update '.failover.enabled = true'` lines that fire on every successful lock in `scripts/www/cgi-bin/quecmanager/tower/lock.sh`. The existing auto-disable-on-unlock logic (lines 188 and 300 of `lock.sh`) is preserved untouched. (2) Frontend: remove the `isLocking ? <Loader2 .../> : null` blocks from the Simple Mode rows in `lte-locking.tsx` and `nr-sa-locking.tsx`. The spinner next to each card's main lock toggle remains. The `use-tower-locking` hook needs no change — when `failover_armed` is `false` (the new norm), the optimistic-state branch is already skipped.

**Tech Stack:** POSIX shell (BusyBox-compatible) for the backend, React + TypeScript (Next.js) + shadcn/ui for the frontend, jq for JSON config mutation.

---

## File Structure

**Modify:**
- `scripts/usr/lib/qmanager/tower_lock_mgr.sh` — default config JSON literal
- `scripts/www/cgi-bin/quecmanager/tower/lock.sh` — drop auto-enable on lock (LTE + NR-SA branches)
- `components/cellular/tower-locking/lte-locking.tsx` — remove spinner from Simple Mode row
- `components/cellular/tower-locking/nr-sa-locking.tsx` — remove spinner from Simple Mode row

**No changes:**
- `hooks/use-tower-locking.ts` — `if (data.failover_armed)` block (lines 290–301) becomes a no-op when `failover_armed` is false; no edit needed.
- `tower-settings.tsx` — failover Switch is already gated by `!hasActiveLock`, so users still cannot enable failover until at least one tower lock exists. The new flow is: lock first → then explicitly toggle Signal Failover on.
- The auto-disable-failover-on-unlock logic in `lock.sh` (lines 178–191 LTE, 290–301 NR) is the desired behavior — leave it.

---

## Task 1: Flip default `failover.enabled` to `false`

**Files:**
- Modify: `scripts/usr/lib/qmanager/tower_lock_mgr.sh:46`

- [ ] **Step 1: Inspect current default**

Run: `grep -n TOWER_DEFAULT_CONFIG scripts/usr/lib/qmanager/tower_lock_mgr.sh`
Expected: line 46 contains `"failover":{"enabled":true,"threshold":20}`.

- [ ] **Step 2: Edit the literal**

Change in `scripts/usr/lib/qmanager/tower_lock_mgr.sh:46`:

```diff
-TOWER_DEFAULT_CONFIG='{"lte":{"enabled":false,"cells":[null,null,null]},"nr_sa":{"enabled":false,"pci":null,"arfcn":null,"scs":null,"band":null},"persist":false,"failover":{"enabled":true,"threshold":20},"schedule":{"enabled":false,"start_time":"08:00","end_time":"22:00","days":[1,2,3,4,5]}}'
+TOWER_DEFAULT_CONFIG='{"lte":{"enabled":false,"cells":[null,null,null]},"nr_sa":{"enabled":false,"pci":null,"arfcn":null,"scs":null,"band":null},"persist":false,"failover":{"enabled":false,"threshold":20},"schedule":{"enabled":false,"start_time":"08:00","end_time":"22:00","days":[1,2,3,4,5]}}'
```

Only `"enabled":true` → `"enabled":false` inside the `failover` object. Threshold and all other fields stay.

- [ ] **Step 3: Verify the edit**

Run: `grep -o 'failover":{[^}]*}' scripts/usr/lib/qmanager/tower_lock_mgr.sh`
Expected: `failover":{"enabled":false,"threshold":20}`

- [ ] **Step 4: Validate JSON is still well-formed**

Run (PowerShell or bash with jq installed):
```bash
grep "^TOWER_DEFAULT_CONFIG=" scripts/usr/lib/qmanager/tower_lock_mgr.sh | sed -E "s/^[^=]+='(.*)'$/\1/" | jq .
```
Expected: jq prints pretty-formatted JSON with `"failover": { "enabled": false, "threshold": 20 }` and exits 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/usr/lib/qmanager/tower_lock_mgr.sh
git commit -m "fix(tower): default Signal Failover to disabled on fresh install"
```

---

## Task 2: Stop auto-enabling failover on LTE lock

**Files:**
- Modify: `scripts/www/cgi-bin/quecmanager/tower/lock.sh:137-139`

- [ ] **Step 1: Locate the line**

Run: `grep -n "failover.enabled = true" scripts/www/cgi-bin/quecmanager/tower/lock.sh`
Expected: matches at lines 139 and 251.

- [ ] **Step 2: Remove the LTE auto-enable line**

In `scripts/www/cgi-bin/quecmanager/tower/lock.sh`, replace:

```sh
        # Update config file + auto-enable failover for this lock session
        tower_config_update_lte "true" "$c1_earfcn" "$c1_pci" "$c2_earfcn" "$c2_pci" "$c3_earfcn" "$c3_pci"
        tower_config_update '.failover.enabled = true'

        # Spawn failover watcher
        failover_armed=$(tower_spawn_failover_watcher)
```

with:

```sh
        # Update config file. Failover stays at whatever the user set in
        # Tower Settings — locking does not implicitly enable it.
        tower_config_update_lte "true" "$c1_earfcn" "$c1_pci" "$c2_earfcn" "$c2_pci" "$c3_earfcn" "$c3_pci"

        # Spawn failover watcher (no-op if failover.enabled is false)
        failover_armed=$(tower_spawn_failover_watcher)
```

`tower_spawn_failover_watcher` (in `tower_lock_mgr.sh:401-406`) already early-returns `false` when `failover.enabled != "true"`, so `failover_armed` will be `false` and the existing JSON response field stays correct.

- [ ] **Step 3: Verify the edit**

Run: `grep -n "failover.enabled = true" scripts/www/cgi-bin/quecmanager/tower/lock.sh`
Expected: now only one match (line in the NR-SA branch — handled by Task 3).

---

## Task 3: Stop auto-enabling failover on NR-SA lock

**Files:**
- Modify: `scripts/www/cgi-bin/quecmanager/tower/lock.sh:249-251`

- [ ] **Step 1: Remove the NR-SA auto-enable line**

In `scripts/www/cgi-bin/quecmanager/tower/lock.sh`, replace:

```sh
        # Update config + auto-enable failover for this lock session
        tower_config_update_nr "true" "$nr_pci" "$nr_arfcn" "$nr_scs" "$nr_band"
        tower_config_update '.failover.enabled = true'

        # Spawn failover watcher
        failover_armed=$(tower_spawn_failover_watcher)
```

with:

```sh
        # Update config. Failover stays at whatever the user set in
        # Tower Settings — locking does not implicitly enable it.
        tower_config_update_nr "true" "$nr_pci" "$nr_arfcn" "$nr_scs" "$nr_band"

        # Spawn failover watcher (no-op if failover.enabled is false)
        failover_armed=$(tower_spawn_failover_watcher)
```

- [ ] **Step 2: Verify both auto-enable lines are gone**

Run: `grep -n "failover.enabled = true" scripts/www/cgi-bin/quecmanager/tower/lock.sh`
Expected: no matches.

- [ ] **Step 3: Verify the auto-disable-on-unlock lines are still present**

Run: `grep -n "failover.enabled = false" scripts/www/cgi-bin/quecmanager/tower/lock.sh`
Expected: two matches (around lines 188 and 300), in the unlock branches.

- [ ] **Step 4: Shell-syntax check**

Run: `bash -n scripts/www/cgi-bin/quecmanager/tower/lock.sh`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/www/cgi-bin/quecmanager/tower/lock.sh
git commit -m "fix(tower): do not auto-enable Signal Failover on lock"
```

---

## Task 4: Remove spinner from LTE Simple Mode toggle row

**Files:**
- Modify: `components/cellular/tower-locking/lte-locking.tsx:365-368`

- [ ] **Step 1: Locate the duplicate spinner**

Run: `grep -n "isLocking ? (" components/cellular/tower-locking/lte-locking.tsx`
Expected: two matches — one inside the Simple Mode row (around line 366) and one inside the LTE Tower Locking row (around line 395). Only the first should be removed.

- [ ] **Step 2: Edit the Simple Mode block**

In `components/cellular/tower-locking/lte-locking.tsx`, locate the Simple Mode row (look for `id="lte-simple-mode"`). Replace:

```tsx
                <div className="flex items-center space-x-2">
                  {isLocking ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : null}
                  <Switch
                    id="lte-simple-mode"
                    aria-label="Toggle LTE Simple Mode"
                    checked={simpleMode && hasOptions}
                    onCheckedChange={handleSimpleModeToggle}
                    disabled={!hasOptions || isLocking}
                  />
                  <Label htmlFor="lte-simple-mode">
                    {simpleMode && hasOptions ? "On" : "Off"}
                  </Label>
                </div>
```

with:

```tsx
                <div className="flex items-center space-x-2">
                  <Switch
                    id="lte-simple-mode"
                    aria-label="Toggle LTE Simple Mode"
                    checked={simpleMode && hasOptions}
                    onCheckedChange={handleSimpleModeToggle}
                    disabled={!hasOptions || isLocking}
                  />
                  <Label htmlFor="lte-simple-mode">
                    {simpleMode && hasOptions ? "On" : "Off"}
                  </Label>
                </div>
```

The `disabled={!hasOptions || isLocking}` prop stays — Simple Mode is still locked from interaction during a lock op, it just doesn't get its own spinner. The spinner next to the main `lte-tower-locking` Switch (around line 395) is **kept untouched**.

- [ ] **Step 3: Verify only one spinner remains in the file**

Run: `grep -c "isLocking ? (" components/cellular/tower-locking/lte-locking.tsx`
Expected: `1`.

- [ ] **Step 4: Type-check**

Run: `bunx tsc --noEmit`
Expected: no errors. (`Loader2` is still imported and used by the remaining spinner — no unused-import warning expected.)

---

## Task 5: Remove spinner from NR-SA Simple Mode toggle row

**Files:**
- Modify: `components/cellular/tower-locking/nr-sa-locking.tsx:335-338`

- [ ] **Step 1: Edit the Simple Mode block**

In `components/cellular/tower-locking/nr-sa-locking.tsx`, locate the Simple Mode row (look for `id="nr-sa-simple-mode"`). Replace:

```tsx
                <div className="flex items-center space-x-2">
                  {isLocking ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : null}
                  <Switch
                    id="nr-sa-simple-mode"
                    aria-label="Toggle NR Simple Mode"
                    checked={simpleMode && hasOptions}
                    onCheckedChange={handleSimpleModeToggle}
                    disabled={!hasOptions || isDisabled}
                  />
                  <Label htmlFor="nr-sa-simple-mode">
                    {simpleMode && hasOptions ? "On" : "Off"}
                  </Label>
                </div>
```

with:

```tsx
                <div className="flex items-center space-x-2">
                  <Switch
                    id="nr-sa-simple-mode"
                    aria-label="Toggle NR Simple Mode"
                    checked={simpleMode && hasOptions}
                    onCheckedChange={handleSimpleModeToggle}
                    disabled={!hasOptions || isDisabled}
                  />
                  <Label htmlFor="nr-sa-simple-mode">
                    {simpleMode && hasOptions ? "On" : "Off"}
                  </Label>
                </div>
```

The spinner next to the main `nr-sa-tower-locking` Switch (around line 365) stays.

- [ ] **Step 2: Verify only one spinner remains in the file**

Run: `grep -c "isLocking ? (" components/cellular/tower-locking/nr-sa-locking.tsx`
Expected: `1`.

- [ ] **Step 3: Type-check the whole project**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/cellular/tower-locking/lte-locking.tsx components/cellular/tower-locking/nr-sa-locking.tsx
git commit -m "fix(tower): scope locking spinner to the main lock toggle only"
```

---

## Task 6: Manual smoke test on the device

The earlier static checks confirm syntax and types; this task verifies behavior end-to-end against a real RM520N-GL. Run after deploying the new tarball with `build.sh` + `install_rm520n.sh` against a unit that has **no existing** `/usrdata/qmanager/tower_lock_config.json` (or move the existing file aside first to simulate fresh install).

- [ ] **Step 1: Build and deploy**

Run on dev machine:
```bash
bun run build.sh
```
Then SCP the tarball to the device and run `install_rm520n.sh` per project conventions. (See CLAUDE.md "scp -O" note.)

- [ ] **Step 2: Confirm fresh-install default**

On device:
```bash
rm -f /usrdata/qmanager/tower_lock_config.json
curl -sk -b "$COOKIE_JAR" https://127.0.0.1/cgi-bin/quecmanager/tower/status.sh | jq '.config.failover'
```
Expected: `{"enabled": false, "threshold": 20}`.

- [ ] **Step 3: Verify lock does not auto-enable failover**

In the web UI:
1. Navigate to **Cellular → Cell Locking → Tower Locking**.
2. Confirm Signal Failover row reads "No active lock" (Switch disabled).
3. Enter LTE EARFCN + PCI from a visible carrier and toggle **LTE Tower Locking Enabled** → on. Confirm the lock dialog → Lock Tower.
4. After the modem reconnects, observe Tower Locking Settings card.

Expected: Signal Failover Switch is now interactable (`hasActiveLock` true) but **its toggle is still in the Disabled position**. Failover Status badge reads "Disabled".

- [ ] **Step 4: Verify explicit enable still works**

In the same UI session, toggle Signal Failover on. The watcher should start.

Expected: Failover Status badge transitions to "Monitoring" within ~5s. `tower_config_get '.failover.enabled'` on device returns `true`.

- [ ] **Step 5: Verify auto-disable on unlock is preserved**

Toggle LTE Tower Locking off → Remove Lock. After the modem reconnects:

Expected: Signal Failover Switch reverts to Disabled position and reads "No active lock". `tower_config_get '.failover.enabled'` returns `false`. Failover Status badge reads "Disabled".

- [ ] **Step 6: Verify spinner scoping (LTE)**

In the LTE card, enter values and toggle the lock Switch. During the ~5s lock window, observe the two toggle rows.

Expected: only the **LTE Tower Locking Enabled** Switch row shows the spinning Loader2. The Simple Mode row's Switch is greyed out (disabled) but has **no spinner** beside it.

- [ ] **Step 7: Verify spinner scoping (NR-SA)**

Repeat Step 6 in the NR-SA card. Expected: same — spinner appears only beside **NR Tower Locking Enabled**, not Simple Mode.

- [ ] **Step 8: Restore behavior on existing installs (sanity)**

On a device that already had `failover.enabled=true` in its existing config file, verify nothing was clobbered: the existing setting is preserved across the upgrade because `tower_config_get`/`tower_config_init` only seed the default when the file is missing or unreadable. Confirm by inspecting the config file pre- and post-upgrade.

Expected: pre-existing `failover.enabled` value is unchanged after upgrade.

---

## Self-Review

1. **Spec coverage**
   - Req 1a "Signal Failover disabled by default after fresh install" → Task 1 (default flip) + Task 2/3 (no auto-enable on lock).
   - Req 1b "only enabled explicitly by the user" → Task 2/3 remove the only code paths that flipped it on without user action.
   - Req 1c "Disabling LTE / NR-SA tower locking will still automatically disable Signal Failover" → preserved (verified read-only in Task 6 Step 5; existing `lock.sh` lines 188 and 300 untouched).
   - Req 2 "loading spinner only beside enable/disable lock toggle" → Tasks 4 and 5 in both LTE and NR-SA cards.

2. **Placeholder scan** — no TBDs, every code block is the literal change to make.

3. **Type/symbol consistency** — `Loader2` import in both `.tsx` files remains used by the surviving spinner; `failover_armed`, `tower_spawn_failover_watcher`, and `tower_config_update` references match their existing signatures in `tower_lock_mgr.sh`.
