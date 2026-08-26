# QManager GUI Installer — Design

**Date:** 2026-08-26
**Status:** Approved design, pending implementation plan
**Sub-project directory:** `installer-gui/`

---

## 1. Why this exists

QManager installs today by fetching a bootstrap script and a release tarball from
GitHub. GitHub is unreachable from mainland China, so the entire install path is
dead for those users — including Lae, for whom this was requested.

The blockage is narrower than it looks. Only **two** links in the chain touch
GitHub:

1. `qmanager-installer.sh` — the bootstrap, fetched over HTTPS from the repo.
2. `qmanager.tar.gz` — the release artifact, fetched from the GitHub releases API.

Everything downstream of those two is local to the device or reaches
`bin.entware.net`, which **is** accessible from China (confirmed before this
design was written). `install_rm520n.sh` bootstraps Entware from
`http://bin.entware.net/${ENTWARE_ARCH}/installer` and installs optional packages
from the same mirror; it never touches GitHub itself.

So: carry the tarball to the device over USB and run the bundled installer, and
the China problem disappears without hosting anything. A GUI is the right shape
for that because the audience is not shell-fluent, and because the manual
alternative (`adb push` + `adb shell`) is exactly the friction that produces
half-installed devices.

## 2. Facts this design rests on

Each verified against the repository or the project's own hardware records before
the design was fixed. They are recorded here because several of them are
counter-intuitive and a future reader will otherwise re-derive them the hard way.

| Fact | Source | Consequence |
| --- | --- | --- |
| `build.sh` already emits a fully self-contained `qmanager-build/qmanager.tar.gz` (5.5 MB) plus `sha256sum.txt` | `build.sh:214-218` | Nothing new needs building. The GUI embeds the existing artifact verbatim. |
| `install_rm520n.sh` is idempotent, and fresh-vs-upgrade is decided **on-device** by the presence of `/etc/qmanager/VERSION` | `scripts/install_rm520n.sh:3417-3423` | The GUI *detects and reports* the mode; it never asks the user to choose one. |
| The installer's only interactive prompt auto-proceeds when no tty is available, and `--force` suppresses it entirely | `scripts/install_rm520n.sh:459-479, 3622` | The GUI drives it with flags, not with a pseudo-terminal. |
| Entware is bootstrapped from `bin.entware.net` at install time | `scripts/install_rm520n.sh:1022-1029` | The one remaining network dependency. It is China-reachable, but must be verified *before* an install starts, not discovered three minutes in. |
| ADB is **not** guaranteed to be present. A factory reset reverts USB composition to `0x2C7C,0x0800`, which has no ADB interface; restoring it needs an `AT+QCFG="usbcfg"` write | `docs/superpowers/plans/2026-08-24-phase-a-tracker.md:145`, `...-phase-a-log-archive.md:260` | "Just adb push" has a real failure mode on exactly the fresh devices this targets. The GUI must detect and explain it. |
| Rethink Sans and JetBrains Mono are loaded through `next/font` from Google Fonts | `app/globals.css:87` | Google Fonts is blocked in China. The GUI bundles both as local woff2; it cannot inherit the app's font loading. |
| Failure on this platform is signalled by **exit status only** — `ERROR` never reaches stdout | `docs/reference/at-command-transport.md`, memory `reference_qcmd_failure_is_stderr_and_exit_code` | Exit-code fidelity across the transport is a correctness requirement, not a nicety. See §4.2. |

## 3. Scope

**In scope (v1):**

- Windows-only GUI installer, hand-delivered (no auto-update, no phone-home).
- ADB transport and SSH transport, both implemented from the start behind one interface.
- Preflight detection: device identity, model tier, SimpleAdmin conflict, existing
  QManager version, disk space, Entware reachability.
- Four actions: Install, Upgrade, Repair (reinstall same version), Uninstall.
- Reboot control (exposes the installer's `--no-reboot`).
- English and Simplified Chinese, in externally editable locale files.

**Explicitly out of scope (v1):**

- Any `AT+QCFG` write. The GUI never modifies USB composition; it detects the
  missing ADB interface and instructs.
- Uninstalling SimpleAdmin on the user's behalf.
- Self-update of the GUI.
- macOS and Linux binaries. The source stays free of Windows-isms where that
  costs nothing, but only a Windows build ships.
- USB driver installation.

## 4. Architecture

### 4.1 Stack and layering

Python 3.12, `pywebview` over Edge WebView2 (present on every Windows 11
install), packaged by PyInstaller in **onedir** mode.

Onedir rather than onefile is a requirement, not a preference: the locale files
must sit beside the executable as plain, editable JSON so a Chinese speaker can
correct them and send the file back. A onefile build buries them in a temp
extraction directory.

Two layers with a hard boundary:

- **`core/`** — pure Python. No UI imports, no `pywebview`. Every decision the
  installer makes is made here and is testable against a fake transport.
- **`ui/`** — static HTML/CSS/JS. Reaches `core` only through `bridge.py`, a
  deliberately narrow JS-callable surface.

The boundary exists so that the entire preflight matrix — the part most likely to
be wrong — can be tested without a browser, a device, or a human.

### 4.2 Transport

```python
class Transport(ABC):
    def probe(self) -> DeviceInfo | None
    def push(self, local: Path, remote: str) -> None
    def exec(self, cmd: str, timeout: int) -> Result   # exit, stdout, stderr
    def exec_stream(self, cmd: str, on_line: Callable[[str], None]) -> int
    def close(self) -> None
```

Two implementations: `AdbTransport` (bundled `adb.exe`, addressed as
`adb -s <serial>`) and `SshTransport` (paramiko).

**Exit-code fidelity is the single most important correctness detail in this
sub-project.** `adb shell` does not reliably propagate the remote command's exit
status — it returns adb's own. Combined with the platform rule that failures are
exit-code-only and produce no parseable stdout, a naive `adb shell` wrapper would
report a failed install as a success. That is the exact class of bug this project
has been bitten by before.

`AdbTransport.exec` therefore wraps every command:

```sh
sh -c '<cmd>; echo __QM_RC=$?'
```

and parses the sentinel. **A missing sentinel is treated as failure**, never as
success — that covers the case where the shell itself died. `SshTransport` takes
the real status from the channel and additionally asserts it agrees with the
sentinel, so the two transports cannot diverge silently.

### 4.3 Payload

`build_installer.py` embeds, at build time, from `../qmanager-build/`:

- `qmanager.tar.gz` (the artifact `build.sh` already produced — never a re-roll)
- `sha256sum.txt`
- the version string

One source of truth. The build fails if `qmanager-build/` is stale or absent
rather than shipping a mismatched payload.

After pushing, the GUI **re-verifies sha256 on the device** and refuses to extract
on mismatch. A truncated or corrupted push is otherwise invisible until the
install fails somewhere far downstream.

### 4.4 Design-language fidelity

`build_installer.py` extracts the `:root` and `.dark` token blocks directly from
`../app/globals.css` into a generated `ui/tokens.css`, and bundles Rethink Sans
and JetBrains Mono as local woff2 files.

The installer therefore cannot drift from `DESIGN.md` canon: a token change in
the app propagates on the next installer build, and there is no hand-maintained
copy of the palette to fall out of date. The generated file is not edited by
hand and is not the place to add installer-specific colours.

The UI follows the project's shipped conventions — filled tonal status chips with
a mandatory glyph, `Tag`-style outline treatment for identity and metadata, the
role radius scale, and both light and dark themes.

## 5. Flow

### 5.1 Preflight

Each check yields `Check(id, state, detail)` and renders as a status chip. Ordered,
short-circuiting on a block.

| # | Check | Block? | Notes |
| --- | --- | --- | --- |
| 1 | `adb.exe` present, adb server starts | yes | Toolchain sanity. |
| 2 | Device present (`adb devices -l`) | yes | None found → the "enable ADB first" screen. Detect and instruct only. |
| 3 | Prove which device answered | yes | `cat /etc/quectel-project-version` **and** `grep -o 'androidboot.serialno=[^ ]*' /proc/cmdline`, both displayed. Two modems can be plugged in at once; a wrong-device capture fails silently otherwise. |
| 4 | Model gate | partly | `RM520N*` supported · `RG501Q*` community-tier warning · `RM551E*` hard block (wrong installer) · other, warn and allow. Mirrors the installer's own `case` arms exactly. |
| 5 | SimpleAdmin conflict | yes | Markers in §5.2. |
| 6 | Existing QManager (`/etc/qmanager/VERSION`) | no | Selects the action label: Install / Upgrade vX→vY / Repair. |
| 7 | Free space (`df /tmp`) | yes | Headroom for the 5.5 MB tarball plus extraction. |
| 8 | Entware reachability **from the device** | no (warn) | `wget -T 8 -O /dev/null http://bin.entware.net/`. |

Check 8 earns its place: `bin.entware.net` is the one genuine network dependency
left, and it is the entire reason this sub-project exists. Telling a user in China
that their device cannot reach the package mirror *before* a three-minute install
is worth more than any other check in the list. It warns rather than blocks,
because Entware may already be present from a previous install.

### 5.2 SimpleAdmin conflict — hard block

Detected by any of:

- directory `/usrdata/simpleadmin`
- directory `/usrdata/simpleupdates`
- unit `/lib/systemd/system/simpleadmin_httpd.service`
- unit `/lib/systemd/system/simpleadmin_generate_status.service`

On a hit the GUI refuses to install and names precisely which markers were found,
pointing at the toolkit's own uninstall path.

QManager does not delete another project's files. Forks diverge in layout, the
toolkit's uninstall is interactive and carries a TTL warning the user should read
with their own eyes, and a partial removal leaves a device with neither panel
working. Blocking is the honest boundary.

### 5.3 Install run

```
push → /tmp/qmanager.tar.gz
sha256 verify on device        (refuse to continue on mismatch)
rm -rf /tmp/qmanager_install
tar xzf /tmp/qmanager.tar.gz -C /tmp
bash /tmp/qmanager_install/install_rm520n.sh --force [--no-reboot]
```

Streamed line by line into a log pane.

`--force` is deliberate. The GUI has already performed the model gate itself, in a
UI where the user can actually read the result, so the installer's tty prompt is
redundant — and it is the flag every OTA upgrade already passes.

Progress is derived from the installer's own step lines, degrading to an
indeterminate state if that format ever changes. **The log pane is the real
feedback; the progress bar is a courtesy.** Nothing about correctness may depend
on parsing progress output.

### 5.4 Reboot

Default on, with a toggle, and a plain-English line explaining that the reboot is
what activates the services.

When the reboot fires the transport dies **by design**. The GUI shows "device
rebooting", polls for the device to return, then shows the panel URL. A dropped
connection during the reboot window is a success path and must be coded as one —
treating it as an error would report every default install as a failure.

### 5.5 Actions

| Action | Condition | Behaviour |
| --- | --- | --- |
| Install | no `/etc/qmanager/VERSION` | Standard run. |
| Upgrade | installed version older than payload | Same run; label shows vX→vY. |
| Repair | installed version equals payload | Same run, relabelled. Fixes a broken deploy. |
| Uninstall | QManager present | Runs the bundled `uninstall_rm520n.sh` over the transport, behind its own confirmation gate. |

## 6. Error handling

Every failure is typed and reported as: the step that failed, the exact command
issued, the exit code, the last lines of stderr, and one suggested action. A raw
traceback never reaches the user.

The full session — every command, every line of output — is written to
`qmanager-install-<serial>-<timestamp>.log` beside the executable. When a user in
China hits a failure neither they nor Lae can see, they send one file.

## 7. Internationalisation

`locales/en.json` and `locales/zh-CN.json` sit beside the executable. Flat
`key → string`, UTF-8.

`locales/README.md` — written in both languages — explains how to edit and return
a translation.

Missing keys fall back to English **and are logged**, so a partial translation
still ships and the gaps are one diff away. A test asserts key-set parity between
locales, so a newly added UI string cannot silently become untranslatable.

## 8. Testing

`core/` is exercised against a `FakeTransport`, with no browser and no device:

- the full preflight matrix — each model arm, SimpleAdmin present and absent,
  `VERSION` absent / older / equal
- sha256 mismatch refusal
- the `__QM_RC=` exit-code parser, **including the missing-sentinel case**
- locale key parity

The UI is verified by hand against the live RM520N-GL.

**The first end-to-end run must be an upgrade on the RM520N-GL, never a fresh
install** — an upgrade is the recoverable direction, and the device already has a
working panel to fall back to.

## 9. Directory layout

```
installer-gui/
  README.md
  pyproject.toml
  build_installer.py          # PyInstaller driver; embeds payload, generates tokens.css
  src/qmanager_installer/
    __main__.py
    app.py                    # pywebview window
    bridge.py                 # JS-callable API surface
    i18n.py
    core/
      transport/
        base.py  adb.py  ssh.py
      preflight.py
      installer.py            # push → verify → extract → run → stream
      uninstall.py
      device.py               # DeviceInfo, model tiers
      payload.py              # embedded tarball, sha, version
      logging.py
    ui/
      index.html
      app.js
      styles.css
      tokens.css              # GENERATED from ../app/globals.css — do not edit
      fonts/
  locales/
    en.json  zh-CN.json  README.md
  vendor/adb/                 # adb.exe + AdbWinApi.dll + AdbWinUsbApi.dll (all three required)
  tests/
```

## 10. Open questions

One, non-blocking:

- Exact progress-line format emitted by `install_rm520n.sh`, to be read from the
  script rather than assumed. The indeterminate fallback means getting this wrong
  degrades presentation only.

**Settled 2026-08-26:** `SshTransport` is **password authentication only** in v1.
The devices in hand use password auth, and key handling would add a key-discovery
and passphrase-prompt surface to a GUI whose audience is explicitly not
shell-fluent.
