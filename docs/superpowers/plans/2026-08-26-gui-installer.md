# QManager GUI Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `installer-gui/` — a Windows GUI that installs QManager onto a Quectel modem over ADB or SSH with no GitHub access, for users behind the Great Firewall.

**Architecture:** A pure-Python `core/` layer (transport, preflight, install orchestration) with zero UI imports, driven by a `pywebview` UI that renders real HTML/CSS using design tokens extracted from `app/globals.css` at build time. The 5.5 MB `qmanager.tar.gz` that `build.sh` already produces is embedded in the executable, pushed to `/tmp`, sha256-verified on the device, and installed by the bundled `install_rm520n.sh`.

**Tech Stack:** Python 3.12, pywebview (Edge WebView2), paramiko, PyInstaller (onedir), pytest, Google platform-tools `adb.exe`.

**Spec:** `docs/superpowers/specs/2026-08-26-gui-installer-design.md` — read it before Task 1. The plan argues from the spec; both travel together.

## Global Constraints

- **Python 3.12.** Windows only. No `os.system`, no shell string interpolation of user input into local commands.
- **`core/` must never import `webview`, `bridge`, or anything under `ui/`.** A test enforces this (Task 12). The boundary is what makes the preflight matrix testable without a device.
- **Failure on this platform is exit-code-only.** `ERROR` never reaches stdout. Never infer success from output text; always check the exit code. A missing `__QM_RC=` sentinel is failure, never success.
- **Never mutate the device outside the documented commands.** No `AT+QCFG` writes, no touching SimpleAdmin's files, no `AT+CFUN=1,1`.
- **All user-visible strings go through `i18n.t()`.** A literal string in `ui/` or `bridge.py` is a bug — Task 10's parity test only guards keys that exist.
- **Status chips carry a glyph, never colour alone.** `success-container` and `warning-container` are 1.03:1 apart and identical under deuteranopia.
- **Payload version is stamped from `../qmanager-build/`,** never typed by hand.
- Line endings: `.py`, `.json`, `.css`, `.js`, `.html` are LF. The repo has `core.autocrlf=true`, so verify with `git show` if a diff looks suspicious.

---

## File Structure

```
installer-gui/
  README.md                   # how to build; how to obtain adb + fonts
  pyproject.toml              # deps, pytest config
  .gitignore                  # payload/, vendor/adb/, build/, dist/, .venv/, __pycache__/
  build_installer.py          # token extraction + payload embed + PyInstaller driver
  src/qmanager_installer/
    __main__.py               # entry point
    app.py                    # pywebview window bootstrap
    bridge.py                 # JS-callable API surface (the ONLY core↔ui seam)
    i18n.py                   # locale loading, fallback, missing-key log
    core/
      __init__.py
      transport/
        base.py               # Result, Transport ABC, RC sentinel, ANSI strip
        adb.py                # AdbTransport + device enumeration
        ssh.py                # SshTransport (password auth only)
      device.py               # DeviceInfo, model tier classification
      preflight.py            # Check, PreflightReport, the 8 checks
      payload.py              # embedded tarball / sha / version accessor
      installer.py            # push → verify → extract → run → stream
      uninstall.py            # uninstall_rm520n.sh runner
      session_log.py          # per-run log file
    ui/
      index.html  app.js  styles.css
      tokens.css              # GENERATED — do not edit
      fonts/
  locales/en.json  locales/zh-CN.json  locales/README.md
  vendor/adb/                 # adb.exe + AdbWinApi.dll + AdbWinUsbApi.dll
  payload/                    # GENERATED — qmanager.tar.gz, sha256sum.txt, VERSION
  tests/
```

**Deviation from spec §5.4, adopted deliberately:** the runner always invokes
`install_rm520n.sh` with `--no-reboot`, then issues `sync; reboot` as a separate
command when the user asked for a reboot. The spec's approach — letting the
installer reboot and treating the dropped transport as success — makes a genuine
mid-install failure indistinguishable from a normal reboot, because the exit code
never comes back. Separating them means the installer's exit code **always**
reaches us, which the Global Constraints require. Documented here so a reader of
the spec isn't surprised.

---

### Task 1: Sub-project scaffold and payload accessor

**Files:**
- Create: `installer-gui/pyproject.toml`, `installer-gui/.gitignore`, `installer-gui/README.md`
- Create: `installer-gui/src/qmanager_installer/__init__.py`, `installer-gui/src/qmanager_installer/core/__init__.py`
- Create: `installer-gui/src/qmanager_installer/core/payload.py`
- Test: `installer-gui/tests/test_payload.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `Payload` (frozen dataclass: `tarball: Path`, `sha256: str`, `version: str`), `load_payload(root: Path) -> Payload`, `PayloadError`.

- [ ] **Step 1: Create the project skeleton**

`installer-gui/pyproject.toml`:

```toml
[project]
name = "qmanager-installer"
version = "0.1.0"
description = "QManager GUI installer for Quectel modems"
requires-python = ">=3.12"
dependencies = [
    "pywebview>=5.1",
    "paramiko>=3.4",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "pyinstaller>=6.6"]

[build-system]
requires = ["setuptools>=69"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["src"]
```

`installer-gui/.gitignore`:

```
payload/
vendor/adb/
build/
dist/
.venv/
__pycache__/
*.pyc
src/qmanager_installer/ui/tokens.css
*.log
```

Create empty `src/qmanager_installer/__init__.py` and `src/qmanager_installer/core/__init__.py`.

`installer-gui/README.md`:

```markdown
# QManager GUI Installer

Windows GUI that installs QManager onto a Quectel modem over ADB or SSH,
without any GitHub access. Design: `docs/superpowers/specs/2026-08-26-gui-installer-design.md`.

## One-time setup

1. `py -3.12 -m venv .venv && .venv\Scripts\pip install -e ".[dev]"`
2. **adb** — download Google platform-tools for Windows and copy exactly three
   files into `vendor/adb/`: `adb.exe`, `AdbWinApi.dll`, `AdbWinUsbApi.dll`.
   All three are required; adb fails at runtime without the DLLs.
3. **Fonts** — place `RethinkSans-Variable.woff2` and `JetBrainsMono-Regular.woff2`
   in `src/qmanager_installer/ui/fonts/`. Google Fonts is blocked in China, so
   these must be bundled locally; the UI falls back to system sans/mono if absent.

Both directories are gitignored — they are binary redistributables, not source.

## Build

    bun run package          # in the repo root, produces qmanager-build/qmanager.tar.gz
    .venv\Scripts\python build_installer.py

Output: `dist/QManagerInstaller/` — ship the whole folder, not just the .exe.

## Test

    .venv\Scripts\pytest
```

- [ ] **Step 2: Write the failing test**

`installer-gui/tests/test_payload.py`:

```python
import pytest

from qmanager_installer.core.payload import Payload, PayloadError, load_payload

HASH = "a" * 64


def _write_payload(root, *, sha=HASH, version="v0.1.14", body=b"tar-bytes"):
    d = root / "payload"
    d.mkdir()
    (d / "qmanager.tar.gz").write_bytes(body)
    (d / "sha256sum.txt").write_text(f"{sha}  qmanager.tar.gz\n", encoding="utf-8")
    (d / "VERSION").write_text(f"{version}\n", encoding="utf-8")
    return d


def test_loads_tarball_sha_and_version(tmp_path):
    _write_payload(tmp_path)
    p = load_payload(tmp_path)
    assert isinstance(p, Payload)
    assert p.sha256 == HASH
    assert p.version == "v0.1.14"
    assert p.tarball.read_bytes() == b"tar-bytes"


def test_sha_is_lowercased_and_stripped_of_filename(tmp_path):
    _write_payload(tmp_path, sha=HASH.upper())
    assert load_payload(tmp_path).sha256 == HASH


def test_missing_tarball_raises(tmp_path):
    d = _write_payload(tmp_path)
    (d / "qmanager.tar.gz").unlink()
    with pytest.raises(PayloadError, match="qmanager.tar.gz"):
        load_payload(tmp_path)


def test_malformed_sha_raises(tmp_path):
    d = _write_payload(tmp_path)
    (d / "sha256sum.txt").write_text("not-a-hash\n", encoding="utf-8")
    with pytest.raises(PayloadError, match="sha256"):
        load_payload(tmp_path)


def test_empty_version_raises(tmp_path):
    d = _write_payload(tmp_path)
    (d / "VERSION").write_text("\n", encoding="utf-8")
    with pytest.raises(PayloadError, match="VERSION"):
        load_payload(tmp_path)
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `.venv\Scripts\pytest tests/test_payload.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'qmanager_installer.core.payload'`

- [ ] **Step 4: Implement `core/payload.py`**

```python
"""Access to the QManager release artifact embedded at build time.

`build_installer.py` copies `qmanager-build/{qmanager.tar.gz,sha256sum.txt}` and
a stamped VERSION file into `payload/`. Nothing here re-rolls the tarball: the
artifact `build.sh` produced is the one that ships, byte for byte.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class PayloadError(RuntimeError):
    """The embedded payload is missing or malformed."""


@dataclass(frozen=True)
class Payload:
    tarball: Path
    sha256: str
    version: str


def payload_root() -> Path:
    """Directory holding the payload, both frozen and running from source."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parents[3]


def load_payload(root: Path | None = None) -> Payload:
    base = (root or payload_root()) / "payload"

    tarball = base / "qmanager.tar.gz"
    if not tarball.is_file():
        raise PayloadError(f"Missing qmanager.tar.gz at {tarball}")

    sha_file = base / "sha256sum.txt"
    if not sha_file.is_file():
        raise PayloadError(f"Missing sha256sum.txt at {sha_file}")
    # Format is `<hash>  <filename>` — take the first field only.
    fields = sha_file.read_text(encoding="utf-8").strip().split()
    sha = fields[0].lower() if fields else ""
    if not SHA256_RE.match(sha):
        raise PayloadError(f"Malformed sha256 in {sha_file}: {sha!r}")

    version_file = base / "VERSION"
    if not version_file.is_file():
        raise PayloadError(f"Missing VERSION at {version_file}")
    version = version_file.read_text(encoding="utf-8").strip()
    if not version:
        raise PayloadError(f"Empty VERSION at {version_file}")

    return Payload(tarball=tarball, sha256=sha, version=version)
```

- [ ] **Step 5: Run tests and confirm they pass**

Run: `.venv\Scripts\pytest tests/test_payload.py -v`
Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
git add installer-gui/pyproject.toml installer-gui/.gitignore installer-gui/README.md \
        installer-gui/src installer-gui/tests
git commit -m "feat(installer-gui): scaffold sub-project and payload accessor"
```

---

### Task 2: Transport base — the exit-code sentinel

**Files:**
- Create: `installer-gui/src/qmanager_installer/core/transport/__init__.py`
- Create: `installer-gui/src/qmanager_installer/core/transport/base.py`
- Test: `installer-gui/tests/test_transport_base.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `Result(exit_code:int, stdout:str, stderr:str)` with `.ok`; `Transport` ABC with `probe/push/exec/exec_stream/close`; `wrap_command(cmd:str)->str`; `parse_rc(raw:str)->tuple[str,int]`; `strip_ansi(s:str)->str`; `MISSING_SENTINEL_RC = 255`; exceptions `TransportError`, `DeviceGoneError`.

**This is the most important task in the plan.** `adb shell` returns *adb's* exit
status, not the remote command's. On a platform where failure is signalled by exit
code alone and produces no parseable output, a naive wrapper reports a failed
install as a success. Everything downstream trusts `Result.exit_code`.

- [ ] **Step 1: Write the failing test**

`installer-gui/tests/test_transport_base.py`:

```python
from qmanager_installer.core.transport.base import (
    MISSING_SENTINEL_RC,
    Result,
    parse_rc,
    strip_ansi,
    wrap_command,
)


def test_wrap_appends_sentinel():
    assert wrap_command("ls /tmp") == "ls /tmp; echo __QM_RC=$?"


def test_parse_rc_success():
    body, rc = parse_rc("hello\nworld\n__QM_RC=0\n")
    assert rc == 0
    assert body == "hello\nworld"


def test_parse_rc_nonzero():
    _, rc = parse_rc("boom\n__QM_RC=1\n")
    assert rc == 1


def test_parse_rc_tolerates_trailing_blank_lines():
    body, rc = parse_rc("out\n__QM_RC=7\n\n\n")
    assert rc == 7
    assert body == "out"


def test_parse_rc_tolerates_carriage_returns():
    # adb shell hands back CRLF on Windows.
    _, rc = parse_rc("out\r\n__QM_RC=3\r\n")
    assert rc == 3


def test_missing_sentinel_is_failure_not_success():
    # The shell died before echoing. Reporting 0 here would call a failed
    # install a success — the exact bug this module exists to prevent.
    body, rc = parse_rc("partial output with no sentinel\n")
    assert rc == MISSING_SENTINEL_RC
    assert body == "partial output with no sentinel\n"


def test_non_numeric_sentinel_is_failure():
    _, rc = parse_rc("out\n__QM_RC=notanumber\n")
    assert rc == MISSING_SENTINEL_RC


def test_sentinel_text_inside_output_is_not_mistaken_for_the_real_one():
    # A log line mentioning the sentinel must not shadow the real trailing one.
    body, rc = parse_rc("echoing __QM_RC=0 in a log line\n__QM_RC=1\n")
    assert rc == 1
    assert "echoing" in body


def test_strip_ansi_removes_colour_codes():
    assert strip_ansi("\x1b[0;32m*\x1b[0m ok") == "* ok"


def test_result_ok():
    assert Result(0, "", "").ok
    assert not Result(1, "", "").ok
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `.venv\Scripts\pytest tests/test_transport_base.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement `core/transport/base.py`**

```python
"""Transport abstraction and the exit-code sentinel.

`adb shell` does not propagate the remote command's exit status — it returns
adb's own. On this platform a failure produces NO parseable stdout (`ERROR`
never reaches it), so trusting adb's status would report a failed install as a
success. Every command is therefore wrapped to echo its real status, and a
MISSING sentinel is treated as failure.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

RC_SENTINEL = "__QM_RC="
MISSING_SENTINEL_RC = 255

_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")


class TransportError(RuntimeError):
    """The transport itself failed (not the remote command)."""


class DeviceGoneError(TransportError):
    """The device disappeared mid-operation — unplugged, or rebooting."""


@dataclass(frozen=True)
class Result:
    exit_code: int
    stdout: str
    stderr: str

    @property
    def ok(self) -> bool:
        return self.exit_code == 0


def strip_ansi(text: str) -> str:
    return _ANSI_RE.sub("", text)


def wrap_command(cmd: str) -> str:
    return f"{cmd}; echo {RC_SENTINEL}$?"


def parse_rc(raw: str) -> tuple[str, int]:
    """Split a wrapped command's output into (body, exit_code).

    Scans from the END so a log line quoting the sentinel cannot shadow the
    real one. A missing or non-numeric sentinel yields MISSING_SENTINEL_RC and
    the untouched raw text, so the caller still sees whatever was produced.
    """
    lines = raw.splitlines()
    for i in range(len(lines) - 1, -1, -1):
        line = lines[i].strip()
        if not line:
            continue
        if line.startswith(RC_SENTINEL):
            digits = line[len(RC_SENTINEL) :].strip()
            if digits.isdigit():
                return "\n".join(lines[:i]), int(digits)
            return raw, MISSING_SENTINEL_RC
        # First non-blank line from the end is not the sentinel — it is missing.
        break
    return raw, MISSING_SENTINEL_RC


class Transport(ABC):
    """One device, one connection. Implementations: AdbTransport, SshTransport."""

    @abstractmethod
    def describe(self) -> str:
        """Short human label, e.g. 'ADB 61368cd2' or 'SSH 192.168.225.1'."""

    @abstractmethod
    def push(self, local: Path, remote: str) -> None:
        """Copy a local file to the device. Raises TransportError on failure."""

    @abstractmethod
    def exec(self, cmd: str, timeout: int = 60) -> Result:
        """Run a shell command, returning its REAL exit code."""

    @abstractmethod
    def exec_stream(self, cmd: str, on_line: Callable[[str], None], timeout: int = 1800) -> int:
        """Run a command, delivering ANSI-stripped lines live. Returns exit code."""

    @abstractmethod
    def close(self) -> None: ...
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `.venv\Scripts\pytest tests/test_transport_base.py -v`
Expected: 10 passed

- [ ] **Step 5: Commit**

```bash
git add installer-gui/src/qmanager_installer/core/transport installer-gui/tests/test_transport_base.py
git commit -m "feat(installer-gui): transport ABC with exit-code sentinel

adb shell returns adb's status, not the remote command's, and this platform
signals failure by exit code alone. A missing sentinel is failure, never
success."
```

---

### Task 3: AdbTransport

**Files:**
- Create: `installer-gui/src/qmanager_installer/core/transport/adb.py`
- Test: `installer-gui/tests/test_transport_adb.py`

**Interfaces:**
- Consumes: `Result`, `Transport`, `wrap_command`, `parse_rc`, `strip_ansi`, `TransportError`, `DeviceGoneError` from Task 2.
- Produces: `AdbDevice(serial:str, state:str, model:str|None)`; `list_devices(adb_path:Path, runner=...) -> list[AdbDevice]`; `AdbTransport(adb_path:Path, serial:str, runner=..., popen=...)`.

`state` is one of `device`, `unauthorized`, `offline`. Only `device` is usable, but
`unauthorized` must be reported distinctly — it means "accept the RSA prompt", a
completely different fix from "no device".

- [ ] **Step 1: Write the failing test**

`installer-gui/tests/test_transport_adb.py`:

```python
import subprocess
from pathlib import Path

import pytest

from qmanager_installer.core.transport.adb import AdbTransport, list_devices
from qmanager_installer.core.transport.base import MISSING_SENTINEL_RC, TransportError

ADB = Path("adb.exe")

DEVICES_OUT = (
    "List of devices attached\n"
    "61368cd2               device product:mdm9x targe model:RM520N transport_id:1\n"
    "b7e3d6f1               unauthorized transport_id:2\n"
    "deadbeef               offline transport_id:3\n"
    "\n"
)


def fake_runner(result_map):
    """Return a subprocess.run stand-in keyed by a substring of the argv."""
    calls = []

    def run(argv, **kwargs):
        calls.append(argv)
        joined = " ".join(argv)
        for needle, (rc, out, err) in result_map.items():
            if needle in joined:
                return subprocess.CompletedProcess(argv, rc, out, err)
        raise AssertionError(f"unexpected argv: {joined}")

    run.calls = calls
    return run


def test_list_devices_parses_states():
    run = fake_runner({"devices": (0, DEVICES_OUT, "")})
    devices = list_devices(ADB, runner=run)
    assert [(d.serial, d.state) for d in devices] == [
        ("61368cd2", "device"),
        ("b7e3d6f1", "unauthorized"),
        ("deadbeef", "offline"),
    ]
    assert devices[0].model == "RM520N"


def test_list_devices_ignores_header_and_blanks():
    run = fake_runner({"devices": (0, "List of devices attached\n\n", "")})
    assert list_devices(ADB, runner=run) == []


def test_exec_returns_remote_exit_code_not_adb_status():
    # adb exits 0 while the remote command failed with 3.
    run = fake_runner({"shell": (0, "some output\n__QM_RC=3\n", "")})
    t = AdbTransport(ADB, "61368cd2", runner=run)
    result = t.exec("false")
    assert result.exit_code == 3
    assert result.stdout == "some output"


def test_exec_targets_the_requested_serial():
    run = fake_runner({"shell": (0, "__QM_RC=0\n", "")})
    AdbTransport(ADB, "61368cd2", runner=run).exec("true")
    argv = run.calls[0]
    assert argv[1] == "-s" and argv[2] == "61368cd2"


def test_exec_strips_ansi_before_parsing():
    run = fake_runner({"shell": (0, "\x1b[0;32mok\x1b[0m\n__QM_RC=0\n", "")})
    assert AdbTransport(ADB, "s", runner=run).exec("x").stdout == "ok"


def test_exec_missing_sentinel_is_failure():
    run = fake_runner({"shell": (0, "output but no sentinel\n", "")})
    assert AdbTransport(ADB, "s", runner=run).exec("x").exit_code == MISSING_SENTINEL_RC


def test_push_raises_on_adb_failure():
    run = fake_runner({"push": (1, "", "adb: error: failed to copy\n")})
    with pytest.raises(TransportError, match="failed to copy"):
        AdbTransport(ADB, "s", runner=run).push(Path("x.tar.gz"), "/tmp/x.tar.gz")


def test_push_succeeds_quietly():
    run = fake_runner({"push": (0, "1 file pushed\n", "")})
    AdbTransport(ADB, "s", runner=run).push(Path("x.tar.gz"), "/tmp/x.tar.gz")
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `.venv\Scripts\pytest tests/test_transport_adb.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement `core/transport/adb.py`**

```python
"""ADB transport: bundled adb.exe, addressed by serial."""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .base import (
    DeviceGoneError,
    Result,
    Transport,
    TransportError,
    parse_rc,
    strip_ansi,
    wrap_command,
)

# Windows: keep the console window from flashing on every adb call.
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


@dataclass(frozen=True)
class AdbDevice:
    serial: str
    state: str          # "device" | "unauthorized" | "offline"
    model: str | None = None

    @property
    def usable(self) -> bool:
        return self.state == "device"


def _run(argv, runner, timeout):
    return runner(
        argv,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        creationflags=_NO_WINDOW,
    )


def list_devices(adb_path: Path, runner: Callable = subprocess.run, timeout: int = 20) -> list[AdbDevice]:
    proc = _run([str(adb_path), "devices", "-l"], runner, timeout)
    devices: list[AdbDevice] = []
    for line in (proc.stdout or "").splitlines():
        line = line.strip()
        if not line or line.startswith("List of devices"):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        model = None
        for token in parts[2:]:
            if token.startswith("model:"):
                model = token.split(":", 1)[1]
        devices.append(AdbDevice(serial=parts[0], state=parts[1], model=model))
    return devices


class AdbTransport(Transport):
    def __init__(
        self,
        adb_path: Path,
        serial: str,
        runner: Callable = subprocess.run,
        popen: Callable = subprocess.Popen,
    ) -> None:
        self._adb = Path(adb_path)
        self._serial = serial
        self._runner = runner
        self._popen = popen

    def describe(self) -> str:
        return f"ADB {self._serial}"

    def _argv(self, *args: str) -> list[str]:
        return [str(self._adb), "-s", self._serial, *args]

    def push(self, local: Path, remote: str) -> None:
        proc = _run(self._argv("push", str(local), remote), self._runner, timeout=600)
        if proc.returncode != 0:
            raise TransportError((proc.stderr or proc.stdout or "adb push failed").strip())

    def exec(self, cmd: str, timeout: int = 60) -> Result:
        proc = _run(self._argv("shell", wrap_command(cmd)), self._runner, timeout)
        if proc.returncode != 0 and "device .* not found" in (proc.stderr or ""):
            raise DeviceGoneError((proc.stderr or "").strip())
        body, rc = parse_rc(strip_ansi(proc.stdout or ""))
        return Result(exit_code=rc, stdout=body.strip(), stderr=strip_ansi(proc.stderr or "").strip())

    def exec_stream(self, cmd: str, on_line, timeout: int = 1800) -> int:
        # adb merges the remote stderr into stdout; keep them merged so the log
        # pane shows interleaved output in the order it was produced.
        proc = self._popen(
            self._argv("shell", wrap_command(cmd)),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            creationflags=_NO_WINDOW,
        )
        tail = ""
        assert proc.stdout is not None
        for raw in proc.stdout:
            line = strip_ansi(raw.rstrip("\r\n"))
            if line.startswith("__QM_RC="):
                tail = line
                continue
            on_line(line)
        proc.wait(timeout=timeout)
        _, rc = parse_rc(tail if tail else "")
        return rc

    def close(self) -> None:
        return None
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `.venv\Scripts\pytest tests/test_transport_adb.py -v`
Expected: 8 passed

- [ ] **Step 5: Commit**

```bash
git add installer-gui/src/qmanager_installer/core/transport/adb.py installer-gui/tests/test_transport_adb.py
git commit -m "feat(installer-gui): AdbTransport with device enumeration"
```

---

### Task 4: SshTransport

**Files:**
- Create: `installer-gui/src/qmanager_installer/core/transport/ssh.py`
- Test: `installer-gui/tests/test_transport_ssh.py`

**Interfaces:**
- Consumes: Task 2's base module.
- Produces: `SshTransport(host:str, username:str, password:str, port:int=22, client_factory=...)`.

Password authentication only — settled in the spec's §10. No key discovery, no
passphrase prompt.

- [ ] **Step 1: Write the failing test**

`installer-gui/tests/test_transport_ssh.py`:

```python
import io
from pathlib import Path

import pytest

from qmanager_installer.core.transport.base import MISSING_SENTINEL_RC, TransportError
from qmanager_installer.core.transport.ssh import SshTransport


class FakeChannel:
    def __init__(self, rc):
        self._rc = rc

    def recv_exit_status(self):
        return self._rc


class FakeStdout(io.StringIO):
    def __init__(self, text, rc):
        super().__init__(text)
        self.channel = FakeChannel(rc)


class FakeSftp:
    def __init__(self):
        self.puts = []
        self.fail = False

    def put(self, local, remote):
        if self.fail:
            raise OSError("permission denied")
        self.puts.append((local, remote))

    def close(self):
        pass


class FakeClient:
    def __init__(self, stdout_text="__QM_RC=0\n", channel_rc=0):
        self.stdout_text = stdout_text
        self.channel_rc = channel_rc
        self.connected = None
        self.commands = []
        self.sftp = FakeSftp()

    def set_missing_host_key_policy(self, policy):
        pass

    def connect(self, **kwargs):
        self.connected = kwargs

    def exec_command(self, cmd, timeout=None):
        self.commands.append(cmd)
        return io.StringIO(""), FakeStdout(self.stdout_text, self.channel_rc), io.StringIO("")

    def open_sftp(self):
        return self.sftp

    def close(self):
        pass


def make(client):
    return SshTransport("10.0.0.1", "root", "pw", client_factory=lambda: client)


def test_connect_uses_password_auth_only():
    client = FakeClient()
    make(client).exec("true")
    assert client.connected["password"] == "pw"
    assert client.connected["look_for_keys"] is False
    assert client.connected["allow_agent"] is False


def test_exec_returns_remote_exit_code():
    client = FakeClient("out\n__QM_RC=4\n", channel_rc=4)
    assert make(client).exec("x").exit_code == 4


def test_channel_status_and_sentinel_must_agree():
    # A silent divergence between the two would hide exactly the class of bug
    # the sentinel exists to catch, so it is loud.
    client = FakeClient("out\n__QM_RC=0\n", channel_rc=7)
    with pytest.raises(TransportError, match="disagree"):
        make(client).exec("x")


def test_missing_sentinel_is_failure_even_when_channel_says_zero():
    client = FakeClient("no sentinel here\n", channel_rc=0)
    assert make(client).exec("x").exit_code == MISSING_SENTINEL_RC


def test_push_uses_sftp():
    client = FakeClient()
    make(client).push(Path("a.tar.gz"), "/tmp/a.tar.gz")
    assert client.sftp.puts == [("a.tar.gz", "/tmp/a.tar.gz")]


def test_push_failure_raises_transport_error():
    client = FakeClient()
    client.sftp.fail = True
    with pytest.raises(TransportError, match="permission denied"):
        make(client).push(Path("a.tar.gz"), "/tmp/a.tar.gz")
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `.venv\Scripts\pytest tests/test_transport_ssh.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement `core/transport/ssh.py`**

```python
"""SSH transport. Password authentication only (spec §10, settled 2026-08-26)."""

from __future__ import annotations

from pathlib import Path
from typing import Callable

from .base import (
    MISSING_SENTINEL_RC,
    Result,
    Transport,
    TransportError,
    parse_rc,
    strip_ansi,
    wrap_command,
)


def _default_client_factory():
    import paramiko

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    return client


class SshTransport(Transport):
    def __init__(
        self,
        host: str,
        username: str,
        password: str,
        port: int = 22,
        client_factory: Callable = _default_client_factory,
    ) -> None:
        self._host = host
        self._port = port
        self._username = username
        self._password = password
        self._client_factory = client_factory
        self._client = None

    def describe(self) -> str:
        return f"SSH {self._host}"

    def _connected(self):
        if self._client is None:
            client = self._client_factory()
            try:
                client.connect(
                    hostname=self._host,
                    port=self._port,
                    username=self._username,
                    password=self._password,
                    look_for_keys=False,
                    allow_agent=False,
                    timeout=15,
                )
            except Exception as exc:  # paramiko raises a wide family
                raise TransportError(f"SSH connection failed: {exc}") from exc
            self._client = client
        return self._client

    def push(self, local: Path, remote: str) -> None:
        sftp = self._connected().open_sftp()
        try:
            sftp.put(str(local), remote)
        except Exception as exc:
            raise TransportError(f"SFTP put failed: {exc}") from exc
        finally:
            sftp.close()

    def exec(self, cmd: str, timeout: int = 60) -> Result:
        _, stdout, stderr = self._connected().exec_command(wrap_command(cmd), timeout=timeout)
        out = stdout.read() if hasattr(stdout, "read") else ""
        out = out.decode("utf-8", "replace") if isinstance(out, bytes) else out
        err = stderr.read() if hasattr(stderr, "read") else ""
        err = err.decode("utf-8", "replace") if isinstance(err, bytes) else err
        channel_rc = stdout.channel.recv_exit_status()

        body, rc = parse_rc(strip_ansi(out))
        if rc != MISSING_SENTINEL_RC and rc != channel_rc:
            raise TransportError(
                f"exit codes disagree: sentinel={rc} channel={channel_rc}"
            )
        return Result(exit_code=rc, stdout=body.strip(), stderr=strip_ansi(err).strip())

    def exec_stream(self, cmd: str, on_line, timeout: int = 1800) -> int:
        _, stdout, _ = self._connected().exec_command(
            wrap_command(cmd) + " 2>&1", timeout=timeout, get_pty=False
        )
        tail = ""
        for raw in iter(stdout.readline, ""):
            line = strip_ansi(raw.rstrip("\r\n"))
            if line.startswith("__QM_RC="):
                tail = line
                continue
            on_line(line)
        _, rc = parse_rc(tail)
        return rc

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `.venv\Scripts\pytest tests/test_transport_ssh.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add installer-gui/src/qmanager_installer/core/transport/ssh.py installer-gui/tests/test_transport_ssh.py
git commit -m "feat(installer-gui): SshTransport, password auth only"
```

---

### Task 5: Device identity and model tier

**Files:**
- Create: `installer-gui/src/qmanager_installer/core/device.py`
- Test: `installer-gui/tests/test_device.py`

**Interfaces:**
- Consumes: `Transport`, `Result` (Task 2).
- Produces: `Tier` (enum `SUPPORTED`/`COMMUNITY`/`BLOCKED`/`UNKNOWN`); `DeviceInfo(serial:str, project_name:str, firmware_raw:str, tier:Tier)`; `parse_project_name(raw:str)->str`; `parse_serialno(cmdline:str)->str`; `classify(project_name:str)->Tier`; `read_device_info(t:Transport)->DeviceInfo`.

Tier arms mirror `scripts/install_rm520n.sh:435-484` exactly. Both identity
sources are read and displayed — with two modems plugged in, a wrong-device
capture fails silently otherwise.

- [ ] **Step 1: Write the failing test**

`installer-gui/tests/test_device.py`:

```python
import pytest

from qmanager_installer.core.device import (
    Tier,
    classify,
    parse_project_name,
    parse_serialno,
    read_device_info,
)
from qmanager_installer.core.transport.base import Result

VERSION_FILE = (
    "Quectel\n"
    "RM520NGLAAR01A08M4G\n"
    "Project Name: RM520N-GL\n"
    "Firmware Version: RM520NGLAAR01A08M4G\n"
)

CMDLINE = "console=ttyMSM0,115200n8 androidboot.serialno=61368cd2 androidboot.baseband=msm ro"


def test_parse_project_name_strips_all_whitespace():
    assert parse_project_name(VERSION_FILE) == "RM520N-GL"


def test_parse_project_name_absent_yields_empty():
    assert parse_project_name("no such field\n") == ""


def test_parse_serialno():
    assert parse_serialno(CMDLINE) == "61368cd2"


def test_parse_serialno_absent_yields_empty():
    assert parse_serialno("console=ttyMSM0 ro") == ""


@pytest.mark.parametrize(
    "name,tier",
    [
        ("RM520N-GL", Tier.SUPPORTED),
        ("RM520NXX", Tier.SUPPORTED),
        ("RG501Q-EU", Tier.COMMUNITY),
        ("RM551E-GL", Tier.BLOCKED),
        ("SomeOtherModem", Tier.UNKNOWN),
        ("", Tier.UNKNOWN),
    ],
)
def test_classify_mirrors_installer_case_arms(name, tier):
    assert classify(name) == tier


class FakeTransport:
    def __init__(self, results):
        self.results = results
        self.commands = []

    def exec(self, cmd, timeout=60):
        self.commands.append(cmd)
        for needle, result in self.results.items():
            if needle in cmd:
                return result
        return Result(1, "", "not stubbed")

    def describe(self):
        return "FAKE"


def test_read_device_info_reads_both_identity_sources():
    t = FakeTransport(
        {
            "quectel-project-version": Result(0, VERSION_FILE, ""),
            "/proc/cmdline": Result(0, CMDLINE, ""),
        }
    )
    info = read_device_info(t)
    assert info.project_name == "RM520N-GL"
    assert info.serial == "61368cd2"
    assert info.tier is Tier.SUPPORTED
    assert "RM520NGLAAR01A08M4G" in info.firmware_raw


def test_read_device_info_survives_a_missing_version_file():
    # Installer warns and proceeds when the file is absent; so do we.
    t = FakeTransport(
        {"quectel-project-version": Result(1, "", "No such file"), "/proc/cmdline": Result(0, CMDLINE, "")}
    )
    info = read_device_info(t)
    assert info.project_name == ""
    assert info.tier is Tier.UNKNOWN
    assert info.serial == "61368cd2"
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `.venv\Scripts\pytest tests/test_device.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement `core/device.py`**

```python
"""Device identity and support tier.

The tier arms mirror scripts/install_rm520n.sh:435-484 exactly. Both identity
sources are read because two modems can be attached at once and a wrong-device
capture is otherwise silent.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum

from .transport.base import Transport

_SERIALNO_RE = re.compile(r"androidboot\.serialno=(\S+)")

VERSION_FILE = "/etc/quectel-project-version"


class Tier(Enum):
    SUPPORTED = "supported"      # RM520N* — reference target
    COMMUNITY = "community"      # RG501Q* — community tier, warn
    BLOCKED = "blocked"          # RM551E* — wrong installer
    UNKNOWN = "unknown"          # unrecognised or unreadable — warn and allow


@dataclass(frozen=True)
class DeviceInfo:
    serial: str
    project_name: str
    firmware_raw: str
    tier: Tier


def parse_project_name(raw: str) -> str:
    for line in raw.splitlines():
        if line.startswith("Project Name:"):
            return "".join(line.split(":", 1)[1].split())
    return ""


def parse_serialno(cmdline: str) -> str:
    match = _SERIALNO_RE.search(cmdline)
    return match.group(1) if match else ""


def classify(project_name: str) -> Tier:
    if project_name.startswith("RM551E"):
        return Tier.BLOCKED
    if project_name.startswith("RM520N"):
        return Tier.SUPPORTED
    if project_name.startswith("RG501Q"):
        return Tier.COMMUNITY
    return Tier.UNKNOWN


def read_device_info(transport: Transport) -> DeviceInfo:
    version = transport.exec(f"cat {VERSION_FILE} 2>/dev/null")
    cmdline = transport.exec("cat /proc/cmdline")
    firmware_raw = version.stdout if version.ok else ""
    project_name = parse_project_name(firmware_raw)
    return DeviceInfo(
        serial=parse_serialno(cmdline.stdout if cmdline.ok else ""),
        project_name=project_name,
        firmware_raw=firmware_raw,
        tier=classify(project_name),
    )
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `.venv\Scripts\pytest tests/test_device.py -v`
Expected: 12 passed

- [ ] **Step 5: Commit**

```bash
git add installer-gui/src/qmanager_installer/core/device.py installer-gui/tests/test_device.py
git commit -m "feat(installer-gui): device identity and support-tier classification"
```

---

### Task 6: Preflight checks

**Files:**
- Create: `installer-gui/src/qmanager_installer/core/preflight.py`
- Test: `installer-gui/tests/test_preflight.py`

**Interfaces:**
- Consumes: `Transport`, `Result`, `DeviceInfo`, `Tier`, `read_device_info`, `Payload`.
- Produces: `CheckState` (enum `PASS`/`WARN`/`BLOCK`/`INFO`); `Check(id:str, state:CheckState, detail:str, data:dict)`; `Action` (enum `INSTALL`/`UPGRADE`/`REPAIR`); `PreflightReport(checks, device, installed_version, action)` with `.blocked`; `run_preflight(transport, payload) -> PreflightReport`; `compare_versions(a:str,b:str)->int`; `MIN_FREE_KB = 32768`; `SIMPLEADMIN_MARKERS: tuple[str,...]`.

Two shell details that will silently break this if missed:

1. The SimpleAdmin probe must end with `; true`. A `[ -e "$p" ] && echo "$p"` loop
   exits non-zero when the last marker is absent — which is the *normal* case —
   and the check would read as a transport failure on every clean device.
2. Disk space is read with `df -k`, not bare `df`. BusyBox `df` without `-k` can
   report in 512-byte blocks, halving the apparent free space.

- [ ] **Step 1: Write the failing test**

`installer-gui/tests/test_preflight.py`:

```python
import pytest

from qmanager_installer.core.payload import Payload
from qmanager_installer.core.preflight import (
    Action,
    CheckState,
    compare_versions,
    run_preflight,
)
from qmanager_installer.core.transport.base import Result

VERSION_FILE = "Project Name: RM520N-GL\nFirmware Version: RM520NGLAAR01A08M4G\n"
CMDLINE = "androidboot.serialno=61368cd2 ro"

PAYLOAD = Payload(tarball=None, sha256="a" * 64, version="v0.1.14")


class FakeTransport:
    """Keyed on a substring of the command; anything unstubbed fails loudly."""

    def __init__(self, **overrides):
        self.results = {
            "quectel-project-version": Result(0, VERSION_FILE, ""),
            "/proc/cmdline": Result(0, CMDLINE, ""),
            "simpleadmin": Result(0, "", ""),          # no markers found
            "/etc/qmanager/VERSION": Result(1, "", ""),  # not installed
            "df -k": Result(0, "131072\n", ""),
            "bin.entware.net": Result(0, "REACHABLE\n", ""),
        }
        self.results.update(overrides)
        self.commands = []

    def exec(self, cmd, timeout=60):
        self.commands.append(cmd)
        for needle, result in self.results.items():
            if needle in cmd:
                return result
        raise AssertionError(f"unstubbed command: {cmd}")

    def describe(self):
        return "FAKE"


def check(report, check_id):
    return next(c for c in report.checks if c.id == check_id)


# --- version comparison -------------------------------------------------------

@pytest.mark.parametrize(
    "a,b,expected",
    [
        ("v0.1.14", "v0.1.14", 0),
        ("v0.1.13", "v0.1.14", -1),
        ("v0.1.14", "v0.1.13", 1),
        ("0.1.14", "v0.1.14", 0),
        ("v0.1.9", "v0.1.10", -1),
        ("v0.1.14-draft", "v0.1.14", 0),
    ],
)
def test_compare_versions(a, b, expected):
    assert compare_versions(a, b) == expected


# --- action selection ---------------------------------------------------------

def test_fresh_device_is_an_install():
    r = run_preflight(FakeTransport(), PAYLOAD)
    assert r.action is Action.INSTALL
    assert r.installed_version is None


def test_older_version_is_an_upgrade():
    t = FakeTransport(**{"/etc/qmanager/VERSION": Result(0, "v0.1.13\n", "")})
    r = run_preflight(t, PAYLOAD)
    assert r.action is Action.UPGRADE
    assert r.installed_version == "v0.1.13"


def test_same_version_is_a_repair():
    t = FakeTransport(**{"/etc/qmanager/VERSION": Result(0, "v0.1.14\n", "")})
    assert run_preflight(t, PAYLOAD).action is Action.REPAIR


def test_newer_installed_version_warns_about_downgrade():
    t = FakeTransport(**{"/etc/qmanager/VERSION": Result(0, "v0.2.0\n", "")})
    r = run_preflight(t, PAYLOAD)
    assert check(r, "version_downgrade").state is CheckState.WARN
    assert not r.blocked


# --- tier arms ----------------------------------------------------------------

def test_rm520n_passes():
    r = run_preflight(FakeTransport(), PAYLOAD)
    assert check(r, "model").state is CheckState.PASS
    assert not r.blocked


def test_rg501q_warns_but_does_not_block():
    t = FakeTransport(**{"quectel-project-version": Result(0, "Project Name: RG501Q-EU\n", "")})
    r = run_preflight(t, PAYLOAD)
    assert check(r, "model").state is CheckState.WARN
    assert not r.blocked


def test_rm551e_blocks():
    t = FakeTransport(**{"quectel-project-version": Result(0, "Project Name: RM551E-GL\n", "")})
    r = run_preflight(t, PAYLOAD)
    assert check(r, "model").state is CheckState.BLOCK
    assert r.blocked


def test_unknown_model_warns_but_does_not_block():
    t = FakeTransport(**{"quectel-project-version": Result(0, "Project Name: WidgetModem\n", "")})
    r = run_preflight(t, PAYLOAD)
    assert check(r, "model").state is CheckState.WARN
    assert not r.blocked


# --- SimpleAdmin --------------------------------------------------------------

def test_simpleadmin_markers_hard_block_and_name_what_was_found():
    t = FakeTransport(
        **{"simpleadmin": Result(0, "/usrdata/simpleadmin\n/lib/systemd/system/simpleadmin_httpd.service\n", "")}
    )
    r = run_preflight(t, PAYLOAD)
    c = check(r, "simpleadmin")
    assert c.state is CheckState.BLOCK
    assert r.blocked
    assert "/usrdata/simpleadmin" in c.detail
    assert "simpleadmin_httpd.service" in c.detail


def test_simpleadmin_probe_ends_with_true_so_a_clean_device_is_not_a_failure():
    t = FakeTransport()
    run_preflight(t, PAYLOAD)
    probe = next(c for c in t.commands if "simpleadmin" in c)
    assert probe.rstrip().endswith("; true")


# --- disk and network ---------------------------------------------------------

def test_low_disk_space_blocks():
    t = FakeTransport(**{"df -k": Result(0, "1024\n", "")})
    r = run_preflight(t, PAYLOAD)
    assert check(r, "disk").state is CheckState.BLOCK
    assert r.blocked


def test_disk_probe_forces_kilobyte_blocks():
    t = FakeTransport()
    run_preflight(t, PAYLOAD)
    assert any("df -k" in c for c in t.commands)


def test_entware_unreachable_warns_but_never_blocks():
    t = FakeTransport(**{"bin.entware.net": Result(0, "UNREACHABLE\n", "")})
    r = run_preflight(t, PAYLOAD)
    assert check(r, "entware").state is CheckState.WARN
    assert not r.blocked


def test_entware_unreachable_is_only_info_when_opt_is_already_present():
    t = FakeTransport(**{"bin.entware.net": Result(0, "UNREACHABLE_HAVE_OPKG\n", "")})
    r = run_preflight(t, PAYLOAD)
    assert check(r, "entware").state is CheckState.INFO


def test_no_downloader_blocks_because_the_installer_dies_without_one():
    t = FakeTransport(**{"bin.entware.net": Result(0, "NO_DOWNLOADER\n", "")})
    r = run_preflight(t, PAYLOAD)
    assert check(r, "entware").state is CheckState.BLOCK
    assert r.blocked
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `.venv\Scripts\pytest tests/test_preflight.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement `core/preflight.py`**

```python
"""Preflight checks. Every device-state decision the GUI makes lives here.

Pure with respect to the transport: give it a fake and the whole matrix is
testable without hardware.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum

from .device import DeviceInfo, Tier, read_device_info
from .payload import Payload
from .transport.base import Transport

MIN_FREE_KB = 32768  # 5.5 MB tarball + extraction, with headroom

SIMPLEADMIN_MARKERS = (
    "/usrdata/simpleadmin",
    "/usrdata/simpleupdates",
    "/lib/systemd/system/simpleadmin_httpd.service",
    "/lib/systemd/system/simpleadmin_generate_status.service",
)

QMANAGER_VERSION_FILE = "/etc/qmanager/VERSION"

# Trailing `; true` is load-bearing: `[ -e ] && echo` exits non-zero when the
# LAST marker is absent, which is the normal case on a clean device. Without it
# every clean device reads as a transport failure.
_SIMPLEADMIN_PROBE = (
    "for p in " + " ".join(SIMPLEADMIN_MARKERS) + "; do [ -e \"$p\" ] && echo \"$p\"; done; true"
)

# `-k` is load-bearing: BusyBox df without it may report 512-byte blocks.
_DISK_PROBE = "df -k /tmp | awk 'NR==2 {print $4}'"

# curl preferred, wget accepted — same order the installer uses. NO_DOWNLOADER
# is fatal because install_rm520n.sh dies outright without one.
_ENTWARE_PROBE = (
    "if command -v curl >/dev/null 2>&1; then "
    "curl -fsS --max-time 8 -o /dev/null http://bin.entware.net/ && echo REACHABLE || "
    "{ [ -x /opt/bin/opkg ] && echo UNREACHABLE_HAVE_OPKG || echo UNREACHABLE; }; "
    "elif command -v wget >/dev/null 2>&1; then "
    "wget -q -T 8 -O /dev/null http://bin.entware.net/ && echo REACHABLE || "
    "{ [ -x /opt/bin/opkg ] && echo UNREACHABLE_HAVE_OPKG || echo UNREACHABLE; }; "
    "else echo NO_DOWNLOADER; fi"
)

_NUM_RE = re.compile(r"\d+")


class CheckState(Enum):
    PASS = "pass"
    INFO = "info"
    WARN = "warn"
    BLOCK = "block"


class Action(Enum):
    INSTALL = "install"
    UPGRADE = "upgrade"
    REPAIR = "repair"


@dataclass(frozen=True)
class Check:
    id: str
    state: CheckState
    detail: str
    data: dict = field(default_factory=dict)


@dataclass(frozen=True)
class PreflightReport:
    checks: list[Check]
    device: DeviceInfo | None
    installed_version: str | None
    action: Action

    @property
    def blocked(self) -> bool:
        return any(c.state is CheckState.BLOCK for c in self.checks)


def _version_tuple(v: str) -> tuple[int, ...]:
    core = v.strip().lstrip("vV").split("-", 1)[0]
    return tuple(int(p) for p in _NUM_RE.findall(core)) or (0,)


def compare_versions(a: str, b: str) -> int:
    """-1 if a < b, 0 if equal, 1 if a > b. Suffixes like -draft are ignored."""
    ta, tb = _version_tuple(a), _version_tuple(b)
    width = max(len(ta), len(tb))
    ta += (0,) * (width - len(ta))
    tb += (0,) * (width - len(tb))
    return (ta > tb) - (ta < tb)


def run_preflight(transport: Transport, payload: Payload) -> PreflightReport:
    checks: list[Check] = []

    device = read_device_info(transport)
    checks.append(
        Check(
            "identity",
            CheckState.PASS if device.serial or device.project_name else CheckState.WARN,
            f"{device.project_name or 'unknown model'} · {device.serial or 'unknown serial'}",
            {"serial": device.serial, "project_name": device.project_name,
             "firmware_raw": device.firmware_raw},
        )
    )

    tier_state = {
        Tier.SUPPORTED: CheckState.PASS,
        Tier.COMMUNITY: CheckState.WARN,
        Tier.BLOCKED: CheckState.BLOCK,
        Tier.UNKNOWN: CheckState.WARN,
    }[device.tier]
    checks.append(Check("model", tier_state, device.project_name or "unknown",
                        {"tier": device.tier.value}))

    found = [line.strip() for line in transport.exec(_SIMPLEADMIN_PROBE).stdout.splitlines() if line.strip()]
    checks.append(
        Check(
            "simpleadmin",
            CheckState.BLOCK if found else CheckState.PASS,
            ", ".join(found) if found else "none",
            {"markers": found},
        )
    )

    version_result = transport.exec(f"cat {QMANAGER_VERSION_FILE} 2>/dev/null")
    installed = version_result.stdout.strip() if version_result.ok and version_result.stdout.strip() else None

    if installed is None:
        action = Action.INSTALL
    else:
        cmp = compare_versions(installed, payload.version)
        action = Action.REPAIR if cmp == 0 else Action.UPGRADE
        if cmp > 0:
            checks.append(
                Check("version_downgrade", CheckState.WARN,
                      f"{installed} installed is newer than {payload.version}",
                      {"installed": installed, "payload": payload.version})
            )
    checks.append(Check("existing", CheckState.INFO, installed or "not installed",
                        {"installed": installed, "action": action.value}))

    disk = transport.exec(_DISK_PROBE)
    free_kb = int(disk.stdout.strip()) if disk.ok and disk.stdout.strip().isdigit() else 0
    checks.append(
        Check(
            "disk",
            CheckState.PASS if free_kb >= MIN_FREE_KB else CheckState.BLOCK,
            f"{free_kb} KB free in /tmp",
            {"free_kb": free_kb, "required_kb": MIN_FREE_KB},
        )
    )

    entware = transport.exec(_ENTWARE_PROBE, timeout=30).stdout.strip()
    entware_state = {
        "REACHABLE": CheckState.PASS,
        "UNREACHABLE_HAVE_OPKG": CheckState.INFO,
        "UNREACHABLE": CheckState.WARN,
        "NO_DOWNLOADER": CheckState.BLOCK,
    }.get(entware, CheckState.WARN)
    checks.append(Check("entware", entware_state, entware or "unknown", {"raw": entware}))

    return PreflightReport(checks=checks, device=device, installed_version=installed, action=action)
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `.venv\Scripts\pytest tests/test_preflight.py -v`
Expected: 22 passed

- [ ] **Step 5: Commit**

```bash
git add installer-gui/src/qmanager_installer/core/preflight.py installer-gui/tests/test_preflight.py
git commit -m "feat(installer-gui): preflight checks with tier, SimpleAdmin and Entware gates"
```

---

### Task 7: Install runner, progress parsing, session log

**Files:**
- Create: `installer-gui/src/qmanager_installer/core/session_log.py`
- Create: `installer-gui/src/qmanager_installer/core/installer.py`
- Test: `installer-gui/tests/test_installer.py`

**Interfaces:**
- Consumes: `Transport`, `Result`, `Payload`, `TransportError`.
- Produces: `SessionLog(path:Path)` with `.write(line:str)` and `.close()`; `open_session_log(serial:str, root:Path|None=None)->SessionLog`; `Progress(step:int, total:int)`; `parse_progress(line:str)->Progress|None`; `InstallOptions(reboot:bool=True)`; `InstallOutcome(ok:bool, exit_code:int, rebooted:bool, log_path:Path|None)`; `InstallError(step:str, command:str, exit_code:int, stderr:str)`; `InstallRunner(transport, payload, on_line, on_progress, log)` with `.run(options)->InstallOutcome`.

**Reboot is issued separately**, per the deviation noted in File Structure: the
installer always runs `--no-reboot` so its exit code always comes back, and
`sync; reboot` is a distinct command afterwards. A transport error during *that*
command is success, because a rebooting device is supposed to stop answering.

- [ ] **Step 1: Write the failing test**

`installer-gui/tests/test_installer.py`:

```python
from pathlib import Path

import pytest

from qmanager_installer.core.installer import (
    InstallError,
    InstallOptions,
    InstallRunner,
    parse_progress,
)
from qmanager_installer.core.payload import Payload
from qmanager_installer.core.transport.base import Result, TransportError

SHA = "a" * 64


def make_payload(tmp_path):
    tarball = tmp_path / "qmanager.tar.gz"
    tarball.write_bytes(b"x")
    return Payload(tarball=tarball, sha256=SHA, version="v0.1.14")


class FakeTransport:
    def __init__(self, sha=SHA, stream_lines=(), stream_rc=0):
        self.sha = sha
        self.stream_lines = list(stream_lines)
        self.stream_rc = stream_rc
        self.pushed = []
        self.commands = []
        self.stream_commands = []
        self.push_error = None
        self.reboot_raises = False

    def push(self, local, remote):
        if self.push_error:
            raise TransportError(self.push_error)
        self.pushed.append((Path(local).name, remote))

    def exec(self, cmd, timeout=60):
        self.commands.append(cmd)
        if "sha256sum" in cmd:
            return Result(0, self.sha, "")
        if "reboot" in cmd:
            if self.reboot_raises:
                raise TransportError("device offline")
            return Result(0, "", "")
        return Result(0, "", "")

    def exec_stream(self, cmd, on_line, timeout=1800):
        self.stream_commands.append(cmd)
        for line in self.stream_lines:
            on_line(line)
        return self.stream_rc

    def describe(self):
        return "FAKE"


def run(tmp_path, transport, **opts):
    lines, progress = [], []
    runner = InstallRunner(
        transport,
        make_payload(tmp_path),
        on_line=lines.append,
        on_progress=progress.append,
    )
    outcome = runner.run(InstallOptions(**opts))
    return outcome, lines, progress


# --- progress parsing ---------------------------------------------------------

def test_parse_progress_matches_installer_format():
    p = parse_progress("  [Step 3/12]")
    assert (p.step, p.total) == (3, 12)


def test_parse_progress_ignores_other_lines():
    assert parse_progress("    *  jq is already installed") is None


def test_parse_progress_finds_the_marker_even_with_leftover_ansi():
    # The transport strips ANSI before this runs, but the regex searches
    # rather than matches, so a stray escape must not hide the marker.
    p = parse_progress("  [2m[Step 1/9][0m")
    assert (p.step, p.total) == (1, 9)


# --- happy path ---------------------------------------------------------------

def test_successful_install_pushes_verifies_extracts_and_runs(tmp_path):
    t = FakeTransport(stream_lines=["  [Step 1/9]", "    *  done"])
    outcome, lines, progress = run(tmp_path, t, reboot=False)
    assert outcome.ok
    assert t.pushed == [("qmanager.tar.gz", "/tmp/qmanager.tar.gz")]
    assert any("sha256sum" in c for c in t.commands)
    assert any("tar xzf" in c for c in t.commands)
    assert any("install_rm520n.sh" in c for c in t.stream_commands)
    assert (progress[0].step, progress[0].total) == (1, 9)
    assert "    *  done" in lines


def test_installer_is_always_invoked_with_no_reboot(tmp_path):
    # Its exit code must always reach us; the reboot is issued separately.
    t = FakeTransport()
    run(tmp_path, t, reboot=True)
    cmd = next(c for c in t.stream_commands if "install_rm520n.sh" in c)
    assert "--force" in cmd
    assert "--no-reboot" in cmd


def test_reboot_requested_issues_a_separate_reboot(tmp_path):
    t = FakeTransport()
    outcome, _, _ = run(tmp_path, t, reboot=True)
    assert outcome.rebooted
    assert any("reboot" in c for c in t.commands)


def test_reboot_not_requested_issues_no_reboot(tmp_path):
    t = FakeTransport()
    outcome, _, _ = run(tmp_path, t, reboot=False)
    assert not outcome.rebooted
    assert not any("reboot" in c for c in t.commands)


def test_transport_dying_during_reboot_is_success_not_failure(tmp_path):
    # A rebooting device is supposed to stop answering.
    t = FakeTransport()
    t.reboot_raises = True
    outcome, _, _ = run(tmp_path, t, reboot=True)
    assert outcome.ok
    assert outcome.rebooted


# --- failure paths ------------------------------------------------------------

def test_sha_mismatch_refuses_to_extract(tmp_path):
    t = FakeTransport(sha="b" * 64)
    with pytest.raises(InstallError) as exc:
        run(tmp_path, t, reboot=False)
    assert exc.value.step == "verify"
    assert not any("tar xzf" in c for c in t.commands)


def test_push_failure_is_reported_as_the_push_step(tmp_path):
    t = FakeTransport()
    t.push_error = "no space left on device"
    with pytest.raises(InstallError) as exc:
        run(tmp_path, t, reboot=False)
    assert exc.value.step == "push"
    assert "no space left" in exc.value.stderr


def test_nonzero_installer_exit_is_a_failure(tmp_path):
    t = FakeTransport(stream_rc=1)
    with pytest.raises(InstallError) as exc:
        run(tmp_path, t, reboot=False)
    assert exc.value.step == "install"
    assert exc.value.exit_code == 1


def test_missing_sentinel_exit_code_is_a_failure(tmp_path):
    t = FakeTransport(stream_rc=255)
    with pytest.raises(InstallError):
        run(tmp_path, t, reboot=False)
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `.venv\Scripts\pytest tests/test_installer.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement `core/session_log.py`**

```python
"""Per-run session log written beside the executable.

When a user in China hits a failure nobody local can see, they send one file.
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path


class SessionLog:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._fh = path.open("a", encoding="utf-8", newline="\n")

    def write(self, line: str) -> None:
        stamp = datetime.now().strftime("%H:%M:%S")
        self._fh.write(f"{stamp}  {line}\n")
        self._fh.flush()

    def close(self) -> None:
        if not self._fh.closed:
            self._fh.close()


def open_session_log(serial: str, root: Path | None = None) -> SessionLog:
    base = root or (Path(sys.executable).parent if getattr(sys, "frozen", False) else Path.cwd())
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    safe_serial = "".join(ch for ch in (serial or "unknown") if ch.isalnum() or ch in "-_")
    return SessionLog(base / f"qmanager-install-{safe_serial}-{stamp}.log")
```

- [ ] **Step 4: Implement `core/installer.py`**

```python
"""Push → verify → extract → run → stream.

The installer is ALWAYS invoked with --no-reboot so its exit code reaches us;
the reboot, if requested, is a separate command. Letting the installer reboot
would make a genuine mid-install failure indistinguishable from a normal one,
because the exit code would never come back.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .payload import Payload
from .session_log import SessionLog
from .transport.base import Transport, TransportError

REMOTE_TARBALL = "/tmp/qmanager.tar.gz"
REMOTE_DIR = "/tmp/qmanager_install"

# install_rm520n.sh:271 — printf "  [Step %d/%d]"
_PROGRESS_RE = re.compile(r"\[Step (\d+)/(\d+)\]")


@dataclass(frozen=True)
class Progress:
    step: int
    total: int


@dataclass(frozen=True)
class InstallOptions:
    reboot: bool = True


@dataclass(frozen=True)
class InstallOutcome:
    ok: bool
    exit_code: int
    rebooted: bool
    log_path: Path | None = None


class InstallError(RuntimeError):
    def __init__(self, step: str, command: str, exit_code: int, stderr: str) -> None:
        super().__init__(f"[{step}] exit {exit_code}: {stderr.strip()[:400]}")
        self.step = step
        self.command = command
        self.exit_code = exit_code
        self.stderr = stderr


def parse_progress(line: str) -> Progress | None:
    match = _PROGRESS_RE.search(line)
    if not match:
        return None
    return Progress(step=int(match.group(1)), total=int(match.group(2)))


class InstallRunner:
    def __init__(
        self,
        transport: Transport,
        payload: Payload,
        on_line: Callable[[str], None],
        on_progress: Callable[[Progress], None],
        log: SessionLog | None = None,
        script: str = "install_rm520n.sh",
    ) -> None:
        self._t = transport
        self._payload = payload
        self._on_line = on_line
        self._on_progress = on_progress
        self._log = log
        self._script = script

    def _emit(self, line: str) -> None:
        if self._log is not None:
            self._log.write(line)
        progress = parse_progress(line)
        if progress is not None:
            self._on_progress(progress)
        self._on_line(line)

    def _exec_or_raise(self, step: str, cmd: str, timeout: int = 120) -> None:
        self._emit(f"$ {cmd}")
        result = self._t.exec(cmd, timeout=timeout)
        if not result.ok:
            raise InstallError(step, cmd, result.exit_code, result.stderr or result.stdout)

    def run(self, options: InstallOptions) -> InstallOutcome:
        # 1. push
        self._emit(f"push {self._payload.tarball.name} -> {REMOTE_TARBALL}")
        try:
            self._t.push(self._payload.tarball, REMOTE_TARBALL)
        except TransportError as exc:
            raise InstallError("push", "push", 1, str(exc)) from exc

        # 2. verify on device — a truncated push is otherwise invisible
        verify_cmd = f"sha256sum {REMOTE_TARBALL} | awk '{{print $1}}'"
        self._emit(f"$ {verify_cmd}")
        verify = self._t.exec(verify_cmd, timeout=120)
        remote_sha = verify.stdout.strip().lower()
        if not verify.ok or remote_sha != self._payload.sha256:
            raise InstallError(
                "verify", verify_cmd, verify.exit_code or 1,
                f"expected {self._payload.sha256}, device reported {remote_sha or 'nothing'}",
            )
        self._emit(f"sha256 verified: {remote_sha}")

        # 3. extract
        self._exec_or_raise("extract", f"rm -rf {REMOTE_DIR} && tar xzf {REMOTE_TARBALL} -C /tmp", 180)

        # 4. run — always --no-reboot so the exit code reaches us
        cmd = f"bash {REMOTE_DIR}/{self._script} --force --no-reboot"
        self._emit(f"$ {cmd}")
        exit_code = self._t.exec_stream(cmd, self._emit, timeout=1800)
        if exit_code != 0:
            raise InstallError("install", cmd, exit_code, "installer exited non-zero")

        # 5. reboot, separately. A dead transport here is the expected outcome.
        rebooted = False
        if options.reboot:
            self._emit("$ sync; reboot")
            try:
                self._t.exec("sync; (sleep 1; reboot) >/dev/null 2>&1 &", timeout=30)
            except TransportError:
                pass  # a rebooting device is supposed to stop answering
            rebooted = True

        return InstallOutcome(
            ok=True,
            exit_code=0,
            rebooted=rebooted,
            log_path=self._log.path if self._log else None,
        )
```

- [ ] **Step 5: Run tests and confirm they pass**

Run: `.venv\Scripts\pytest tests/test_installer.py -v`
Expected: 13 passed

- [ ] **Step 6: Commit**

```bash
git add installer-gui/src/qmanager_installer/core/installer.py \
        installer-gui/src/qmanager_installer/core/session_log.py \
        installer-gui/tests/test_installer.py
git commit -m "feat(installer-gui): install runner with on-device sha verify

Always invokes install_rm520n.sh with --no-reboot so its exit code reaches us;
the reboot is a separate command whose dropped transport is a success path."
```

---

### Task 8: Uninstall runner

**Files:**
- Create: `installer-gui/src/qmanager_installer/core/uninstall.py`
- Test: `installer-gui/tests/test_uninstall.py`

**Interfaces:**
- Consumes: `InstallRunner`, `InstallOptions`, `InstallOutcome`, `InstallError` (Task 7).
- Produces: `UninstallRunner(transport, payload, on_line, on_progress, log)` with `.run(options: InstallOptions) -> InstallOutcome`.

`uninstall_rm520n.sh` ships inside the same tarball, so uninstall reuses the
identical push → verify → extract sequence and differs only in the script name and
its flags (`--force --no-reboot`; `--purge` is deliberately **not** exposed — it
destroys user configuration and belongs behind a decision the GUI is not making
for anyone).

- [ ] **Step 1: Write the failing test**

`installer-gui/tests/test_uninstall.py`:

```python
from pathlib import Path

from qmanager_installer.core.installer import InstallOptions
from qmanager_installer.core.payload import Payload
from qmanager_installer.core.uninstall import UninstallRunner
from qmanager_installer.core.transport.base import Result

SHA = "a" * 64


class FakeTransport:
    def __init__(self):
        self.commands = []
        self.stream_commands = []

    def push(self, local, remote):
        pass

    def exec(self, cmd, timeout=60):
        self.commands.append(cmd)
        if "sha256sum" in cmd:
            return Result(0, SHA, "")
        return Result(0, "", "")

    def exec_stream(self, cmd, on_line, timeout=1800):
        self.stream_commands.append(cmd)
        return 0

    def describe(self):
        return "FAKE"


def test_uninstall_runs_the_uninstall_script(tmp_path):
    tarball = tmp_path / "qmanager.tar.gz"
    tarball.write_bytes(b"x")
    t = FakeTransport()
    UninstallRunner(
        t,
        Payload(tarball=tarball, sha256=SHA, version="v0.1.14"),
        on_line=lambda _: None,
        on_progress=lambda _: None,
    ).run(InstallOptions(reboot=False))
    cmd = next(c for c in t.stream_commands if "uninstall_rm520n.sh" in c)
    assert "--force" in cmd
    assert "--no-reboot" in cmd


def test_uninstall_never_passes_purge(tmp_path):
    # --purge destroys user configuration; the GUI does not decide that.
    tarball = tmp_path / "qmanager.tar.gz"
    tarball.write_bytes(b"x")
    t = FakeTransport()
    UninstallRunner(
        t,
        Payload(tarball=tarball, sha256=SHA, version="v0.1.14"),
        on_line=lambda _: None,
        on_progress=lambda _: None,
    ).run(InstallOptions(reboot=False))
    assert not any("--purge" in c for c in t.stream_commands)
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `.venv\Scripts\pytest tests/test_uninstall.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement `core/uninstall.py`**

```python
"""Uninstall runner.

uninstall_rm520n.sh ships in the same tarball, so this reuses InstallRunner's
push → verify → extract sequence verbatim and only swaps the script.

--purge is deliberately NOT exposed: it destroys user configuration, and that is
not a decision a GUI should make on someone's behalf.
"""

from __future__ import annotations

from .installer import InstallRunner


class UninstallRunner(InstallRunner):
    def __init__(self, transport, payload, on_line, on_progress, log=None) -> None:
        super().__init__(
            transport,
            payload,
            on_line=on_line,
            on_progress=on_progress,
            log=log,
            script="uninstall_rm520n.sh",
        )
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `.venv\Scripts\pytest tests/test_uninstall.py -v`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add installer-gui/src/qmanager_installer/core/uninstall.py installer-gui/tests/test_uninstall.py
git commit -m "feat(installer-gui): uninstall runner (never passes --purge)"
```

---

### Task 9: i18n and locale files

**Files:**
- Create: `installer-gui/src/qmanager_installer/i18n.py`
- Create: `installer-gui/locales/en.json`, `installer-gui/locales/zh-CN.json`, `installer-gui/locales/README.md`
- Test: `installer-gui/tests/test_i18n.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `Translator(locale:str, strings:dict, fallback:dict)` with `.t(key, **params)->str` and `.missing_keys: list[str]`; `load_translator(locale:str, root:Path|None=None)->Translator`; `available_locales(root)->list[str]`; `DEFAULT_LOCALE = "en"`.

The zh-CN file ships as a **best-effort machine translation clearly marked as
unreviewed**, because a wrong translation that looks confident is worse than an
obvious placeholder. `locales/README.md` tells the reviewer exactly that.

- [ ] **Step 1: Write the failing test**

`installer-gui/tests/test_i18n.py`:

```python
import json
from pathlib import Path

from qmanager_installer.i18n import (
    DEFAULT_LOCALE,
    Translator,
    available_locales,
    load_translator,
)

LOCALES = Path(__file__).resolve().parents[1] / "locales"


def test_lookup_returns_the_string():
    t = Translator("en", {"app.title": "QManager Installer"}, {})
    assert t.t("app.title") == "QManager Installer"


def test_interpolates_named_params():
    t = Translator("en", {"x": "Upgrade {old} to {new}"}, {})
    assert t.t("x", old="v0.1.13", new="v0.1.14") == "Upgrade v0.1.13 to v0.1.14"


def test_missing_key_falls_back_to_english_and_is_recorded():
    t = Translator("zh-CN", {}, {"a.b": "English text"})
    assert t.t("a.b") == "English text"
    assert "a.b" in t.missing_keys


def test_key_missing_everywhere_returns_the_key_itself():
    t = Translator("zh-CN", {}, {})
    assert t.t("nope.nope") == "nope.nope"


def test_empty_string_counts_as_missing():
    # An untranslated blank must not render as a blank label.
    t = Translator("zh-CN", {"a.b": ""}, {"a.b": "English"})
    assert t.t("a.b") == "English"
    assert "a.b" in t.missing_keys


def test_shipped_locales_are_discovered():
    assert set(available_locales(LOCALES)) >= {"en", "zh-CN"}


def test_shipped_locales_have_identical_key_sets():
    en = json.loads((LOCALES / "en.json").read_text(encoding="utf-8"))
    zh = json.loads((LOCALES / "zh-CN.json").read_text(encoding="utf-8"))
    assert set(en) == set(zh), (
        f"only in en: {sorted(set(en) - set(zh))}; only in zh-CN: {sorted(set(zh) - set(en))}"
    )


def test_shipped_locales_have_no_empty_values():
    for name in ("en.json", "zh-CN.json"):
        data = json.loads((LOCALES / name).read_text(encoding="utf-8"))
        blank = [k for k, v in data.items() if not str(v).strip()]
        assert not blank, f"{name} has blank values: {blank}"


def test_load_translator_falls_back_to_english_for_an_unknown_locale():
    t = load_translator("fr", LOCALES)
    assert t.locale == DEFAULT_LOCALE
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `.venv\Scripts\pytest tests/test_i18n.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement `i18n.py`**

```python
"""Locale loading with English fallback.

Locale files sit BESIDE the executable as plain JSON (which is why the build is
onedir, not onefile) so a native speaker can correct one and send it back.
Missing keys fall back to English and are recorded, so a partial translation
still ships and the gaps are one diff away.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_LOCALE = "en"


def locales_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent / "locales"
    return Path(__file__).resolve().parents[2] / "locales"


@dataclass
class Translator:
    locale: str
    strings: dict[str, str]
    fallback: dict[str, str]
    missing_keys: list[str] = field(default_factory=list)

    def t(self, key: str, **params: object) -> str:
        value = self.strings.get(key)
        if not (value and str(value).strip()):
            if key not in self.missing_keys:
                self.missing_keys.append(key)
            value = self.fallback.get(key)
        if not (value and str(value).strip()):
            return key
        try:
            return str(value).format(**params)
        except (KeyError, IndexError):
            # A translator typo in a placeholder must not crash the installer.
            return str(value)


def available_locales(root: Path | None = None) -> list[str]:
    base = root or locales_root()
    return sorted(p.stem for p in base.glob("*.json"))


def load_translator(locale: str, root: Path | None = None) -> Translator:
    base = root or locales_root()

    def read(name: str) -> dict[str, str]:
        path = base / f"{name}.json"
        if not path.is_file():
            return {}
        return json.loads(path.read_text(encoding="utf-8"))

    fallback = read(DEFAULT_LOCALE)
    if locale == DEFAULT_LOCALE or not (base / f"{locale}.json").is_file():
        return Translator(DEFAULT_LOCALE, fallback, {})
    return Translator(locale, read(locale), fallback)
```

- [ ] **Step 4: Create the locale files**

`installer-gui/locales/en.json` — flat keys, no nesting. Start with exactly this
set; add a key here **and** in `zh-CN.json` whenever the UI gains a string.

```json
{
  "app.title": "QManager Installer",
  "app.subtitle": "Install QManager onto a Quectel modem — no internet download required",
  "transport.adb": "USB (ADB)",
  "transport.ssh": "Network (SSH)",
  "transport.ssh.host": "IP address",
  "transport.ssh.user": "Username",
  "transport.ssh.password": "Password",
  "transport.connect": "Connect",
  "device.none": "No device found",
  "device.none.help": "Connect the modem by USB. If it is connected and still not listed, ADB is not enabled in its USB composition — enable it on the device first, then reopen this installer.",
  "device.unauthorized": "Device found but not authorized",
  "device.unauthorized.help": "Accept the debugging prompt on the device, then click Rescan.",
  "device.rescan": "Rescan",
  "check.identity": "Device identity",
  "check.model": "Model",
  "check.simpleadmin": "SimpleAdmin conflict",
  "check.existing": "Installed version",
  "check.disk": "Free space",
  "check.entware": "Package mirror",
  "check.model.supported": "Supported",
  "check.model.community": "Community tier — not fully tested",
  "check.model.blocked": "Wrong installer for this device",
  "check.model.unknown": "Unrecognised device — proceed at your own risk",
  "check.simpleadmin.clean": "None found",
  "check.simpleadmin.found": "SimpleAdmin is installed. Remove it with its own uninstaller before installing QManager. Found: {markers}",
  "check.entware.reachable": "bin.entware.net reachable",
  "check.entware.unreachable": "Cannot reach bin.entware.net. The install may fail while fetching packages.",
  "check.entware.have_opkg": "Cannot reach bin.entware.net, but packages are already installed.",
  "check.entware.none": "No curl or wget on the device. The installer cannot run without one.",
  "check.disk.detail": "{free} KB free, {required} KB required",
  "action.install": "Install",
  "action.upgrade": "Upgrade",
  "action.repair": "Reinstall",
  "action.uninstall": "Uninstall",
  "action.install.detail": "QManager {version} will be installed.",
  "action.upgrade.detail": "{installed} will be upgraded to {version}.",
  "action.repair.detail": "{version} is already installed. Reinstalling repairs a broken install.",
  "action.downgrade.warn": "The device has {installed}, which is newer than {version}.",
  "action.uninstall.detail": "QManager will be removed from this device.",
  "action.uninstall.confirm": "Remove QManager from {serial}? Settings are kept.",
  "option.reboot": "Reboot when finished",
  "option.reboot.help": "The reboot is what starts the services. Skip it only if you plan to reboot yourself.",
  "run.start": "Start",
  "run.cancel": "Cancel",
  "run.step": "Step {step} of {total}",
  "run.pushing": "Copying files to the device",
  "run.verifying": "Verifying the copy",
  "run.extracting": "Unpacking",
  "run.installing": "Installing",
  "run.rebooting": "Rebooting — this takes about a minute",
  "run.done": "Done",
  "run.done.detail": "QManager is installed. Open http://{ip} in a browser once the modem finishes rebooting.",
  "run.failed": "Install failed",
  "run.failed.detail": "Step \"{step}\" exited with code {code}.",
  "run.log": "A full log was saved to {path}",
  "error.blocked": "Cannot continue",
  "language": "Language"
}
```

`installer-gui/locales/zh-CN.json` — same keys, machine-translated, marked
unreviewed in the README. Produce it by translating each value above; **do not
translate the `{placeholders}`** and keep every key identical.

`installer-gui/locales/README.md`:

```markdown
# Translations / 翻译

Each file is a flat `key: text` map in UTF-8. Edit only the text on the RIGHT of
the colon. Never change a key, and never translate anything inside `{curly
braces}` — those are replaced with real values at runtime.

**`zh-CN.json` is an unreviewed machine translation.** If you are a native
speaker, please correct it and send the file back — that is exactly what it is
here for.

---

每个文件都是 UTF-8 编码的 `键: 文本` 映射。只需编辑冒号**右侧**的文本。
请勿修改键名，也请勿翻译 `{大括号}` 中的内容——它们会在运行时被替换为实际值。

**`zh-CN.json` 目前是未经审校的机器翻译。** 如果您是母语使用者，
请修正后将文件发回。
```

- [ ] **Step 5: Run tests and confirm they pass**

Run: `.venv\Scripts\pytest tests/test_i18n.py -v`
Expected: 9 passed

- [ ] **Step 6: Commit**

```bash
git add installer-gui/src/qmanager_installer/i18n.py installer-gui/locales installer-gui/tests/test_i18n.py
git commit -m "feat(installer-gui): i18n with editable en/zh-CN locale files"
```

---

### Task 10: Build script — token extraction and payload embedding

**Files:**
- Create: `installer-gui/build_installer.py`
- Test: `installer-gui/tests/test_build_tokens.py`

**Interfaces:**
- Consumes: nothing from earlier tasks (build-time only).
- Produces: `extract_token_blocks(css:str)->str`; `TokenExtractionError`; `stage_payload(repo_root:Path, out:Path)->str` (returns the stamped version).

**The guard is the point of this task.** `app/globals.css` has five top-level
`:root` blocks; four of them (`:677`, `:706`, `:780`, `:980`) contain Tailwind
`@variant` at-rules that a plain browser cannot parse. Take the **first** `:root`
and the **first** `.dark`, then fail the build if `@variant`, `@apply`, or
`@theme` survives into the output.

- [ ] **Step 1: Write the failing test**

`installer-gui/tests/test_build_tokens.py`:

```python
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_installer import TokenExtractionError, extract_token_blocks  # noqa: E402

REPO_CSS = Path(__file__).resolve().parents[2] / "app" / "globals.css"

SAMPLE = """
@theme inline {
  --color-primary: var(--primary);
}

:root {
  --background: oklch(0.99 0 0);
  --radius-card: 2.25rem;
}

.dark {
  --background: oklch(0.12 0.008 258);
}

:root {
  @variant motion-reduce {
    & .nav-indicator { transition: none; }
  }
}
"""


def test_extracts_first_root_and_dark():
    out = extract_token_blocks(SAMPLE)
    assert "--radius-card: 2.25rem" in out
    assert "oklch(0.12 0.008 258)" in out
    assert out.count(":root") == 1
    assert out.count(".dark") == 1


def test_tailwind_at_rules_never_reach_the_output():
    out = extract_token_blocks(SAMPLE)
    assert "@variant" not in out
    assert "@theme" not in out
    assert "@apply" not in out


def test_raises_when_the_first_root_block_is_tailwind_only():
    bad = ":root {\n  @variant motion-reduce { & .x { color: red; } }\n}\n.dark { --a: 1; }\n"
    with pytest.raises(TokenExtractionError, match="@variant"):
        extract_token_blocks(bad)


def test_raises_when_no_dark_block_exists():
    with pytest.raises(TokenExtractionError, match="dark"):
        extract_token_blocks(":root { --a: 1; }")


def test_runs_against_the_real_globals_css():
    # The real file is the contract; a refactor there must break this test,
    # not the shipped installer.
    out = extract_token_blocks(REPO_CSS.read_text(encoding="utf-8"))
    assert "--primary-container" in out
    assert "--radius-card" in out
    assert "@variant" not in out
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `.venv\Scripts\pytest tests/test_build_tokens.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'build_installer'`

- [ ] **Step 3: Implement `build_installer.py`**

```python
"""Build the Windows GUI installer.

Three jobs, in order:
  1. Extract design tokens from ../app/globals.css so the installer cannot drift
     from DESIGN.md canon.
  2. Stage the payload from ../qmanager-build/ — the artifact build.sh already
     produced, never a re-roll.
  3. Drive PyInstaller in onedir mode (locale files must stay editable on disk).

Run `bun run package` in the repo root first.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
UI_DIR = HERE / "src" / "qmanager_installer" / "ui"
PAYLOAD_DIR = HERE / "payload"
VENDOR_ADB = HERE / "vendor" / "adb"

REQUIRED_ADB_FILES = ("adb.exe", "AdbWinApi.dll", "AdbWinUsbApi.dll")
FORBIDDEN_AT_RULES = ("@variant", "@apply", "@theme")


class TokenExtractionError(RuntimeError):
    """globals.css did not yield a usable pair of token blocks."""


class BuildError(RuntimeError):
    """A build precondition is not satisfied."""


def _first_block(css: str, selector: str) -> str | None:
    """Return the first TOP-LEVEL `<selector> { ... }` block, braces balanced."""
    pattern = re.compile(rf"(?m)^{re.escape(selector)}\s*\{{")
    match = pattern.search(css)
    if not match:
        return None
    start = match.start()
    depth = 0
    for i in range(match.end() - 1, len(css)):
        if css[i] == "{":
            depth += 1
        elif css[i] == "}":
            depth -= 1
            if depth == 0:
                return css[start : i + 1]
    return None


def extract_token_blocks(css: str) -> str:
    """First :root and first .dark, guarded against Tailwind at-rules.

    globals.css holds FIVE top-level :root blocks; four carry `@variant`
    at-rules that a plain browser cannot parse. Only the first is the token
    block, and the guard makes a future reordering a loud build failure rather
    than a silently broken installer.
    """
    root = _first_block(css, ":root")
    if root is None:
        raise TokenExtractionError("no top-level :root block found in globals.css")
    dark = _first_block(css, ".dark")
    if dark is None:
        raise TokenExtractionError("no top-level .dark block found in globals.css")

    out = f"/* GENERATED from app/globals.css — do not edit. */\n\n{root}\n\n{dark}\n"
    for rule in FORBIDDEN_AT_RULES:
        if rule in out:
            raise TokenExtractionError(
                f"{rule} reached the extracted tokens — globals.css was reordered; "
                "check which :root block comes first"
            )
    return out


def stage_payload(repo_root: Path, out: Path) -> str:
    source = repo_root / "qmanager-build"
    tarball = source / "qmanager.tar.gz"
    checksum = source / "sha256sum.txt"
    if not tarball.is_file() or not checksum.is_file():
        raise BuildError(
            f"Missing {tarball} or {checksum} — run `bun run package` in the repo root first."
        )

    package_json = (repo_root / "package.json").read_text(encoding="utf-8")
    match = re.search(r'"version"\s*:\s*"([^"]+)"', package_json)
    if not match:
        raise BuildError("Could not read version from package.json")
    version = match.group(1)
    if not version.startswith("v"):
        version = f"v{version}"

    out.mkdir(parents=True, exist_ok=True)
    shutil.copy2(tarball, out / "qmanager.tar.gz")
    shutil.copy2(checksum, out / "sha256sum.txt")
    (out / "VERSION").write_text(f"{version}\n", encoding="utf-8")
    return version


def check_vendor_adb() -> None:
    missing = [f for f in REQUIRED_ADB_FILES if not (VENDOR_ADB / f).is_file()]
    if missing:
        raise BuildError(
            f"vendor/adb is missing {missing}. All three files are required — "
            "adb fails at runtime without the DLLs. See README.md."
        )


def main() -> int:
    try:
        check_vendor_adb()
        version = stage_payload(REPO_ROOT, PAYLOAD_DIR)
        tokens = extract_token_blocks((REPO_ROOT / "app" / "globals.css").read_text(encoding="utf-8"))
        (UI_DIR / "tokens.css").write_text(tokens, encoding="utf-8", newline="\n")
    except (BuildError, TokenExtractionError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(f"Staged payload {version}; extracted {len(tokens.splitlines())} lines of tokens")

    argv = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm", "--clean", "--windowed",
        "--name", "QManagerInstaller",
        "--distpath", str(HERE / "dist"),
        "--workpath", str(HERE / "build"),
        "--specpath", str(HERE / "build"),
        "--add-data", f"{UI_DIR}{';'}qmanager_installer/ui",
        "--add-binary", f"{VENDOR_ADB}{';'}vendor/adb",
        str(HERE / "src" / "qmanager_installer" / "__main__.py"),
    ]
    result = subprocess.run(argv, cwd=HERE)
    if result.returncode != 0:
        return result.returncode

    bundle = HERE / "dist" / "QManagerInstaller"
    # locales and payload sit BESIDE the exe — editable, not embedded.
    shutil.copytree(HERE / "locales", bundle / "locales", dirs_exist_ok=True)
    shutil.copytree(PAYLOAD_DIR, bundle / "payload", dirs_exist_ok=True)
    print(f"Built {bundle}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `.venv\Scripts\pytest tests/test_build_tokens.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add installer-gui/build_installer.py installer-gui/tests/test_build_tokens.py
git commit -m "feat(installer-gui): build script with guarded token extraction

globals.css has five top-level :root blocks and four carry Tailwind @variant
rules a browser cannot parse, so the extractor takes the first of each and
fails the build if an at-rule survives."
```

---

### Task 11: UI and bridge

**Files:**
- Create: `installer-gui/src/qmanager_installer/bridge.py`
- Create: `installer-gui/src/qmanager_installer/app.py`, `installer-gui/src/qmanager_installer/__main__.py`
- Create: `installer-gui/src/qmanager_installer/ui/index.html`, `ui/styles.css`, `ui/app.js`
- Test: `installer-gui/tests/test_bridge.py`

**Interfaces:**
- Consumes: everything from Tasks 1–9.
- Produces: `Bridge` with JS-callable methods `list_devices() -> list[dict]`, `connect_adb(serial) -> dict`, `connect_ssh(host, user, password) -> dict`, `preflight() -> dict`, `start(action, reboot) -> dict`, `poll() -> dict`, `set_locale(locale) -> dict`, `strings() -> dict`.

`start()` runs the install on a worker thread and returns immediately; the UI
calls `poll()` on a timer for lines, progress, and terminal state. A synchronous
`start()` would freeze the WebView for the whole three-minute install.

- [ ] **Step 1: Write the failing test**

`installer-gui/tests/test_bridge.py`:

```python
import time
from pathlib import Path

from qmanager_installer.bridge import Bridge
from qmanager_installer.core.payload import Payload
from qmanager_installer.core.transport.base import Result

SHA = "a" * 64
VERSION_FILE = "Project Name: RM520N-GL\n"
CMDLINE = "androidboot.serialno=61368cd2 ro"


class FakeTransport:
    def __init__(self, stream_rc=0):
        self.stream_rc = stream_rc

    def push(self, local, remote):
        pass

    def exec(self, cmd, timeout=60):
        if "quectel-project-version" in cmd:
            return Result(0, VERSION_FILE, "")
        if "/proc/cmdline" in cmd:
            return Result(0, CMDLINE, "")
        if "sha256sum" in cmd:
            return Result(0, SHA, "")
        if "simpleadmin" in cmd:
            return Result(0, "", "")
        if "/etc/qmanager/VERSION" in cmd:
            return Result(1, "", "")
        if "df -k" in cmd:
            return Result(0, "131072\n", "")
        if "bin.entware.net" in cmd:
            return Result(0, "REACHABLE\n", "")
        return Result(0, "", "")

    def exec_stream(self, cmd, on_line, timeout=1800):
        on_line("  [Step 1/9]")
        on_line("    *  working")
        return self.stream_rc

    def describe(self):
        return "FAKE"

    def close(self):
        pass


def make_bridge(tmp_path, transport):
    tarball = tmp_path / "qmanager.tar.gz"
    tarball.write_bytes(b"x")
    b = Bridge(
        payload=Payload(tarball=tarball, sha256=SHA, version="v0.1.14"),
        log_root=tmp_path,
    )
    b._transport = transport  # bypass device discovery in tests
    return b


def drain(bridge, timeout=5.0):
    deadline = time.time() + timeout
    lines, state = [], None
    while time.time() < deadline:
        snap = bridge.poll()
        lines.extend(snap["lines"])
        state = snap["state"]
        if state in ("done", "failed"):
            return lines, snap
        time.sleep(0.02)
    raise AssertionError(f"never reached a terminal state (last: {state})")


def test_preflight_returns_a_serialisable_report(tmp_path):
    b = make_bridge(tmp_path, FakeTransport())
    report = b.preflight()
    assert report["action"] == "install"
    assert report["blocked"] is False
    assert any(c["id"] == "model" for c in report["checks"])
    # Must survive the JS bridge — no enums, no dataclasses.
    import json

    json.dumps(report)


def test_start_is_non_blocking_and_streams_through_poll(tmp_path):
    b = make_bridge(tmp_path, FakeTransport())
    b.preflight()
    assert b.start("install", reboot=False)["started"] is True
    lines, final = drain(b)
    assert final["state"] == "done"
    assert any("working" in line for line in lines)
    assert final["progress"] == {"step": 1, "total": 9}


def test_uninstall_action_routes_to_the_uninstall_runner(tmp_path):
    seen = []

    class T(FakeTransport):
        def exec_stream(self, cmd, on_line, timeout=1800):
            seen.append(cmd)
            return 0

    b = make_bridge(tmp_path, T())
    b.preflight()
    b.start("uninstall", reboot=False)
    drain(b)
    assert any("uninstall_rm520n.sh" in c for c in seen)


def test_failure_reaches_the_ui_as_a_typed_error(tmp_path):
    b = make_bridge(tmp_path, FakeTransport(stream_rc=1))
    b.preflight()
    b.start("install", reboot=False)
    _, final = drain(b)
    assert final["state"] == "failed"
    assert final["error"]["step"] == "install"
    assert final["error"]["exit_code"] == 1


def test_missing_adb_is_reported_rather_than_raising(tmp_path, monkeypatch):
    # Spec check #1. A stack trace from a missing adb.exe would be the least
    # actionable error in the whole app.
    b = make_bridge(tmp_path, FakeTransport())
    monkeypatch.setattr("qmanager_installer.bridge.adb_path", lambda: tmp_path / "nope.exe")
    assert b.toolchain()["ok"] is False
    assert b.list_devices() == []


def test_strings_are_returned_for_the_active_locale(tmp_path):
    b = make_bridge(tmp_path, FakeTransport())
    b.set_locale("zh-CN")
    assert b.strings()["app.title"]
    assert b.set_locale("en")["locale"] == "en"


def test_core_never_imports_the_ui_layer():
    # The boundary that makes the preflight matrix testable without a device.
    root = Path(__file__).resolve().parents[1] / "src" / "qmanager_installer" / "core"
    for path in root.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        for banned in ("import webview", "from webview", "from ..bridge", "from ..app"):
            assert banned not in text, f"{path.name} imports the UI layer: {banned}"
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `.venv\Scripts\pytest tests/test_bridge.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'qmanager_installer.bridge'`

- [ ] **Step 3: Implement `bridge.py`**

```python
"""The single seam between the UI and core.

start() runs on a worker thread and returns immediately; the UI polls. A
synchronous start() would freeze the WebView for the whole install.
"""

from __future__ import annotations

import threading
from dataclasses import asdict
from pathlib import Path

from .core.installer import InstallError, InstallOptions, InstallRunner, Progress
from .core.payload import Payload, load_payload
from .core.preflight import PreflightReport, run_preflight
from .core.session_log import open_session_log
from .core.transport.adb import AdbTransport, list_devices
from .core.transport.base import Transport
from .core.transport.ssh import SshTransport
from .core.uninstall import UninstallRunner
from .i18n import DEFAULT_LOCALE, load_translator


def adb_path() -> Path:
    import sys

    base = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[2]
    return base / "vendor" / "adb" / "adb.exe"


class Bridge:
    def __init__(self, payload: Payload | None = None, log_root: Path | None = None) -> None:
        self._payload = payload or load_payload()
        self._log_root = log_root
        self._transport: Transport | None = None
        self._report: PreflightReport | None = None
        self._translator = load_translator(DEFAULT_LOCALE)

        self._lock = threading.Lock()
        self._lines: list[str] = []
        self._progress: dict | None = None
        self._state = "idle"
        self._error: dict | None = None
        self._log_path: Path | None = None

    # --- locale ---------------------------------------------------------------

    def set_locale(self, locale: str) -> dict:
        self._translator = load_translator(locale)
        return {"locale": self._translator.locale}

    def strings(self) -> dict:
        merged = dict(self._translator.fallback)
        merged.update({k: v for k, v in self._translator.strings.items() if str(v).strip()})
        return merged

    # --- connection -----------------------------------------------------------

    def toolchain(self) -> dict:
        """Spec check #1 — adb.exe present. Without it nothing else can run."""
        path = adb_path()
        return {"ok": path.is_file(), "path": str(path)}

    def list_devices(self) -> list[dict]:
        if not adb_path().is_file():
            return []
        return [asdict(d) for d in list_devices(adb_path())]

    def connect_adb(self, serial: str) -> dict:
        self._transport = AdbTransport(adb_path(), serial)
        return {"connected": True, "describe": self._transport.describe()}

    def connect_ssh(self, host: str, user: str, password: str) -> dict:
        self._transport = SshTransport(host, user, password)
        return {"connected": True, "describe": self._transport.describe()}

    # --- preflight ------------------------------------------------------------

    def preflight(self) -> dict:
        if self._transport is None:
            return {"error": "not connected"}
        self._report = run_preflight(self._transport, self._payload)
        return {
            "action": self._report.action.value,
            "blocked": self._report.blocked,
            "installed_version": self._report.installed_version,
            "payload_version": self._payload.version,
            "device": asdict(self._report.device) | {"tier": self._report.device.tier.value}
            if self._report.device
            else None,
            "checks": [
                {"id": c.id, "state": c.state.value, "detail": c.detail, "data": c.data}
                for c in self._report.checks
            ],
        }

    # --- run ------------------------------------------------------------------

    def start(self, action: str, reboot: bool = True) -> dict:
        if self._transport is None or self._state == "running":
            return {"started": False}
        serial = self._report.device.serial if self._report and self._report.device else "unknown"
        log = open_session_log(serial, self._log_root)
        self._log_path = log.path
        with self._lock:
            self._lines, self._progress, self._error = [], None, None
            self._state = "running"

        runner_cls = UninstallRunner if action == "uninstall" else InstallRunner
        runner = runner_cls(
            self._transport,
            self._payload,
            on_line=self._push_line,
            on_progress=self._push_progress,
            log=log,
        )

        def work() -> None:
            try:
                runner.run(InstallOptions(reboot=reboot))
                state, error = "done", None
            except InstallError as exc:
                state = "failed"
                error = {
                    "step": exc.step,
                    "command": exc.command,
                    "exit_code": exc.exit_code,
                    "stderr": exc.stderr,
                }
            except Exception as exc:  # never let a traceback reach the user
                state = "failed"
                error = {"step": "unexpected", "command": "", "exit_code": -1, "stderr": str(exc)}
            finally:
                log.close()
            with self._lock:
                self._state, self._error = state, error

        threading.Thread(target=work, daemon=True).start()
        return {"started": True}

    def _push_line(self, line: str) -> None:
        with self._lock:
            self._lines.append(line)

    def _push_progress(self, progress: Progress) -> None:
        with self._lock:
            self._progress = {"step": progress.step, "total": progress.total}

    def poll(self) -> dict:
        with self._lock:
            lines, self._lines = self._lines, []
            return {
                "lines": lines,
                "progress": self._progress,
                "state": self._state,
                "error": self._error,
                "log_path": str(self._log_path) if self._log_path else None,
            }
```

- [ ] **Step 4: Implement `app.py` and `__main__.py`**

`app.py`:

```python
"""pywebview window bootstrap."""

from __future__ import annotations

import sys
from pathlib import Path

import webview

from .bridge import Bridge


def ui_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "qmanager_installer" / "ui"  # type: ignore[attr-defined]
    return Path(__file__).resolve().parent / "ui"


def run() -> int:
    bridge = Bridge()
    webview.create_window(
        "QManager Installer",
        str(ui_dir() / "index.html"),
        js_api=bridge,
        width=900,
        height=680,
        min_size=(760, 560),
    )
    webview.start()
    return 0
```

`__main__.py`:

```python
from .app import run

if __name__ == "__main__":
    raise SystemExit(run())
```

- [ ] **Step 5: Implement the UI**

`ui/index.html` — one document, four views toggled by `data-view` on `<body>`:
`connect`, `preflight`, `run`, `result`.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>QManager Installer</title>
    <link rel="stylesheet" href="tokens.css" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body data-view="connect">
    <header class="topbar">
      <h1 data-i18n="app.title"></h1>
      <select id="locale" aria-label="Language">
        <option value="en">English</option>
        <option value="zh-CN">中文</option>
      </select>
    </header>

    <main>
      <section class="view" data-for="connect">
        <div class="card">
          <div class="tabs">
            <button class="tab" data-transport="adb" data-i18n="transport.adb"></button>
            <button class="tab" data-transport="ssh" data-i18n="transport.ssh"></button>
          </div>
          <div id="adb-pane">
            <ul id="devices" class="device-list"></ul>
            <p id="no-device" class="empty" data-i18n="device.none.help"></p>
            <button id="rescan" class="btn" data-i18n="device.rescan"></button>
          </div>
          <div id="ssh-pane" hidden>
            <label data-i18n="transport.ssh.host"><input id="ssh-host" /></label>
            <label data-i18n="transport.ssh.user"><input id="ssh-user" value="root" /></label>
            <label data-i18n="transport.ssh.password"><input id="ssh-pass" type="password" /></label>
            <button id="ssh-connect" class="btn btn-primary" data-i18n="transport.connect"></button>
          </div>
        </div>
      </section>

      <section class="view" data-for="preflight">
        <div class="card">
          <h2 id="action-title"></h2>
          <p id="action-detail" class="muted"></p>
          <ul id="checks" class="checks"></ul>
          <label class="row"><input type="checkbox" id="reboot" checked />
            <span data-i18n="option.reboot"></span></label>
          <p class="muted small" data-i18n="option.reboot.help"></p>
          <button id="start" class="btn btn-primary" data-i18n="run.start"></button>
          <button id="uninstall" class="btn" data-i18n="action.uninstall" hidden></button>
        </div>
      </section>

      <section class="view" data-for="run">
        <div class="card">
          <h2 id="run-title" data-i18n="run.installing"></h2>
          <div class="dots" id="dots"></div>
          <pre id="log" class="log" aria-live="polite"></pre>
        </div>
      </section>

      <section class="view" data-for="result">
        <div class="card">
          <div id="result-badge" class="badge"></div>
          <h2 id="result-title"></h2>
          <p id="result-detail"></p>
          <p id="result-log" class="muted small"></p>
        </div>
      </section>
    </main>
    <script src="app.js"></script>
  </body>
</html>
```

`ui/styles.css` — consumes the generated tokens; **no literal colours**. Follow
the project conventions: filled tonal chips each carrying a glyph, `--radius-card`
on cards, pill radius on buttons, `--duration-*` / `--ease-*` for every
transition (a raw `duration-200` would silently fail to retune), and
`prefers-color-scheme: dark` applying the `.dark` block by adding the class on
`<html>` at startup.

```css
@font-face {
  font-family: "Rethink Sans";
  src: url("fonts/RethinkSans-Variable.woff2") format("woff2");
  font-weight: 100 900;
  font-display: swap;
}
@font-face {
  font-family: "JetBrains Mono";
  src: url("fonts/JetBrainsMono-Regular.woff2") format("woff2");
  font-display: swap;
}

body {
  margin: 0;
  font-family: "Rethink Sans", system-ui, sans-serif;
  background: var(--background);
  color: var(--foreground);
}
.card {
  background: var(--card);
  color: var(--card-foreground);
  border-radius: var(--radius-card);
  padding: 1.75rem;
  margin: 1.25rem;
}
.btn {
  border: 0;
  border-radius: 999px;
  padding: 0.625rem 1.25rem;
  background: var(--secondary);
  color: var(--secondary-foreground);
  font: inherit;
  transition: background var(--duration-standard) var(--ease-standard);
}
.btn-primary { background: var(--primary); color: var(--primary-foreground); }
.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  border-radius: 999px;
  padding: 0.25rem 0.625rem;
  font-size: 0.8125rem;
}
/* Status chips: container fill + on- ink, no border. The glyph is mandatory —
   success and warning containers are 1.03:1 apart and identical under
   deuteranopia, so colour alone distinguishes nothing. */
.badge[data-state="pass"]  { background: var(--success-container);     color: var(--on-success-container); }
.badge[data-state="warn"]  { background: var(--warning-container);     color: var(--on-warning-container); }
.badge[data-state="block"] { background: var(--destructive-container); color: var(--on-destructive-container); }
.badge[data-state="info"]  { background: var(--primary-container);     color: var(--on-primary-container); }
.log {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.8125rem;
  max-height: 20rem;
  overflow: auto;
  background: var(--muted);
  border-radius: var(--radius-field, 1.25rem);
  padding: 0.875rem;
  white-space: pre-wrap;
}
.view { display: none; }
body[data-view="connect"]   .view[data-for="connect"],
body[data-view="preflight"] .view[data-for="preflight"],
body[data-view="run"]       .view[data-for="run"],
body[data-view="result"]    .view[data-for="result"] { display: block; }
```

Confirm every custom property referenced above exists in the generated
`tokens.css`; if `--success-container` or `--radius-field` is named differently
in `globals.css`, use the real name — the generated file is the authority.

`ui/app.js`:

```js
const api = () => window.pywebview.api;
let STRINGS = {};

const GLYPH = { pass: "✓", warn: "!", block: "✕", info: "i" };

function t(key, params = {}) {
  let s = STRINGS[key] || key;
  for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

function applyStrings() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
}

async function setLocale(locale) {
  await api().set_locale(locale);
  STRINGS = await api().strings();
  applyStrings();
}

function show(view) {
  document.body.dataset.view = view;
}

async function rescan() {
  const devices = await api().list_devices();
  const list = document.getElementById("devices");
  list.innerHTML = "";
  document.getElementById("no-device").hidden = devices.length > 0;
  devices.forEach((d) => {
    const li = document.createElement("li");
    const usable = d.state === "device";
    li.innerHTML = `<span class="badge" data-state="${usable ? "pass" : "warn"}">${
      GLYPH[usable ? "pass" : "warn"]
    } ${d.state}</span> <code>${d.serial}</code> ${d.model || ""}`;
    if (usable) {
      const btn = document.createElement("button");
      btn.className = "btn btn-primary";
      btn.textContent = t("transport.connect");
      btn.onclick = () => connect(() => api().connect_adb(d.serial));
      li.appendChild(btn);
    } else if (d.state === "unauthorized") {
      const p = document.createElement("p");
      p.className = "muted small";
      p.textContent = t("device.unauthorized.help");
      li.appendChild(p);
    }
    list.appendChild(li);
  });
}

async function connect(fn) {
  await fn();
  const report = await api().preflight();
  renderPreflight(report);
  show("preflight");
}

function renderPreflight(report) {
  const key = { install: "action.install", upgrade: "action.upgrade", repair: "action.repair" }[report.action];
  document.getElementById("action-title").textContent = t(key);
  document.getElementById("action-detail").textContent = t(`${key}.detail`, {
    version: report.payload_version,
    installed: report.installed_version || "",
  });

  const ul = document.getElementById("checks");
  ul.innerHTML = "";
  report.checks.forEach((c) => {
    const li = document.createElement("li");
    li.innerHTML =
      `<span class="badge" data-state="${c.state}">${GLYPH[c.state]}</span> ` +
      `<strong>${t("check." + c.id)}</strong> <span class="muted">${c.detail}</span>`;
    ul.appendChild(li);
  });
  document.getElementById("start").disabled = report.blocked;

  // Uninstall is offered only when there is something to remove (spec 5.5).
  const uninstall = document.getElementById("uninstall");
  uninstall.hidden = !report.installed_version;
  uninstall.dataset.serial = report.device ? report.device.serial : "";
}

async function start(action) {
  if (action === "uninstall") {
    const serial = document.getElementById("uninstall").dataset.serial;
    if (!window.confirm(t("action.uninstall.confirm", { serial }))) return;
  }
  const reboot = document.getElementById("reboot").checked;
  document.getElementById("log").textContent = "";
  document.getElementById("run-title").textContent = t("run.installing");
  show("run");
  await api().start(action, reboot);
  poll();
}

async function poll() {
  const snap = await api().poll();
  const log = document.getElementById("log");
  snap.lines.forEach((line) => {
    log.textContent += line + "\n";
  });
  log.scrollTop = log.scrollHeight;
  if (snap.progress) {
    document.getElementById("run-title").textContent = t("run.step", snap.progress);
  }
  if (snap.state === "running") {
    setTimeout(poll, 250);
    return;
  }
  const ok = snap.state === "done";
  const badge = document.getElementById("result-badge");
  badge.dataset.state = ok ? "pass" : "block";
  badge.textContent = GLYPH[ok ? "pass" : "block"];
  document.getElementById("result-title").textContent = t(ok ? "run.done" : "run.failed");
  document.getElementById("result-detail").textContent = ok
    ? t("run.done.detail", { ip: "192.168.225.1" })
    : t("run.failed.detail", { step: snap.error.step, code: snap.error.exit_code });
  document.getElementById("result-log").textContent = t("run.log", { path: snap.log_path || "" });
  show("result");
}

window.addEventListener("pywebviewready", async () => {
  if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    document.documentElement.classList.add("dark");
  }
  STRINGS = await api().strings();
  applyStrings();
  document.getElementById("locale").onchange = (e) => setLocale(e.target.value);
  document.getElementById("rescan").onclick = rescan;
  document.getElementById("start").onclick = () => start("install");
  document.getElementById("uninstall").onclick = () => start("uninstall");
  document.getElementById("ssh-connect").onclick = () =>
    connect(() =>
      api().connect_ssh(
        document.getElementById("ssh-host").value,
        document.getElementById("ssh-user").value,
        document.getElementById("ssh-pass").value,
      ),
    );
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.onclick = () => {
      const adb = tab.dataset.transport === "adb";
      document.getElementById("adb-pane").hidden = !adb;
      document.getElementById("ssh-pane").hidden = adb;
    };
  });
  rescan();
});
```

- [ ] **Step 6: Run the full test suite**

Run: `.venv\Scripts\pytest -v`
Expected: all tests pass, including `test_core_never_imports_the_ui_layer`

- [ ] **Step 7: Commit**

```bash
git add installer-gui/src/qmanager_installer/bridge.py \
        installer-gui/src/qmanager_installer/app.py \
        installer-gui/src/qmanager_installer/__main__.py \
        installer-gui/src/qmanager_installer/ui installer-gui/tests/test_bridge.py
git commit -m "feat(installer-gui): pywebview UI and threaded bridge"
```

---

### Task 12: Build and verify on hardware

**Files:**
- Modify: `installer-gui/README.md` (record anything the first real build taught you)

No new code. This task exists because every prior task was verified against a
fake, and a fake cannot tell you that adb's DLLs are missing or that WebView2
renders the tokens wrong.

- [ ] **Step 1: Place the binary dependencies**

Copy `adb.exe`, `AdbWinApi.dll`, `AdbWinUsbApi.dll` into `installer-gui/vendor/adb/`,
and the two woff2 files into `src/qmanager_installer/ui/fonts/`. Both directories
are gitignored.

- [ ] **Step 2: Build the payload and the installer**

```bash
cd "D:/Projects/QM PROJECT/QManager-RM520N" && bun run package
cd installer-gui && .venv/Scripts/python build_installer.py
```

Expected: `dist/QManagerInstaller/` containing the exe, `locales/`, and `payload/`.

- [ ] **Step 3: Verify the UI renders the real design language**

Launch `dist/QManagerInstaller/QManagerInstaller.exe` with no device attached.
Confirm: the empty state shows the "no device" guidance, every status chip has a
**glyph** and not only a colour, the light and dark palettes both come from
`tokens.css`, and switching the language selector to 中文 changes every visible
string.

- [ ] **Step 4: Verify preflight against the live RM520N-GL**

Attach the RM520N-GL by USB. Confirm the identity card shows both
`/etc/quectel-project-version` and the `androidboot.serialno` value, that the
serial matches `61368cd2`, and that the model check reads Supported.

Cross-check from a shell that the GUI is not fabricating anything:

```bash
adb -s 61368cd2 shell 'cat /etc/qmanager/VERSION; df -k /tmp | awk "NR==2 {print \$4}"'
```

- [ ] **Step 5: Run the first real install as an UPGRADE, not a fresh install**

The device already has a working panel, so an upgrade is the recoverable
direction. Run with **reboot disabled** the first time so the installer's exit
code is observable without the device going away.

Confirm: the progress line tracks `[Step N/M]`, the log pane fills, the run ends
in the success state, and a `qmanager-install-61368cd2-*.log` file appears beside
the exe containing the full transcript.

Then reload the panel in a browser and confirm the version reported in the UI
matches `payload/VERSION`.

- [ ] **Step 6: Verify the sha-mismatch refusal actually fires**

Corrupt one byte of `dist/QManagerInstaller/payload/qmanager.tar.gz`, relaunch,
and confirm the run stops at the `verify` step and never reaches `tar xzf`. This
is the one safety property that cannot be verified any other way — restore the
file afterwards by re-running `build_installer.py`.

- [ ] **Step 7: Record what the real build taught you**

Append a "Notes from the first build" section to `installer-gui/README.md` with
anything that differed from this plan — WebView2 quirks, token names that did not
exist under the expected spelling, adb behaviours. Then commit.

```bash
git add installer-gui/README.md
git commit -m "docs(installer-gui): notes from the first hardware verification"
```

---

## Verification

After Task 12, all of the following must hold:

- `.venv\Scripts\pytest` passes with no skips.
- `build_installer.py` exits non-zero when `qmanager-build/` is absent, when
  `vendor/adb/` is incomplete, and when the extracted tokens contain a Tailwind
  at-rule.
- An install against the live RM520N-GL completes, and the panel reports the
  payload's version.
- A corrupted payload stops at `verify`.
- Switching to 中文 changes every visible string, and `locales/zh-CN.json` is
  editable in Notepad in the shipped folder.
