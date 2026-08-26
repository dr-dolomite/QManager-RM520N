import io
import threading
import time
from pathlib import Path

import pytest

from qmanager_installer.core.transport.base import (
    MISSING_SENTINEL_RC,
    TransportCancelled,
    TransportError,
)
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

    def exec_command(self, cmd, timeout=None, get_pty=False):
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


def test_channel_status_is_ignored_sentinel_is_authoritative():
    # After wrapping, `echo` is always the last command in the string, and
    # `echo` always succeeds — so the SSH channel's own exit status is 0 for
    # EVERY wrapped command, success or failure. It carries no information
    # once wrapping is in play, so a divergence from the sentinel must not
    # raise; only the sentinel is trusted.
    client = FakeClient("out\n__QM_RC=0\n", channel_rc=7)
    assert make(client).exec("x").exit_code == 0


def test_failing_command_returns_sentinel_rc_without_raising():
    # This is the real shape a failure takes on the wire: the remote command
    # failed (sentinel=1) but the channel status is 0, because `echo` was the
    # last thing that ran. This exact pairing was reproduced on the live
    # RM520N-GL. Raising here made `run_preflight`'s `cat VERSION` on a fresh
    # device (which MUST fail) blow up SSH before the installer could do
    # anything.
    client = FakeClient("boom\n__QM_RC=1\n", channel_rc=0)
    result = make(client).exec("false")
    assert result.exit_code == 1
    assert result.stdout == "boom"


def test_missing_sentinel_is_failure_even_when_channel_says_zero():
    client = FakeClient("no sentinel here\n", channel_rc=0)
    assert make(client).exec("x").exit_code == MISSING_SENTINEL_RC


def test_exec_stream_redirects_stderr_for_the_whole_wrapped_command():
    # `2>&1` binds to the single simple command it trails. Appending it AFTER
    # wrap_command's output means it only redirects the trailing `echo`, not
    # the user's command — so every diagnostic the remote command writes to
    # stderr (opkg/tar/systemctl/curl failures) silently vanishes from the
    # streamed log. Reproduced locally: `{ cmd; }; echo __QM_RC=$? 2>&1`
    # loses a stderr line the whole-group form `{ { cmd; }; echo ...; } 2>&1`
    # keeps. This test pins the exact built string — a fake transport can't
    # parse shell syntax, so the string itself is the only thing to assert.
    client = FakeClient("OUT\nERRLINE\n__QM_RC=3\n", channel_rc=0)
    made = make(client)
    lines = []
    rc = made.exec_stream("sh -c 'echo OUT; echo ERRLINE >&2; exit 3'", lines.append)
    assert client.commands[0] == (
        "{ { sh -c 'echo OUT; echo ERRLINE >&2; exit 3'; }; echo __QM_RC=$?; } 2>&1"
    )
    assert rc == 3
    assert "ERRLINE" in lines


def test_push_uses_sftp():
    client = FakeClient()
    make(client).push(Path("a.tar.gz"), "/tmp/a.tar.gz")
    assert client.sftp.puts == [("a.tar.gz", "/tmp/a.tar.gz")]


def test_push_failure_raises_transport_error():
    client = FakeClient()
    client.sftp.fail = True
    with pytest.raises(TransportError, match="permission denied"):
        make(client).push(Path("a.tar.gz"), "/tmp/a.tar.gz")


# --- cancellation -----------------------------------------------------------


class HangingChannel:
    """Stands in for a live paramiko Channel whose stdout.readline() never
    returns until something closes it — the real shape of a stalled remote
    command over SSH. Blocks on a real Event so a test thread genuinely
    parks in readline() the way the real blocked-reader thread would.
    """

    def __init__(self):
        self.closed = threading.Event()
        self.close_calls = 0

    def close(self):
        self.close_calls += 1
        self.closed.set()

    def readline(self):
        self.closed.wait()
        return ""


class HangingStdout:
    def __init__(self, channel):
        self.channel = channel

    def readline(self):
        return self.channel.readline()


class HangingClient:
    def __init__(self):
        self.channel = HangingChannel()
        self.commands = []

    def set_missing_host_key_policy(self, policy):
        pass

    def connect(self, **kwargs):
        pass

    def exec_command(self, cmd, timeout=None, get_pty=False):
        self.commands.append(cmd)
        return io.StringIO(""), HangingStdout(self.channel), io.StringIO("")

    def close(self):
        pass


def test_cancel_closes_the_channel_from_a_different_thread():
    client = HangingClient()
    t = make(client)
    outcome = {}

    def worker():
        try:
            t.exec_stream("install.sh", lambda line: None, timeout=30)
        except TransportCancelled as exc:
            outcome["reason"] = exc.reason

    thread = threading.Thread(target=worker)
    thread.start()
    # Let exec_stream register the live channel and block in readline()
    # before the "UI thread" cancels it — cancel is called from a different
    # thread than the one stuck reading, on purpose.
    time.sleep(0.1)
    t.cancel()
    thread.join(timeout=2)

    assert not thread.is_alive(), "exec_stream did not unblock after cancel()"
    assert client.channel.close_calls == 1
    assert outcome.get("reason") == "cancelled"


def test_cancel_is_a_safe_noop_when_nothing_is_running():
    client = FakeClient()
    t = make(client)
    t.cancel()  # must not raise


def test_exec_stream_enforces_a_wall_clock_deadline():
    client = HangingClient()
    t = make(client)

    start = time.monotonic()
    with pytest.raises(TransportCancelled) as exc:
        t.exec_stream("install.sh", lambda line: None, timeout=0.1)
    elapsed = time.monotonic() - start

    assert exc.value.reason == "deadline"
    assert client.channel.close_calls == 1
    assert elapsed < 2.0
