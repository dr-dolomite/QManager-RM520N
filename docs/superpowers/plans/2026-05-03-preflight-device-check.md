# Pre-flight Device Check Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `preflight()` in the install script so it correctly identifies the device model, hard-blocks RM551E, and prompts for confirmation on any unrecognized device instead of blindly labelling everything "RM520N-GL".

**Architecture:** Single function change in `scripts/install_rm520n.sh`. Extract the `Project Name:` field from `/etc/quectel-project-version`, classify it with a `case` statement, and drive three code paths: silent proceed (RM520N), hard abort (RM551E), and interactive y/n prompt (anything else). `build.sh` copies this file into `qmanager_install/` at build time — no other file needs editing.

**Tech Stack:** POSIX sh (`/bin/bash` available on target), `grep`, `sed`, `read` builtin.

---

## File Map

| Action | File | What changes |
|--------|------|--------------|
| Modify | `scripts/install_rm520n.sh:128-135` | Replace hard-coded "RM520N-GL" label with model-aware `case` block |

---

### Task 1: Fix `preflight()` device detection

**Files:**
- Modify: `scripts/install_rm520n.sh:119-152`

This is the only change needed. The `build.sh` build process copies the updated file into `qmanager_install/install_rm520n.sh` automatically at build time.

---

#### Background — current broken code (lines 128-135)

```sh
# Check we're on RM520N-GL
if [ -f /etc/quectel-project-version ]; then
    local ver
    ver=$(cat /etc/quectel-project-version 2>/dev/null)
    info "Detected: RM520N-GL ($ver)"
else
    warn "Cannot detect RM520N-GL firmware version — proceeding anyway"
fi
```

Bug: always prints "Detected: RM520N-GL" regardless of what the version file actually says. An RG501Q, RM551E, or any other Quectel modem all get labelled as RM520N-GL and proceed without warning.

---

- [ ] **Step 1: Read and understand the current preflight block**

Open `scripts/install_rm520n.sh` and locate lines 119–152. Confirm the block looks exactly like the code above before editing.

---

- [ ] **Step 2: Replace the device-detection block**

Replace lines 128–135 (the `# Check we're on RM520N-GL` block) with the following:

```sh
    # Detect device model from firmware version file
    if [ -f /etc/quectel-project-version ]; then
        local ver project_name
        ver=$(cat /etc/quectel-project-version 2>/dev/null)
        project_name=$(grep -m1 "^Project Name:" /etc/quectel-project-version 2>/dev/null \
            | sed 's/^Project Name:[[:space:]]*//' | tr -d '[:space:]')

        case "$project_name" in
            RM551E*)
                die "Incompatible device: $project_name detected. Use the QManager RM551E installer."
                ;;
            RM520N*)
                info "Detected: RM520N-GL ($ver)"
                ;;
            "")
                warn "Cannot parse device model from firmware version — proceeding anyway"
                ;;
            *)
                warn "Unrecognized device: $project_name"
                printf "\n"
                printf "  %s\n" "$ver" | sed 's/^/    /'
                printf "\n  This installer targets RM520N-GL devices. Your device may not be compatible.\n"
                printf "  Do you want to proceed anyway? [y/N] "
                local answer
                read -r answer
                case "$answer" in
                    [Yy]|[Yy][Ee][Ss]) info "Proceeding on user request" ;;
                    *) die "Installation aborted by user" ;;
                esac
                ;;
        esac
    else
        warn "Cannot detect firmware version (/etc/quectel-project-version not found) — proceeding anyway"
    fi
```

**Exact diff target** — the old block:
```sh
    # Check we're on RM520N-GL
    if [ -f /etc/quectel-project-version ]; then
        local ver
        ver=$(cat /etc/quectel-project-version 2>/dev/null)
        info "Detected: RM520N-GL ($ver)"
    else
        warn "Cannot detect RM520N-GL firmware version — proceeding anyway"
    fi
```

---

- [ ] **Step 3: Manually verify the four code paths look correct**

Read the updated `preflight()` function and trace each path:

| Scenario | `project_name` value | Expected outcome |
|----------|---------------------|-----------------|
| Target device | `RM520NGLAR12A06M4G` | Matches `RM520N*` → `info "Detected: RM520N-GL (…)"` → proceeds |
| Blocked device | `RM551EGLAAR…` | Matches `RM551E*` → `die` with model name → exits 1 |
| Unknown device (RG501Q etc.) | `RG501QEU_VD` | Matches `*` fallthrough → shows full version block + `[y/N]` prompt |
| Version file absent | (file missing) | `else` branch → `warn` → proceeds |
| File present but Project Name line missing | `project_name=""` | Matches `""` → `warn` → proceeds |

---

- [ ] **Step 4: Smoke-test the `grep`/`sed` extraction locally**

Create a test file and run the extraction command to confirm it works before deploying:

```sh
cat > /tmp/test_ver.txt << 'EOF'
Project Name: RG501QEU_VD
Project Rev : RG501QEUAAR12A11M4G_04.301
Branch  Name: SDX55
Custom  Name: STD
Package Time: 2025-11-26,19:10
EOF

grep -m1 "^Project Name:" /tmp/test_ver.txt \
    | sed 's/^Project Name:[[:space:]]*//' | tr -d '[:space:]'
```

Expected output:
```
RG501QEU_VD
```

Run with a second test for RM520N:

```sh
cat > /tmp/test_ver2.txt << 'EOF'
Project Name: RM520NGLAR12A06M4G
Project Rev : RM520NGLAR12A06M4G_01.001
Branch  Name: SDXLEMUR
EOF

grep -m1 "^Project Name:" /tmp/test_ver2.txt \
    | sed 's/^Project Name:[[:space:]]*//' | tr -d '[:space:]'
```

Expected output:
```
RM520NGLAR12A06M4G
```

---

- [ ] **Step 5: Test the interactive prompt path manually**

Simulate the `*` fallthrough by temporarily overriding `project_name` in a throwaway shell snippet:

```sh
bash -c '
project_name="RG501QEU_VD"
ver="Project Name: RG501QEU_VD
Project Rev : RG501QEUAAR12A11M4G_04.301
Branch  Name: SDX55"

case "$project_name" in
    RM551E*)  echo "BLOCKED: $project_name" ;;
    RM520N*)  echo "PROCEED: RM520N-GL" ;;
    "")       echo "WARN: empty" ;;
    *)
        echo "Unrecognized device: $project_name"
        printf "\n  %s\n" "$ver"
        printf "\n  This installer targets RM520N-GL devices. Your device may not be compatible.\n"
        printf "  Do you want to proceed anyway? [y/N] "
        read -r answer
        case "$answer" in
            [Yy]|[Yy][Ee][Ss]) echo "INFO: Proceeding on user request" ;;
            *) echo "ABORTED" ;;
        esac
        ;;
esac
' <<< "y"
```

Expected output (with `y` piped in):
```
Unrecognized device: RG501QEU_VD

  Project Name: RG501QEU_VD
  Project Rev : RG501QEUAAR12A11M4G_04.301
  Branch  Name: SDX55

  This installer targets RM520N-GL devices. Your device may not be compatible.
  Do you want to proceed anyway? [y/N] INFO: Proceeding on user request
```

Run again with `n` (or empty):
```sh
bash -c '...' <<< "n"
```
Expected: prints prompt, then `ABORTED`.

---

- [ ] **Step 6: Commit**

```sh
git add scripts/install_rm520n.sh
git commit -m "fix(installer): fix preflight device check to correctly identify model and prompt on unknown devices"
```

---

## Self-Review

**Spec coverage:**
- ✅ Show the actual device name (not hard-coded "RM520N-GL")
- ✅ Hard-abort on RM551E with clear error message
- ✅ Prompt y/n on any unrecognized/non-RM520N device
- ✅ RM520N-GL still proceeds silently as before

**Placeholder scan:** None.

**Type consistency:** N/A — pure shell, no type system.

**Edge cases covered:**
- Version file absent → warn and proceed (same as before, not regressed)
- `Project Name:` line missing from file → empty string path → warn and proceed
- Multi-word or whitespace in project name → `tr -d '[:space:]'` normalizes it
- `printf … | sed` indentation pipe in the `*` path — note: the `sed` call on the `printf` pipeline is valid POSIX; `ver` is a multi-line string, each line gets indented with 4 spaces for clean terminal display
