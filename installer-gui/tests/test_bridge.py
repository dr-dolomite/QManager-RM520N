import threading
import time
from pathlib import Path

from qmanager_installer.bridge import Bridge
from qmanager_installer.core.payload import Payload
from qmanager_installer.core.transport.base import Result, TransportCancelled

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
        if "id -u" in cmd:
            return Result(0, "0\n", "")
        return Result(0, "", "")

    def exec_stream(self, cmd, on_line, timeout=1800):
        on_line("  [Step 1/9]")
        on_line("    *  working")
        return self.stream_rc

    def describe(self):
        return "FAKE"

    def close(self):
        pass


class FakeCipher:
    """Stand-in for DPAPI so no test touches the real Windows credential
    store — see tests/test_prefs.py."""

    def protect(self, plaintext: str) -> str:
        return "enc:" + plaintext

    def unprotect(self, blob: str) -> str | None:
        return blob[4:] if blob.startswith("enc:") else None


def make_bridge(tmp_path, transport):
    tarball = tmp_path / "qmanager.tar.gz"
    tarball.write_bytes(b"x")
    b = Bridge(
        payload=Payload(tarball=tarball, sha256=SHA, version="v0.1.14"),
        log_root=tmp_path,
        # Never %LOCALAPPDATA%: a test run must not touch the developer's own
        # saved connection, and must not need DPAPI to be reachable.
        prefs_root=tmp_path,
        cipher=FakeCipher(),
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
        if state in ("done", "failed", "cancelled"):
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


def test_start_forwards_skip_packages_to_the_install_command(tmp_path):
    seen = []

    class T(FakeTransport):
        def exec_stream(self, cmd, on_line, timeout=1800):
            seen.append(cmd)
            on_line("  [Step 1/9]")
            return 0

    b = make_bridge(tmp_path, T())
    b.preflight()
    b.start("install", reboot=False, skip_packages=True)
    drain(b)
    assert any("--skip-packages" in c for c in seen)


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


def test_preflight_before_connecting_returns_a_structured_error_not_a_crash(tmp_path):
    # Correction #6: an unguarded preflight() crosses the pywebview boundary
    # as a rejected promise with no message. Calling it before connect() must
    # come back as data, never raise.
    b = make_bridge(tmp_path, FakeTransport())
    b._transport = None
    report = b.preflight()
    assert "error" in report
    assert report["error"]["message"]
    import json

    json.dumps(report)


def test_preflight_reaches_js_with_identity_read_ok_and_check_data(tmp_path):
    b = make_bridge(tmp_path, FakeTransport())
    report = b.preflight()
    assert report["device"]["identity_read_ok"] is True
    model_check = next(c for c in report["checks"] if c["id"] == "model")
    assert "identity_read_ok" in model_check["data"]


def test_ssh_connect_exposes_the_host_no_ip_is_hardcoded(tmp_path):
    b = make_bridge(tmp_path, FakeTransport())
    b._transport = None

    class FakeSshTransport(FakeTransport):
        def describe(self):
            return "SSH 192.168.225.1"

    import qmanager_installer.bridge as bridge_module

    monkey_target = FakeSshTransport()
    bridge_module.SshTransport = lambda host, user, password: monkey_target
    result = b.connect_ssh("192.168.225.1", "root", "secret")
    assert result["connected"] is True
    assert result["host"] == "192.168.225.1"
    report = b.preflight()
    assert report["host"] == "192.168.225.1"


def test_missing_keys_are_exposed_for_diagnosis(tmp_path):
    b = make_bridge(tmp_path, FakeTransport())
    b.strings()
    assert isinstance(b.missing_keys(), list)


# --- cancellation -----------------------------------------------------------


class HangingTransport(FakeTransport):
    """A transport whose exec_stream blocks mid-install (like the real
    opkg-stall scenario) until Bridge.cancel() calls its cancel(), which is
    the real mechanism that must unblock a worker thread parked in
    exec_stream — not just a flag InstallRunner happens to check later.
    """

    def __init__(self):
        super().__init__()
        self.cancel_calls = 0
        self.started = threading.Event()
        self.released = threading.Event()

    def exec_stream(self, cmd, on_line, timeout=1800):
        on_line("  [Step 1/9]")
        self.started.set()
        self.released.wait(timeout=5)
        raise TransportCancelled("cancelled")

    def cancel(self):
        self.cancel_calls += 1
        self.released.set()


def test_cancel_unblocks_a_running_install_and_poll_reports_cancelled(tmp_path):
    t = HangingTransport()
    b = make_bridge(tmp_path, t)
    b.preflight()
    assert b.start("install", reboot=False)["started"] is True
    assert t.started.wait(timeout=2), "worker thread never reached exec_stream"

    result = b.cancel()
    assert result["cancelling"] is True
    assert t.cancel_calls == 1  # the actual unblocking mechanism, not just a flag

    _, final = drain(b)
    assert final["state"] == "cancelled"
    # Distinguishable from a failure: no error payload for a clean cancel.
    assert final["error"] is None


def test_cancel_is_a_safe_noop_when_nothing_is_running(tmp_path):
    b = make_bridge(tmp_path, FakeTransport())
    result = b.cancel()
    assert result["cancelling"] is False


# --- saved connection -------------------------------------------------------


def fake_ssh(bridge_module, recorder, ok=True):
    """Replace SshTransport with something that records what it was handed."""

    class FakeSshTransport(FakeTransport):
        def __init__(self, host, user, password):
            super().__init__()
            recorder.append({"host": host, "user": user, "password": password})
            if not ok:
                raise OSError("Authentication failed.")

        def describe(self):
            return "SSH " + recorder[-1]["host"]

    bridge_module.SshTransport = FakeSshTransport
    return recorder


def test_saved_connection_never_carries_the_password_across_the_bridge(tmp_path):
    # The whole point of decrypting in Python: a root password must not reach
    # the WebView's DOM or JS heap. has_password is a bool, nothing more.
    import json

    import qmanager_installer.bridge as bridge_module

    b = make_bridge(tmp_path, FakeTransport())
    b._transport = None
    fake_ssh(bridge_module, [])
    b.connect_ssh("10.0.0.1", "root", "hunter2", remember=True)

    saved = make_bridge(tmp_path, FakeTransport()).saved_connection()
    assert saved["ssh"]["has_password"] is True
    assert "hunter2" not in json.dumps(saved)
    assert "password" not in json.dumps(saved["ssh"]).replace("has_password", "")


def test_a_successful_ssh_connect_persists_host_user_and_transport(tmp_path):
    import qmanager_installer.bridge as bridge_module

    b = make_bridge(tmp_path, FakeTransport())
    b._transport = None
    fake_ssh(bridge_module, [])
    assert b.connect_ssh("10.0.0.1", "admin", "hunter2", remember=True)["connected"] is True

    saved = make_bridge(tmp_path, FakeTransport()).saved_connection()
    assert saved["transport"] == "ssh"
    assert saved["ssh"]["host"] == "10.0.0.1"
    assert saved["ssh"]["user"] == "admin"
    assert saved["ssh"]["remember"] is True


def test_a_failed_connect_persists_nothing(tmp_path):
    # Credentials that do not work must never be remembered — otherwise the
    # next launch silently retries a wrong password against a locked account.
    import qmanager_installer.bridge as bridge_module

    b = make_bridge(tmp_path, FakeTransport())
    b._transport = None
    fake_ssh(bridge_module, [], ok=False)
    assert b.connect_ssh("10.0.0.1", "admin", "wrong", remember=True)["connected"] is False

    saved = make_bridge(tmp_path, FakeTransport()).saved_connection()
    assert saved["ssh"]["has_password"] is False
    assert saved["ssh"]["host"] != "10.0.0.1"


def test_an_empty_password_field_falls_back_to_the_saved_one(tmp_path):
    import qmanager_installer.bridge as bridge_module

    b = make_bridge(tmp_path, FakeTransport())
    b._transport = None
    seen = fake_ssh(bridge_module, [])
    b.connect_ssh("10.0.0.1", "root", "hunter2", remember=True)

    b2 = make_bridge(tmp_path, FakeTransport())
    b2._transport = None
    assert b2.connect_ssh("10.0.0.1", "root", "", remember=True)["connected"] is True
    assert seen[-1]["password"] == "hunter2", "the saved password was not used"


def test_a_typed_password_beats_the_saved_one(tmp_path):
    import qmanager_installer.bridge as bridge_module

    b = make_bridge(tmp_path, FakeTransport())
    b._transport = None
    seen = fake_ssh(bridge_module, [])
    b.connect_ssh("10.0.0.1", "root", "hunter2", remember=True)

    b2 = make_bridge(tmp_path, FakeTransport())
    b2._transport = None
    b2.connect_ssh("10.0.0.1", "root", "newpass", remember=True)
    assert seen[-1]["password"] == "newpass"
    assert make_bridge(tmp_path, FakeTransport()).saved_connection()["ssh"]["has_password"] is True


def test_connecting_without_remember_clears_a_previously_saved_password(tmp_path):
    import qmanager_installer.bridge as bridge_module

    b = make_bridge(tmp_path, FakeTransport())
    b._transport = None
    fake_ssh(bridge_module, [])
    b.connect_ssh("10.0.0.1", "root", "hunter2", remember=True)

    b2 = make_bridge(tmp_path, FakeTransport())
    b2._transport = None
    b2.connect_ssh("10.0.0.1", "root", "hunter2", remember=False)

    saved = make_bridge(tmp_path, FakeTransport()).saved_connection()
    assert saved["ssh"]["has_password"] is False
    assert saved["ssh"]["remember"] is False


def test_forget_wipes_the_blob_and_is_safe_when_nothing_is_saved(tmp_path):
    import qmanager_installer.bridge as bridge_module

    b = make_bridge(tmp_path, FakeTransport())
    assert b.forget()["forgotten"] is True  # nothing saved yet — still fine

    b._transport = None
    fake_ssh(bridge_module, [])
    b.connect_ssh("10.0.0.1", "root", "hunter2", remember=True)
    assert b.forget()["forgotten"] is True

    saved = make_bridge(tmp_path, FakeTransport()).saved_connection()
    assert saved["ssh"]["has_password"] is False
    assert saved["ssh"]["host"] == "10.0.0.1"  # forget the secret, not the address


def test_an_undecryptable_blob_reports_no_saved_password(tmp_path):
    # The settings file copied to another PC. Fail closed and silent.
    import qmanager_installer.bridge as bridge_module

    b = make_bridge(tmp_path, FakeTransport())
    b._transport = None
    fake_ssh(bridge_module, [])
    b.connect_ssh("10.0.0.1", "root", "hunter2", remember=True)

    class DeadCipher:
        def protect(self, plaintext):
            return "enc:" + plaintext

        def unprotect(self, blob):
            return None

    tarball = tmp_path / "qmanager.tar.gz"
    stranger = Bridge(
        payload=Payload(tarball=tarball, sha256=SHA, version="v0.1.14"),
        log_root=tmp_path,
        prefs_root=tmp_path,
        cipher=DeadCipher(),
    )
    assert stranger.saved_connection()["ssh"]["has_password"] is False


def test_the_locale_is_remembered_between_launches(tmp_path):
    b = make_bridge(tmp_path, FakeTransport())
    b.set_locale("zh-CN")
    assert make_bridge(tmp_path, FakeTransport()).saved_connection()["locale"] == "zh-CN"


def test_saved_connection_survives_the_js_boundary(tmp_path):
    import json

    json.dumps(make_bridge(tmp_path, FakeTransport()).saved_connection())


def test_saved_connection_never_raises_when_prefs_are_unreadable(tmp_path):
    (tmp_path / "settings.json").mkdir()  # a directory where the file should be
    tarball = tmp_path / "qmanager.tar.gz"
    tarball.write_bytes(b"x")
    b = Bridge(
        payload=Payload(tarball=tarball, sha256=SHA, version="v0.1.14"),
        log_root=tmp_path,
        prefs_root=tmp_path,
        cipher=FakeCipher(),
    )
    assert b.saved_connection()["ssh"]["host"]
