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
