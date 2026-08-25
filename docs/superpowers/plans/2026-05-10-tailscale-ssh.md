# Tailscale SSH Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Tailscale SSH toggle to the Tailscale Connection card that persists user intent across `--reset` reconnects and reboots, and applies live when the daemon is running.

**Architecture:** A QManager-owned flag file (`/etc/qmanager/tailscale_ssh`) stores the user's SSH intent (`1` or `0`). The CGI `connect` path reads the flag and conditionally appends `--ssh` to `tailscale up`. A new `set_ssh` POST action atomically writes the flag and invokes `tailscale set --ssh=` for immediate effect when the daemon is up. Helper script removes the flag on uninstall so reinstalls require explicit opt-in.

**Tech Stack:** POSIX shell (CGI on lighttpd), `jq` for JSON, systemd, React 19 + TypeScript, shadcn/ui (`Switch`, `AlertDialog`, `Tooltip`), `motion/react`, `sonner` toasts.

**Spec reference:** `docs/superpowers/specs/2026-05-10-tailscale-ssh-design.md`

**Testing note:** QManager has no automated test harness for CGI scripts or React components on the `dev-rm520` branch. Per-task verification is `bash -n` (shell syntax) and `bunx tsc --noEmit` (type-check). End-of-plan verification is the manual on-hardware matrix in Task 8.

---

## File Map

**Modified files:**

| File | Responsibility |
|---|---|
| `scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh` | CGI endpoint. Gains SSH pref helpers, `ssh_enabled` in GET, `set_ssh` POST action, flag-aware connect. |
| `scripts/usr/bin/qmanager_tailscale_mgr` | Privileged helper. `do_uninstall` removes the flag file. |
| `hooks/use-tailscale.ts` | React data hook. `TailscaleStatus` gains `ssh_enabled`; new `setSshEnabled` action + `isTogglingSsh` state. |
| `components/monitoring/tailscale/tailscale-connection-card.tsx` | UI card. Adds `sshToggle` element with enable-confirm `AlertDialog` and disabled-state `Tooltip`; rendered in all post-install state branches. |

**No new files. No sudoers changes** — `qmanager_tailscale_mgr` and `tailscale` already invoke through existing `$_SUDO` plumbing.

---

### Task 1: Add SSH preference helpers + `ssh_enabled` field in CGI GET

**Files:**
- Modify: `scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh` (constants block ~L25–35, helpers block ~L37–77, three GET tier responses ~L88–213)

- [ ] **Step 1: Add the `SSH_PREF_FILE` constant**

Edit `scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh`. Find the constants block (after `UNIT_DIR="/lib/systemd/system"` at L35) and add one line below it:

```sh
SSH_PREF_FILE="/etc/qmanager/tailscale_ssh"
```

- [ ] **Step 2: Add `get_ssh_pref` helper**

In the helpers block (after `get_boot_enabled()` ends at ~L56, before `kill_stale_ts_up()`), add:

```sh
# --- Helper: read persisted SSH intent flag (true/false) ---------------------
# Defaults to "false" if the file is missing, unreadable, or contains anything
# other than "1". This is the QManager-owned source of truth for whether
# `tailscale up` should be invoked with `--ssh`.
get_ssh_pref() {
    if [ -f "$SSH_PREF_FILE" ] && [ "$(cat "$SSH_PREF_FILE" 2>/dev/null | tr -d ' \n\r')" = "1" ]; then
        echo "true"
    else
        echo "false"
    fi
}
```

- [ ] **Step 3: Add `ssh_enabled` to Tier 2 GET response (daemon stopped)**

In the GET handler, the Tier 2 block (~L100–115) currently emits this `jq -n` call:

```sh
        jq -n \
            --argjson installed true \
            --argjson daemon_running false \
            --argjson enabled_on_boot "$boot_enabled" \
            --arg version "$ts_version" \
            '{
                success: true,
                installed: $installed,
                daemon_running: $daemon_running,
                enabled_on_boot: $enabled_on_boot,
                version: $version
            }'
```

Replace it with this version (adds `ssh_enabled` read + arg + field):

```sh
        ssh_enabled=$(get_ssh_pref)
        jq -n \
            --argjson installed true \
            --argjson daemon_running false \
            --argjson enabled_on_boot "$boot_enabled" \
            --argjson ssh_enabled "$ssh_enabled" \
            --arg version "$ts_version" \
            '{
                success: true,
                installed: $installed,
                daemon_running: $daemon_running,
                enabled_on_boot: $enabled_on_boot,
                ssh_enabled: $ssh_enabled,
                version: $version
            }'
```

- [ ] **Step 4: Add `ssh_enabled` to Tier 3 error-fallback GET response**

In the Tier 3 block (~L122–139), the inner `jq -n` call inside the `if [ -z "$status_json" ] ...` guard currently emits a response without `ssh_enabled`. Replace it with:

```sh
        ssh_enabled=$(get_ssh_pref)
        jq -n \
            --argjson installed true \
            --argjson daemon_running true \
            --argjson enabled_on_boot "$boot_enabled" \
            --argjson ssh_enabled "$ssh_enabled" \
            --arg version "$ts_version" \
            '{
                success: true,
                installed: $installed,
                daemon_running: $daemon_running,
                enabled_on_boot: $enabled_on_boot,
                ssh_enabled: $ssh_enabled,
                version: $version,
                backend_state: "Unknown",
                error_detail: "Could not retrieve status from tailscale daemon"
            }'
```

- [ ] **Step 5: Add `ssh_enabled` to Tier 3 full GET response**

The full-status `jq -n` call (~L190–213) currently emits 10 top-level fields without `ssh_enabled`. Replace it with:

```sh
    ssh_enabled=$(get_ssh_pref)
    jq -n \
        --argjson installed true \
        --argjson daemon_running true \
        --argjson enabled_on_boot "$boot_enabled" \
        --argjson ssh_enabled "$ssh_enabled" \
        --arg version "$ts_version" \
        --arg backend_state "$backend_state" \
        --arg auth_url "$auth_url" \
        --argjson self "$self_json" \
        --argjson tailnet "$tailnet_json" \
        --argjson peers "$peers_json" \
        --argjson health "$health_json" \
        '{
            success: true,
            installed: $installed,
            daemon_running: $daemon_running,
            enabled_on_boot: $enabled_on_boot,
            ssh_enabled: $ssh_enabled,
            version: $version,
            backend_state: $backend_state,
            auth_url: $auth_url,
            self: $self,
            tailnet: $tailnet,
            peers: $peers,
            health: $health
        }'
```

- [ ] **Step 6: Verify shell syntax**

Run from the repo root:

```bash
bash -n scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh
```

Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh
git commit -m "feat(tailscale): expose ssh_enabled in CGI GET response"
```

---

### Task 2: Add `set_ssh` POST action to CGI

**Files:**
- Modify: `scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh` (POST action chain, between `set_boot_enabled` and `uninstall` actions, ~L466)

- [ ] **Step 1: Insert the new `set_ssh` action**

Find the end of the `set_boot_enabled` action handler. The line is `cgi_success` followed by `exit 0` and a closing `fi`, at approximately L464–466. Immediately after that closing `fi`, before the `# action: uninstall` comment block, insert this new action handler:

```sh
    # -------------------------------------------------------------------------
    # action: set_ssh — persist SSH intent flag + apply live if daemon running
    # -------------------------------------------------------------------------
    # User intent (1 or 0) is stored in $SSH_PREF_FILE and read by the connect
    # path so SSH survives `tailscale up --reset`. When the daemon is running
    # we also apply the change immediately via `tailscale set --ssh=`.
    if [ "$ACTION" = "set_ssh" ]; then
        ssh_value=$(printf '%s' "$POST_DATA" | jq -r '.enabled | if . == null then empty else tostring end')
        if [ -z "$ssh_value" ]; then
            cgi_error "missing_field" "enabled field is required"
            exit 0
        fi
        case "$ssh_value" in
            true)  new_flag="1" ;;
            false) new_flag="0" ;;
            *)
                cgi_error "invalid_value" "enabled must be true or false"
                exit 0
                ;;
        esac

        # Snapshot previous flag for rollback on `tailscale set` failure.
        old_flag=""
        if [ -f "$SSH_PREF_FILE" ]; then
            old_flag=$(cat "$SSH_PREF_FILE" 2>/dev/null | tr -d ' \n\r')
        fi

        # Atomic write: .tmp + mv (matches the convention in email/sms alert configs).
        mkdir -p /etc/qmanager 2>/dev/null
        tmp_file="${SSH_PREF_FILE}.tmp"
        printf '%s\n' "$new_flag" > "$tmp_file" 2>/dev/null
        if [ ! -f "$tmp_file" ]; then
            cgi_error "write_failed" "Could not write SSH preference file"
            exit 0
        fi
        mv -f "$tmp_file" "$SSH_PREF_FILE"

        # If daemon is up, apply immediately. Otherwise return pending=true so
        # the UI surfaces "applies on next connect".
        if is_daemon_running; then
            set_output=$(ts_cmd set --ssh="$ssh_value" 2>&1)
            set_rc=$?
            if [ "$set_rc" -ne 0 ]; then
                # Roll back the flag write so the UI state matches reality.
                if [ -n "$old_flag" ]; then
                    printf '%s\n' "$old_flag" > "$SSH_PREF_FILE"
                else
                    rm -f "$SSH_PREF_FILE"
                fi
                qlog_error "tailscale set --ssh=$ssh_value failed: $set_output"
                jq -n --arg detail "$set_output" '{success: false, error: "set_failed", detail: $detail}'
                exit 0
            fi
            qlog_info "Tailscale SSH set to $ssh_value"
            cgi_success
        else
            qlog_info "Tailscale SSH preference set to $ssh_value (daemon stopped, will apply on next connect)"
            jq -n '{success: true, pending: true, message: "Tailscale SSH will activate on next connect."}'
        fi
        exit 0
    fi

```

- [ ] **Step 2: Verify shell syntax**

```bash
bash -n scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh
```

Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh
git commit -m "feat(tailscale): add set_ssh POST action with flag persistence and live apply"
```

---

### Task 3: Make CGI connect path flag-aware

**Files:**
- Modify: `scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh` (connect action, ~L325–335)

- [ ] **Step 1: Read flag and append `--ssh` conditionally**

Find the connect action's `tailscale up` invocation (~L333). The current line is:

```sh
        ( ts_cmd up --reset --accept-dns=false > "$TS_UP_OUTPUT" 2>&1 ) &
```

Replace just that line (and the comment block immediately above it) with:

```sh
        # CRITICAL: NEVER use --accept-routes — it disconnects the device from
        # the network entirely and requires a physical reboot to recover.
        # NOTE: Do NOT use --json flag — its output is fully buffered on
        # RM520N-GL (no stdbuf available) and never flushes to the file.
        # Interactive mode flushes the auth URL immediately.
        # --reset clears any lingering flags from a prior `tailscale up`
        # (matches the rgmii-toolkit/SimpleAdmin convention validated across
        # PRAIRE and SDXLEMUR modem platforms).
        # Flag-aware SSH: --reset would wipe RunSSH on every connect, so we
        # re-append --ssh here when the QManager-owned intent flag is set.
        ssh_flag_arg=""
        if [ "$(get_ssh_pref)" = "true" ]; then
            ssh_flag_arg="--ssh"
        fi
        ( ts_cmd up --reset --accept-dns=false $ssh_flag_arg > "$TS_UP_OUTPUT" 2>&1 ) &
```

Note: the existing comment block above the original line ends with "...validated across PRAIRE and SDXLEMUR modem platforms)." — make sure your replacement starts at the existing comment block so you don't end up with two copies.

Note on the unquoted `$ssh_flag_arg`: this is intentional. In POSIX `sh`, `cmd "$x"` with `x=""` passes an empty positional argument to `tailscale`, which then fails because `--ssh` is conditional. Leaving the variable unquoted lets word-splitting eliminate the empty string. The value is either the literal `--ssh` or empty — never user-controlled — so there is no quoting risk.

- [ ] **Step 2: Verify shell syntax**

```bash
bash -n scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh
```

Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/www/cgi-bin/quecmanager/vpn/tailscale.sh
git commit -m "feat(tailscale): make connect path SSH-flag-aware via persisted pref"
```

---

### Task 4: Clear flag on uninstall in helper script

**Files:**
- Modify: `scripts/usr/bin/qmanager_tailscale_mgr` (`do_uninstall` function, ~L360–368)

- [ ] **Step 1: Add SSH pref removal to uninstall cleanup**

Find the `do_uninstall` function's runtime cleanup block (~L360–367). The current block is:

```sh
    # Clean up runtime temp files.
    rm -f /tmp/qmanager_tailscale_auth_url \
          /tmp/qmanager_tailscale_up_output \
          /tmp/qmanager_tailscale_up_pid \
          "$INSTALL_RESULT" \
          "$INSTALL_PID" \
          "$LOG_FILE" \
          "$INNER_SCRIPT"
```

Immediately after that block (before `sync`), add:

```sh

    # Remove QManager-owned SSH intent flag so a reinstall starts off (explicit opt-in).
    rm -f /etc/qmanager/tailscale_ssh
```

- [ ] **Step 2: Verify shell syntax**

```bash
bash -n scripts/usr/bin/qmanager_tailscale_mgr
```

Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/usr/bin/qmanager_tailscale_mgr
git commit -m "feat(tailscale): clear SSH intent flag on uninstall"
```

---

### Task 5: Extend `useTailscale` hook with SSH state and action

**Files:**
- Modify: `hooks/use-tailscale.ts` (interface `TailscaleStatus` ~L57–70, interface `UseTailscaleReturn` ~L72–90, new action ~after `setBootEnabled` at L323–350, return object ~L420–438)

- [ ] **Step 1: Add `ssh_enabled` to `TailscaleStatus`**

Find the `TailscaleStatus` interface (~L57–70). Add one optional field after `enabled_on_boot?`:

```ts
export interface TailscaleStatus {
  installed: boolean;
  daemon_running?: boolean;
  enabled_on_boot?: boolean;
  ssh_enabled?: boolean;
  version?: string;
  backend_state?: string;
  auth_url?: string;
  self?: TailscaleSelf;
  tailnet?: TailscaleTailnet;
  peers?: TailscalePeer[];
  health?: string[];
  install_hint?: string;
  error_detail?: string;
}
```

- [ ] **Step 2: Add `setSshEnabled` and `isTogglingSsh` to `UseTailscaleReturn`**

Find the `UseTailscaleReturn` interface (~L72–90). Add `isTogglingSsh` near the other `isTogglingX` flags and `setSshEnabled` near `setBootEnabled`:

```ts
export interface UseTailscaleReturn {
  status: TailscaleStatus | null;
  isLoading: boolean;
  isConnecting: boolean;
  isDisconnecting: boolean;
  isTogglingService: boolean;
  isTogglingSsh: boolean;
  isUninstalling: boolean;
  installResult: InstallResult;
  error: string | null;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<boolean>;
  logout: () => Promise<boolean>;
  startService: () => Promise<boolean>;
  stopService: () => Promise<boolean>;
  setBootEnabled: (enabled: boolean) => Promise<boolean>;
  setSshEnabled: (enabled: boolean) => Promise<boolean>;
  uninstall: () => Promise<boolean>;
  runInstall: () => Promise<void>;
  refresh: () => void;
}
```

- [ ] **Step 3: Add `isTogglingSsh` state**

Inside the `useTailscale` function body, find the existing `useState` declarations (~L95–106). Add `isTogglingSsh` next to `isTogglingService`:

```ts
  const [isTogglingService, setIsTogglingService] = useState(false);
  const [isTogglingSsh, setIsTogglingSsh] = useState(false);
  const [isUninstalling, setIsUninstalling] = useState(false);
```

- [ ] **Step 4: Add `setSshEnabled` action method**

Immediately after the `setBootEnabled` definition (`}, [postAction, fetchStatus]);` at ~L350), add:

```ts
  const setSshEnabled = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      setIsTogglingSsh(true);
      setError(null);

      try {
        const json = await postAction({ action: "set_ssh", enabled });
        if (!mountedRef.current) return false;

        if (!json.success) {
          setError(json.detail || json.error || "Failed to update SSH setting");
          return false;
        }

        await fetchStatus(true);
        return true;
      } catch (err) {
        if (!mountedRef.current) return false;
        setError(
          err instanceof Error ? err.message : "Failed to update SSH setting",
        );
        return false;
      } finally {
        if (mountedRef.current) setIsTogglingSsh(false);
      }
    },
    [postAction, fetchStatus],
  );
```

- [ ] **Step 5: Add new fields to the returned object**

Find the `return` statement at the end of `useTailscale` (~L420–438). Add `isTogglingSsh` next to `isTogglingService` and `setSshEnabled` next to `setBootEnabled`:

```ts
  return {
    status,
    isLoading,
    isConnecting,
    isDisconnecting,
    isTogglingService,
    isTogglingSsh,
    isUninstalling,
    installResult,
    error,
    connect,
    disconnect,
    logout,
    startService,
    stopService,
    setBootEnabled,
    setSshEnabled,
    uninstall,
    runInstall,
    refresh: fetchStatus,
  };
```

- [ ] **Step 6: Type-check**

Run from the repo root:

```bash
bunx tsc --noEmit
```

Expected: clean exit (no errors involving `use-tailscale.ts`). The card component file will report errors about the missing `setSshEnabled` destructure until Task 6 completes — note them but continue; Task 6 fixes them.

Note: if pre-existing errors unrelated to this work appear, ignore them. Only new errors introduced by this task block progress.

- [ ] **Step 7: Commit**

```bash
git add hooks/use-tailscale.ts
git commit -m "feat(tailscale): add setSshEnabled action and ssh_enabled status field to hook"
```

---

### Task 6: Add `sshToggle` element + enable-confirm dialog to card

**Files:**
- Modify: `components/monitoring/tailscale/tailscale-connection-card.tsx` (imports ~L29–46, destructured props ~L75–93, new element block after `bootToggle` definition ~L343–357)

- [ ] **Step 1: Add `Tooltip` to imports**

Find the imports block (~L29–46). The component already imports `Switch`, `AlertDialog*`, and lucide icons. Tooltip is not yet imported. Add it after the `Skeleton` import:

```tsx
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
```

- [ ] **Step 2: Destructure `setSshEnabled` and `isTogglingSsh` from props**

Find the function signature (~L75–93). Add the two new props next to their `boot`/`Service` siblings:

```tsx
export function TailscaleConnectionCard({
  status,
  isLoading,
  isConnecting,
  isDisconnecting,
  isTogglingService,
  isTogglingSsh,
  isUninstalling,
  installResult,
  error,
  connect,
  disconnect,
  logout,
  startService,
  stopService,
  setBootEnabled,
  setSshEnabled,
  uninstall,
  runInstall,
  refresh,
}: TailscaleConnectionCardProps) {
```

- [ ] **Step 3: Add `showSshEnableDialog` local state**

Find the existing `useState` block (~L94–95). Add a new state below `isRebooting`:

```tsx
  const [showRebootDialog, setShowRebootDialog] = useState(false);
  const [isRebooting, setIsRebooting] = useState(false);
  const [showSshEnableDialog, setShowSshEnableDialog] = useState(false);
```

- [ ] **Step 4: Add `sshToggle` element after `bootToggle`**

Find where `bootToggle` is defined (~L343–357). Immediately after its closing `);`, add the `sshToggle` element. This block covers: the switch row with disabled/tooltip handling, the "Pending" hint, and the enable-confirm `AlertDialog`.

```tsx
  // SSH preference state
  const sshEnabled = status?.ssh_enabled ?? false;
  // Disabled when daemon is stopped or backend not Running — tailscale set
  // cannot reach the daemon, and the flag-only path is only meaningful at
  // connect time.
  const sshSwitchDisabled =
    isTogglingSsh || !daemonRunning || backendState !== "Running";
  // Pending = user enabled SSH but the daemon isn't fully up; the flag-aware
  // connect path will pick it up on next connect.
  const sshPending =
    sshEnabled && (!daemonRunning || backendState !== "Running");

  const handleSshChange = async (checked: boolean) => {
    if (checked) {
      // Opening the dialog flips the switch back visually until the user confirms.
      setShowSshEnableDialog(true);
      return;
    }
    const success = await setSshEnabled(false);
    if (success) {
      toast.success("Tailscale SSH disabled");
    } else {
      toast.error("Failed to disable Tailscale SSH");
    }
  };

  const handleSshConfirmEnable = async () => {
    setShowSshEnableDialog(false);
    const success = await setSshEnabled(true);
    if (success) {
      toast.success("Tailscale SSH enabled");
    } else {
      toast.error("Failed to enable Tailscale SSH");
    }
  };

  // SSH toggle element (reused across post-install state branches).
  const sshToggle = (
    <>
      <Separator />
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-muted-foreground">
            Tailscale SSH
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Allow tailnet members to SSH into this device based on your
            admin-panel ACLs.
          </p>
          {sshPending && (
            <p className="text-xs text-muted-foreground mt-1 italic">
              Pending — applies on next connect.
            </p>
          )}
        </div>
        {sshSwitchDisabled && !isTogglingSsh ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* span wrapper: Switch is disabled, but Tooltip still needs a hoverable target */}
                <span tabIndex={0}>
                  <Switch
                    checked={sshEnabled}
                    onCheckedChange={handleSshChange}
                    disabled
                    aria-label="Enable Tailscale SSH"
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Connect to Tailscale to enable SSH.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <Switch
            checked={sshEnabled}
            onCheckedChange={handleSshChange}
            disabled={isTogglingSsh}
            aria-label="Enable Tailscale SSH"
          />
        )}
      </div>
      <AlertDialog open={showSshEnableDialog} onOpenChange={setShowSshEnableDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable Tailscale SSH?</AlertDialogTitle>
            <AlertDialogDescription>
              Tailnet members will be able to SSH into this device based on
              your Tailscale admin-panel ACLs. Review your ACL policy in the
              Tailscale admin console before enabling so only the intended
              users can connect.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSshConfirmEnable}>
              Enable SSH
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
```

- [ ] **Step 5: Type-check**

```bash
bunx tsc --noEmit
```

Expected: clean exit. (Errors from Task 5 about missing destructure are now resolved; only "unused variable: sshToggle" may appear since it's defined but not yet rendered — Task 7 wires it in. If your TS config promotes "unused variable" to error, this step will surface that; the next task resolves it. Otherwise, no errors.)

- [ ] **Step 6: Commit**

```bash
git add components/monitoring/tailscale/tailscale-connection-card.tsx
git commit -m "feat(tailscale): add SSH toggle element with enable-confirm dialog"
```

---

### Task 7: Render `sshToggle` in every post-install state branch

**Files:**
- Modify: `components/monitoring/tailscale/tailscale-connection-card.tsx` (Service Stopped branch ~L423–475, NeedsLogin branch ~L478–581, Connected branch ~L584–766, Disconnected branch ~L769–855)

- [ ] **Step 1: Render in Service Stopped branch**

Find the "Service Stopped" branch (~L423). The render currently has `{bootToggle}` followed by `<Separator />`. Add `{sshToggle}` directly after `{bootToggle}`:

```tsx
            {bootToggle}
            {sshToggle}
            <Separator />
            <div className="flex items-center gap-2 flex-wrap pt-1">
```

- [ ] **Step 2: Render in NeedsLogin branch**

Find the "Needs Login" branch (~L478). Locate the `{bootToggle}` near the end (~L551). Add `{sshToggle}` directly after it:

```tsx
            {bootToggle}
            {sshToggle}
            <Separator />
            <div className="pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const success = await stopService();
```

- [ ] **Step 3: Render in Connected (Running) branch**

Find the Running branch (~L584). Locate `{/* Boot toggle */}` and `{bootToggle}` (~L647–648). Add `{sshToggle}` directly after:

```tsx
            {/* Boot toggle */}
            {bootToggle}
            {sshToggle}
            {/* Health warnings */}
```

- [ ] **Step 4: Render in Disconnected branch**

Find the final Disconnected branch (~L769). Locate `{bootToggle}` (~L791). Add `{sshToggle}` directly after:

```tsx
          {bootToggle}
          {sshToggle}

          <Separator />
          <div className="flex items-center gap-2 flex-wrap pt-1">
```

- [ ] **Step 5: Type-check**

```bash
bunx tsc --noEmit
```

Expected: clean exit, no errors.

- [ ] **Step 6: Commit**

```bash
git add components/monitoring/tailscale/tailscale-connection-card.tsx
git commit -m "feat(tailscale): render SSH toggle in all Tailscale card state branches"
```

---

### Task 8: Manual on-hardware verification matrix

**Files:** none modified — verification only.

This task is the on-device test matrix from the spec. QManager has no automated CGI/React test harness on the `dev-rm520` branch, so this is the equivalent of the acceptance test suite. **Deploy the branch to a target RM520N-GL** (via the installer or rsync — see `docs/rm520n-gl-architecture.md` for deploy instructions) before starting.

- [ ] **Step 1: Pre-flight — confirm clean install state**

On the device, run:

```bash
ls -l /etc/qmanager/tailscale_ssh 2>&1
sudo /usrdata/tailscale/tailscale status 2>&1 | head -5
```

Expected: flag file does not exist on a fresh install; tailscale either not installed or not running. Note the starting state.

- [ ] **Step 2: Scenario 1 — Enable SSH while connected**

1. Open QManager web UI → Monitoring → Tailscale.
2. Install Tailscale if needed → click Connect → authenticate via the auth URL.
3. Once "Connected", flip the Tailscale SSH switch on. The enable-confirm dialog appears.
4. Click "Enable SSH".

Verify on device:

```bash
cat /etc/qmanager/tailscale_ssh
sudo /usrdata/tailscale/tailscale debug prefs 2>&1 | grep -i runssh
```

Expected: flag = `1`; `RunSSH` is `true`. Toast in UI says "Tailscale SSH enabled".

From an external tailnet device:

```bash
ssh root@<this-device-hostname>
```

Expected: SSH session opens via Tailscale.

- [ ] **Step 3: Scenario 2 — Disable SSH while connected**

In the UI, flip the switch off. No dialog appears (silent disable per spec).

Verify on device:

```bash
cat /etc/qmanager/tailscale_ssh
sudo /usrdata/tailscale/tailscale debug prefs 2>&1 | grep -i runssh
```

Expected: flag = `0`; `RunSSH` is `false`. Toast says "Tailscale SSH disabled". External SSH attempts now fail.

- [ ] **Step 4: Scenario 3 — Toggle while daemon stopped (pending state)**

1. In the UI, stop the Tailscale service.
2. Reload the page. The card shows the Stopped state. The SSH switch should be **disabled** with a tooltip on hover: "Connect to Tailscale to enable SSH."

To verify the pending indicator path, manually set the flag before the daemon comes back up:

```bash
echo 1 | sudo tee /etc/qmanager/tailscale_ssh
```

3. Reload the page. The switch reads ON, is disabled, and the text "Pending — applies on next connect." appears.
4. Start the service and connect. Once Running, verify on device that `RunSSH` is `true` (the flag-aware connect path appended `--ssh`).

- [ ] **Step 5: Scenario 4 — Persistence across reconnect (the core `--reset` survival case)**

With SSH on and connected, in the UI:

1. Click Disconnect.
2. Once disconnected, click Connect again.

Verify:

```bash
sudo /usrdata/tailscale/tailscale debug prefs 2>&1 | grep -i runssh
```

Expected: `RunSSH` is still `true` after reconnect — the connect path read the flag and re-appended `--ssh` even though `--reset` was used.

- [ ] **Step 6: Scenario 5 — Persistence across reboot**

1. With SSH on, "Start on Boot" on, and connected — reboot the device.
2. After reboot, log back into the UI.

Expected: card loads with the SSH switch reading ON, Tailscale is connected, and external SSH still works.

- [ ] **Step 7: Scenario 6 — Uninstall clears the flag**

In the UI, Uninstall Tailscale. After the uninstall completes:

```bash
ls -l /etc/qmanager/tailscale_ssh 2>&1
```

Expected: "No such file or directory". A reinstall starts with SSH off, requiring explicit opt-in.

- [ ] **Step 8: Scenario 7 — `set --ssh` failure rollback (optional, manual)**

This path is hard to trigger naturally. To verify the rollback logic, optionally simulate it by stopping the daemon at a precise moment, or trust the code path review. Skip if reproducing is too fragile — the spec acknowledges this is a rare race.

- [ ] **Step 9: Record verification outcome**

If all scenarios pass, the plan is complete. If any fail, file the failing scenario(s) for follow-up before merging.

---

## Self-Review

**Spec coverage:**

| Spec section | Task(s) |
|---|---|
| §Architecture piece 1 (persisted flag, atomic write) | Task 2 |
| §Architecture piece 2 (flag-aware connect) | Task 3 |
| §Architecture piece 3 (live toggle via `set --ssh`) | Task 2 |
| §File changes — `tailscale.sh` constant `SSH_PREF_FILE` | Task 1 step 1 |
| §File changes — `tailscale.sh` helper `get_ssh_pref` | Task 1 step 2 |
| §File changes — `tailscale.sh` GET adds `ssh_enabled` | Task 1 steps 3–5 |
| §File changes — `tailscale.sh` new `set_ssh` POST action | Task 2 |
| §File changes — `tailscale.sh` connect path edit | Task 3 |
| §File changes — `use-tailscale.ts` types + action + state | Task 5 |
| §File changes — `tailscale-connection-card.tsx` `sshToggle` element | Task 6 |
| §File changes — render in Stopped/NeedsLogin/Running/Disconnected | Task 7 |
| §File changes — `qmanager_tailscale_mgr` removes flag on uninstall | Task 4 |
| §Error handling — daemon stopped → `pending: true` | Task 2 |
| §Error handling — `set` failure → rollback | Task 2 |
| §Error handling — corrupted flag defaults to false | Task 1 step 2 (`get_ssh_pref`) |
| §Test plan — all 5 scenarios | Task 8 |

All spec sections map to at least one task. No gaps.

**Placeholder scan:** No "TBD", "TODO", "implement later", "add appropriate X", or "similar to Task N" instances. All code blocks are complete. All commands have expected output.

**Type / name consistency check:**

- CGI: flag file path `SSH_PREF_FILE="/etc/qmanager/tailscale_ssh"` consistent across Tasks 1–3. Helper name `get_ssh_pref()` consistent across Tasks 1, 3.
- POST action name `set_ssh` consistent across Task 2 (backend), Task 5 (hook `postAction({action: "set_ssh", ...})`).
- POST field `enabled` (boolean) consistent across Task 2 (backend `.enabled`), Task 5 (hook `{action: "set_ssh", enabled}`).
- GET field `ssh_enabled` consistent across Task 1 (backend), Task 5 (`TailscaleStatus.ssh_enabled`), Task 6 (`status?.ssh_enabled`).
- Hook method `setSshEnabled` and state `isTogglingSsh` consistent across Task 5 (definition + return), Task 6 (destructure + use).
- Local component state `showSshEnableDialog` consistent within Task 6.

No naming drift detected.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-10-tailscale-ssh.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Good for this plan because each task is self-contained and has a static-check gate before commit.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Good if you want to watch each edit land in real time.

Which approach?
