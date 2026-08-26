"""Push → verify → extract → run → stream.

The installer is ALWAYS invoked with --no-reboot so its exit code reaches us;
the reboot, if requested, is a separate command. Letting the installer reboot
would make a genuine mid-install failure indistinguishable from a normal one,
because the exit code would never come back.
"""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .payload import Payload
from .session_log import SessionLog
from .transport.base import DEFAULT_EXEC_STREAM_TIMEOUT, Transport, TransportCancelled, TransportError

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
    # Opt-in escape hatch for a device with NO working WAN at all (not just
    # GitHub blocked — the case this whole GUI otherwise exists to route
    # around). Without it, install_dependencies() shells out to opkg against
    # bin.entware.net; on a truly offline SIM those calls don't fail fast,
    # they stall on a half-open TCP connection for up to
    # DEFAULT_EXEC_STREAM_TIMEOUT (30 min), which reads as a frozen installer.
    # Only meaningful when Entware/dropbear/etc. are already on the device
    # from an earlier install attempt — see run()'s script guard below.
    skip_packages: bool = False


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


class InstallCancelled(RuntimeError):
    """The run was stopped by request — a cancel_event checked between
    steps, or a mid-stream Transport.cancel()/deadline abort during the
    install script itself. Deliberately its OWN exception, not InstallError
    wearing a synthetic exit code: a cancelled run is neither a success nor
    a failure, and callers must not be able to mistake one for the other.

    Cancelling does NOT roll anything back. install_rm520n.sh mutates
    /etc/qmanager, /usr/bin and /lib/systemd/system as it runs; killing it
    partway through this exception's `step` leaves the device in whatever
    state it had reached. Re-running the installer is what puts it right.
    """

    def __init__(self, step: str) -> None:
        super().__init__(f"cancelled during [{step}]")
        self.step = step


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
        cancel_event: threading.Event | None = None,
    ) -> None:
        self._t = transport
        self._payload = payload
        self._on_line = on_line
        self._on_progress = on_progress
        self._log = log
        self._script = script
        self._cancel_event = cancel_event

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

    def _check_cancelled(self, step: str) -> None:
        if self._cancel_event is not None and self._cancel_event.is_set():
            self._emit(f"cancelled before [{step}]")
            raise InstallCancelled(step)

    def run(self, options: InstallOptions) -> InstallOutcome:
        # 1. push
        self._check_cancelled("push")
        self._emit(f"push {self._payload.tarball.name} -> {REMOTE_TARBALL}")
        try:
            self._t.push(self._payload.tarball, REMOTE_TARBALL)
        except TransportError as exc:
            raise InstallError("push", "push", 1, str(exc)) from exc

        # 2. verify on device — a truncated push is otherwise invisible
        self._check_cancelled("verify")
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
        self._check_cancelled("extract")
        self._exec_or_raise("extract", f"rm -rf {REMOTE_DIR} && tar xzf {REMOTE_TARBALL} -C /tmp", 180)

        # 4. run — always --no-reboot so the exit code reaches us.
        # --skip-packages is only ever added for install_rm520n.sh: it is the
        # flag OTA re-installs use to skip install_dependencies(), and
        # uninstall_rm520n.sh has no such option — it would die on "Unknown
        # option: --skip-packages" if this leaked into UninstallRunner's
        # shared run().
        self._check_cancelled("install")
        cmd = f"bash {REMOTE_DIR}/{self._script} --force --no-reboot"
        if options.skip_packages and self._script == "install_rm520n.sh":
            cmd += " --skip-packages"
        self._emit(f"$ {cmd}")
        try:
            exit_code = self._t.exec_stream(cmd, self._emit, timeout=DEFAULT_EXEC_STREAM_TIMEOUT)
        except TransportCancelled:
            # A mid-stream abort — Transport.cancel() from another thread, or
            # the read-loop deadline. Either way this is the "cancelled"
            # outcome, never an InstallError: there is no real exit code to
            # report because the remote script never finished.
            self._emit("cancelled during [install]")
            raise InstallCancelled("install") from None
        if exit_code != 0:
            raise InstallError("install", cmd, exit_code, "installer exited non-zero")

        # Deliberately NO cancellation gate here. Past this line the install
        # has already exited 0 — the device is fully installed, and the only
        # thing left is the separate reboot. Treating a cancel in that window
        # as InstallCancelled would tell the user the device "may be left
        # partially modified" and send them to re-run an installer that
        # already succeeded. A cancel this late simply skips the reboot, which
        # is what unchecking "Reboot when finished" does anyway.
        cancelled_late = self._cancel_event is not None and self._cancel_event.is_set()

        # 5. reboot, separately. A dead transport here is the expected outcome
        # (a rebooting device is supposed to stop answering) — but a Result
        # that comes back with a non-zero exit code is a REAL failure (e.g. a
        # shell syntax error means `sync` never even ran) and must not be
        # reported as a successful reboot.
        rebooted = False
        if options.reboot and not cancelled_late:
            reboot_cmd = "sync; (sleep 1; reboot) >/dev/null 2>&1 &"
            self._emit(f"$ {reboot_cmd}")
            try:
                result = self._t.exec(reboot_cmd, timeout=30)
            except TransportError:
                rebooted = True  # a rebooting device is supposed to stop answering
            else:
                if not result.ok:
                    raise InstallError(
                        "reboot", reboot_cmd, result.exit_code, result.stderr or result.stdout
                    )
                rebooted = True

        return InstallOutcome(
            ok=True,
            exit_code=0,
            rebooted=rebooted,
            log_path=self._log.path if self._log else None,
        )
