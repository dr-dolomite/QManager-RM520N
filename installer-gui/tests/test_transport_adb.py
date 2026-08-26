import subprocess
import threading
import time
from pathlib import Path

import pytest

from qmanager_installer.core.transport.adb import AdbTransport, list_devices
from qmanager_installer.core.transport.base import (
    MISSING_SENTINEL_RC,
    TransportCancelled,
    TransportError,
)

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


# --- cancellation -----------------------------------------------------------


class HangingPopen:
    """Stands in for a live `adb shell` process whose stdout never produces
    another line until something kills it — the real shape of opkg stalled
    on a half-open TCP connection to bin.entware.net. `stdout` iteration
    blocks on a real Event and only ends once terminate() is called, exactly
    like an OS closing the pipe out from under a blocked read.
    """

    def __init__(self):
        self.terminated = threading.Event()
        self.terminate_calls = 0
        self.wait_calls = 0
        self.stdout = self

    def __iter__(self):
        return self

    def __next__(self):
        self.terminated.wait()
        raise StopIteration

    def terminate(self):
        self.terminate_calls += 1
        self.terminated.set()

    def wait(self, timeout=None):
        self.wait_calls += 1
        return 0


def test_cancel_terminates_the_live_process_from_a_different_thread():
    proc = HangingPopen()
    t = AdbTransport(ADB, "s", runner=fake_runner({}), popen=lambda *a, **k: proc)
    outcome = {}

    def worker():
        try:
            t.exec_stream("install.sh", lambda line: None, timeout=30)
        except TransportCancelled as exc:
            outcome["reason"] = exc.reason

    thread = threading.Thread(target=worker)
    thread.start()
    # Let exec_stream register the live process and block in the read loop
    # before the "UI thread" cancels it — this is the whole scenario: cancel
    # is called from a different thread than the one stuck reading.
    time.sleep(0.1)
    t.cancel()
    thread.join(timeout=2)

    assert not thread.is_alive(), "exec_stream did not unblock after cancel()"
    assert proc.terminate_calls == 1
    assert outcome.get("reason") == "cancelled"


def test_cancel_is_a_safe_noop_when_nothing_is_running():
    t = AdbTransport(ADB, "s", runner=fake_runner({}))
    t.cancel()  # must not raise


def test_exec_stream_enforces_a_wall_clock_deadline():
    # No cancel() call at all here — a command that never closes stdout must
    # still be bounded by exec_stream's own timeout, not block forever.
    proc = HangingPopen()
    t = AdbTransport(ADB, "s", runner=fake_runner({}), popen=lambda *a, **k: proc)

    start = time.monotonic()
    with pytest.raises(TransportCancelled) as exc:
        t.exec_stream("install.sh", lambda line: None, timeout=0.1)
    elapsed = time.monotonic() - start

    assert exc.value.reason == "deadline"
    assert proc.terminate_calls == 1
    # Proves the read loop actually exited on its own — not merely that some
    # flag got set after the fact.
    assert elapsed < 2.0
