# Curl-Missing Fallback (Documentation + Defensive Symlink) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document a reliable fallback path for users on Quectel x5x/x6x firmwares whose base image lacks `curl`, and add one defensive line to the installer so post-install runtime scripts find curl on PATH even when only the Entware copy is present.

**Architecture:** Two-pronged, no new code paths. (1) `README.md` gains an "If curl is missing" subsection under Quick Install showing `opkg install curl` followed by a bootstrap that uses the absolute path `/opt/bin/curl` — bypassing the well-known Quectel BusyBox shell-PATH gap that omits `/opt/bin/`. (2) `scripts/install_rm520n.sh` gets a single-line defensive symlink (`ln -sf /opt/bin/curl /usr/bin/curl`) placed alongside the existing `jq` symlink at line ~599, so any service or daemon that calls `command -v curl` after install finds it regardless of PATH. (3) `RELEASE_NOTES.md` gets a one-line note referencing the new docs section.

**Tech Stack:** Markdown (README, RELEASE_NOTES), POSIX shell (`scripts/install_rm520n.sh`). No tests/build steps for shell+docs.

**Files affected (3):**
- Modify: `README.md` (add "If curl is missing" subsection under Quick Install)
- Modify: `scripts/install_rm520n.sh` (one defensive symlink line)
- Modify: `RELEASE_NOTES.md` (one bullet under existing vNext Improvements)

**Why no static binary, no cross-compile:**
- moparisthebest/static-curl v8.17.0 does NOT bake CA certs into the binary (verified — it uses `--with-ssl` against system OpenSSL with default CA paths). Shipping it standalone would silently fail HTTPS verification on stripped firmwares; shipping `cacert.pem` alongside is more bytes than `opkg install curl` from Entware.
- Once a user has Entware (already a documented prerequisite for QManager), `opkg install curl` is a one-line fix. Documenting that path is simpler, smaller, and uses Entware's package-management story instead of inventing a parallel one.
- The only real footgun is the BusyBox PATH gap, which is purely a documentation issue.

**Verification gate:**
- `bash -n scripts/install_rm520n.sh` exits 0
- README install section renders cleanly (no broken markdown — verify by reading the rendered subsection)
- Final commit only contains the three files listed above

---

## Task 1: README — add "If curl is missing" subsection under Quick Install

**Files:**
- Modify: `README.md` (insert new subsection between "Quick Install" command block at line 91 and the "Upgrading" subsection at line 95)

**Context:** The current Quick Install (lines 87–91) assumes `curl` is on PATH. On Quectel x5x/x6x firmwares (RM502, RM520, RM521 SimpleAdmin variants, etc.) curl is often absent, and even after `opkg install curl` the BusyBox shell's default PATH excludes `/opt/bin/`, so a bare `curl` invocation still fails. We document an explicit absolute-path fallback.

- [ ] **Step 1: Insert the new subsection**

In `README.md`, find this exact line (line 93):

```
The interactive installer fetches the latest release, verifies the SHA-256 checksum, bootstraps Entware (if needed), installs lighttpd, deploys the QManager frontend and backend, configures systemd services, and optionally sets up SSH (dropbear). Bundled dependencies (`atcli_smd11`, `sms_tool`, `jq`, `dropbear`) are installed automatically. The SSH root password is automatically set to match the web UI password during first-time onboarding. A reboot is triggered after installation.
```

Immediately AFTER this line (and before the existing `### Upgrading` heading), insert a blank line, then this exact block:

```markdown
> **If `curl` isn't available on your modem** (common on x5x/x6x firmwares like RM502, RM520, RM521), install it through Entware first, then call it by absolute path so the BusyBox shell's default `PATH` doesn't trip you up:
>
> ```sh
> opkg update && opkg install curl
> /opt/bin/curl -fsSL -o /tmp/qmanager-installer.sh \
>   https://github.com/dr-dolomite/QManager-RM520N/raw/refs/heads/main/qmanager-installer.sh && \
>   bash /tmp/qmanager-installer.sh
> ```
>
> The QManager installer creates a `/usr/bin/curl` symlink during install, so subsequent commands and OTA updates pick up `curl` from the standard PATH without manual export.
```

Note: the leading `>` on every line makes the entire fenced code block render as part of the blockquote callout — preserve that exactly. The code fence inside the blockquote uses three backticks at the start of each ` ```sh ` and ` ``` ` line (still prefixed with `> `).

- [ ] **Step 2: Verify the subsection renders correctly**

Run: `head -110 README.md | tail -25`

Expected output: shows the new blockquote subsection followed immediately by `### Upgrading`, with no extra blank lines and no broken markdown. Specifically the new subsection should start with `> **If \`curl\` isn't available...`.

If you have a markdown previewer available (e.g. VS Code's preview), open the README and verify the blockquote contains a properly-rendered code block (not raw backticks).

- [ ] **Step 3: Commit**

Stage ONLY this file:

```bash
git add README.md
git commit -m "docs(readme): add curl-missing fallback to Quick Install"
```

## Scope Discipline (Task 1)

- Touch ONLY `README.md`. Do not change any other file.
- Do not reorganize other parts of the README. The new subsection slots in between Quick Install's body paragraph and the Upgrading heading — nothing else moves.
- Do not bundle any other working-tree changes (cfun-fix, discord-bot, etc.) into this commit. Use explicit `git add README.md`, never `git add .`.

---

## Task 2: install_rm520n.sh — defensive curl symlink at line ~599

**Files:**
- Modify: `scripts/install_rm520n.sh:597-600` (alongside the existing jq symlink)

**Context:** After Entware-package installation, the installer already creates `/usr/bin/jq → /opt/bin/jq` because lighttpd CGI's PATH excludes `/opt/bin/`. We mirror that for curl: if `/opt/bin/curl` exists (because the user installed it via Entware before running the installer), make sure `command -v curl` finds it from the standard PATH afterward.

- [ ] **Step 1: Add the symlink line**

In `scripts/install_rm520n.sh`, find this exact block (around lines 597–600):

```sh
        # Ensure jq is in standard PATH (lighttpd CGI won't see /opt/bin)
        [ -x /opt/bin/jq ] && ln -sf /opt/bin/jq /usr/bin/jq 2>/dev/null || true

        # coreutils-timeout
```

Replace with:

```sh
        # Ensure jq is in standard PATH (lighttpd CGI won't see /opt/bin)
        [ -x /opt/bin/jq ] && ln -sf /opt/bin/jq /usr/bin/jq 2>/dev/null || true

        # Same for curl — Entware-installed curl lands in /opt/bin/, but
        # CGI scripts and BusyBox shells don't have /opt/bin on PATH.
        [ -x /opt/bin/curl ] && ! command -v curl >/dev/null 2>&1 && \
            ln -sf /opt/bin/curl /usr/bin/curl 2>/dev/null || true

        # coreutils-timeout
```

The `! command -v curl` guard prevents clobbering a system-provided `/usr/bin/curl` if one already exists. The trailing `|| true` makes the whole compound expression `set -e`-safe (matches the surrounding style).

Note: the surrounding `install_dependencies()` block (which contains line ~599) already runs in a context where `/` has been remounted read-write for installation — confirm by reading lines 320–340 of `install_rm520n.sh` (the early `mount -o remount,rw /` is performed once per install run). No additional remount is needed for this symlink.

- [ ] **Step 2: Verify syntax**

Run: `bash -n scripts/install_rm520n.sh`
Expected: exit 0, no output.

- [ ] **Step 3: Verify the new line is present and correctly placed**

Run: `grep -n -A1 'Same for curl' scripts/install_rm520n.sh`

Expected: shows the comment line and the `[ -x /opt/bin/curl ] && ! command -v curl ...` line, located between the jq symlink (line ~599) and the coreutils-timeout block.

- [ ] **Step 4: Commit**

```bash
git add scripts/install_rm520n.sh
git commit -m "feat(installer): symlink /opt/bin/curl to /usr/bin/curl when present"
```

## Scope Discipline (Task 2)

- Touch ONLY `scripts/install_rm520n.sh`. No other file.
- Add only the four-line block (comment + `[ -x ... ] && ... ln -sf ... || true`) shown above. Do not refactor surrounding logic.
- Do not bundle unrelated working-tree changes. Use explicit `git add`.
- Verify the `! command -v curl` guard is preserved exactly — it prevents overwriting a real system curl.

---

## Task 3: RELEASE_NOTES.md — note the documented fallback

**Files:**
- Modify: `RELEASE_NOTES.md` (existing "vNext (Unreleased)" Improvements section)

**Context:** The previous wget-removal work already added a vNext Improvements bullet noting the curl-only switch. We append a second bullet pointing users to the README fallback if curl is missing on their firmware.

- [ ] **Step 1: Append the bullet**

In `RELEASE_NOTES.md`, locate this exact existing bullet under `## 🛠️ Improvements` in the `# 🚀 QManager RM520N BETA vNext (Unreleased)` section:

```markdown
- Removed wget dependency from installer, OTA updater, and runtime CGIs — QManager now uses curl exclusively. This makes installs reliable on Quectel x5x/x6x firmwares that lack wget, and removes the ~5 MB Entware wget footprint that previous fallbacks would have required.
```

Immediately AFTER that bullet, on the next line, append this new bullet:

```markdown
- Documented a one-step fallback for modems whose base firmware ships without `curl` (common on x5x/x6x platforms like RM502/RM520/RM521): `opkg install curl`, then bootstrap with `/opt/bin/curl`. The installer now also creates a `/usr/bin/curl` symlink to the Entware copy when it deploys, so subsequent OTA updates and CGI calls work without manual `PATH` exports.
```

- [ ] **Step 2: Verify the file**

Run: `head -15 RELEASE_NOTES.md`

Expected: the vNext header is on line 1, the New Features section comes next (cfun-fix bullet — added by the user), the Improvements heading follows, the wget-removal bullet is intact, and the new fallback bullet appears immediately after it.

- [ ] **Step 3: Commit**

```bash
git add RELEASE_NOTES.md
git commit -m "docs(release): note curl-missing fallback path"
```

## Scope Discipline (Task 3)

- Touch ONLY `RELEASE_NOTES.md`. No other file.
- Append the new bullet only inside the existing `# 🚀 QManager RM520N BETA vNext (Unreleased)` block. Do NOT modify any tagged/shipped release section (v0.1.7 and earlier are immutable).
- The user has already added a "New Features" bullet about cfun-fix to the same vNext section in the working tree (uncommitted). Your edit to `RELEASE_NOTES.md` will land on top of those user changes — make sure your `git add RELEASE_NOTES.md` does NOT accidentally stage the user's cfun-fix bullet for your commit. To avoid this, use the targeted-hunk pattern:
  ```
  git diff RELEASE_NOTES.md          # review what's there before
  git add -p RELEASE_NOTES.md        # stage ONLY the new bullet hunk; deny all other hunks (n)
  git diff --cached RELEASE_NOTES.md # confirm only your one bullet is staged
  git commit -m "docs(release): note curl-missing fallback path"
  ```
  After the commit, verify `git status` still shows `RELEASE_NOTES.md` as `M` (modified) — meaning the user's cfun-fix bullet is preserved unstaged for them to commit themselves.

---

## Task 4: Final verification

**Files:** none modified — verification gate.

- [ ] **Step 1: Confirm only the three intended files are in the new commits**

Run: `git log --oneline main..HEAD` (after creating a feature branch — see optional Step 0 below) OR `git log --oneline -3` if working directly on main.

Expected: exactly 3 new commits with the messages defined above:
1. `docs(readme): add curl-missing fallback to Quick Install`
2. `feat(installer): symlink /opt/bin/curl to /usr/bin/curl when present`
3. `docs(release): note curl-missing fallback path`

- [ ] **Step 2: Confirm working-tree user changes are still preserved**

Run: `git status --short`

Expected: still shows the user's pre-existing modifications and untracked files exactly as they were before this plan started:
- `M app/monitoring/discord-bot/page.tsx`
- `M components/monitoring/discord-bot-card.tsx`
- `M package.json`
- `M scripts/install_rm520n.sh` (the cfun-fix line)
- `M RELEASE_NOTES.md` (the cfun-fix bullet — user's content)
- `?? docs/cfun-0-fix-analysis.md`
- `?? scripts/etc/systemd/system/qmanager-cfun-fix.service`
- `?? scripts/usr/bin/qmanager_cfun_fix`

If any of those files disappeared or got committed, STOP — investigate which task accidentally bundled them.

- [ ] **Step 3: Re-confirm the installer is still syntactically clean**

Run: `bash -n scripts/install_rm520n.sh`

Expected: exit 0, no output.

- [ ] **Step 4: (Optional) Smoke-read the rendered README**

If GitHub or a markdown viewer is available, open `README.md` and confirm:
- The Quick Install section renders normally
- The new "If curl is missing" blockquote appears between the install command paragraph and the Upgrading heading
- The code block inside the blockquote is properly fenced (not raw backticks)

If the markdown is broken, the most likely cause is a missing `>` prefix on one of the blockquote lines.

---

## Optional Step 0: Create a feature branch

If you want to keep these three commits isolated for code review or selective rollback, create a branch before Task 1:

```bash
git checkout -b feature/curl-missing-fallback-docs
```

Then merge or rebase to main after Task 4 passes (use the `git branch -f` / fast-forward pattern from the wget-removal merge, since the user has uncommitted working-tree changes that must be preserved).

If you don't care about isolation (small, low-risk docs+symlink change), commit directly on `main`. Either is fine for a 3-file mechanical change.

---

## Self-Review Checklist (already applied)

- **Spec coverage:** All three pieces of the user-confirmed scope are covered: README install fallback (Task 1), defensive `/usr/bin/curl` symlink (Task 2), RELEASE_NOTES bullet (Task 3). The user explicitly nodded to all three.
- **Placeholders:** None. Every Edit shows full old/new text. Every command shows expected output.
- **Type/identifier consistency:** Symlink target path (`/opt/bin/curl → /usr/bin/curl`) is identical across Task 2 implementation, README description, and RELEASE_NOTES bullet. The `! command -v curl` guard pattern matches the surrounding `[ -x /opt/bin/jq ] && ln -sf ... || true` idiom in the same file.
- **Side-effect risk:** The symlink only fires when (a) `/opt/bin/curl` exists AND (b) no `curl` is currently on PATH. Both clauses are guarded — the line is a no-op if either condition fails, so it can't break installs where curl already exists in `/usr/bin/` or `/bin/`.
- **User-changes preservation:** Task 3 explicitly uses `git add -p` to avoid co-staging the user's uncommitted cfun-fix bullet in the same RELEASE_NOTES.md file. Task 4 verifies preservation post-implementation.
