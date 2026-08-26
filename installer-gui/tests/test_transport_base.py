import pytest

from qmanager_installer.core.transport.base import (
    DEFAULT_EXEC_STREAM_TIMEOUT,
    MISSING_SENTINEL_RC,
    Result,
    Transport,
    TransportCancelled,
    TransportError,
    parse_rc,
    strip_ansi,
    wrap_command,
)


def test_wrap_appends_sentinel():
    assert wrap_command("ls /tmp") == "{ ls /tmp; }; echo __QM_RC=$?"


def test_wrap_brace_groups_so_a_trailing_ampersand_still_parses():
    # A command that ends in `&` (e.g. the backgrounded reboot) followed by
    # `; echo ...` is a shell syntax error in every POSIX shell — the parser
    # sees `& ;` and rejects it before anything runs. Brace-grouping the
    # command fixes this: `&` closing a compound command inside `{ ...; }`
    # parses fine. Reproduced on both dash and the live RM520N-GL.
    cmd = "sync; (sleep 1; reboot) >/dev/null 2>&1 &"
    assert wrap_command(cmd) == "{ sync; (sleep 1; reboot) >/dev/null 2>&1 & }; echo __QM_RC=$?"


def test_wrap_command_output_is_syntactically_valid_shell(tmp_path):
    # A fake transport can't parse shell syntax, so this runs the built
    # string through a REAL local POSIX shell in syntax-check-only mode
    # (`sh -n` parses without executing). This is the test that would have
    # caught the original defect: `sh -n` on the unbraced wrapped reboot
    # command exits 2 with a syntax error; on the braced form it exits 0.
    import shutil
    import subprocess

    sh = shutil.which("sh")
    if sh is None:
        pytest.skip("no POSIX sh on PATH")

    cmd = "sync; (sleep 1; reboot) >/dev/null 2>&1 &"
    wrapped = wrap_command(cmd)
    proc = subprocess.run([sh, "-n", "-c", wrapped], capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr


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


# --- cancellation ---------------------------------------------------------


def test_default_exec_stream_timeout_is_a_generous_named_constant():
    # Not a magic number scattered across both transports' default args —
    # one named constant, generous enough to cover a ~3-minute install even
    # when it stalls hard on a half-open TCP connection to bin.entware.net.
    assert isinstance(DEFAULT_EXEC_STREAM_TIMEOUT, int)
    assert DEFAULT_EXEC_STREAM_TIMEOUT >= 600


def test_transport_cancelled_is_a_transport_error_with_a_reason():
    exc = TransportCancelled("cancelled")
    assert isinstance(exc, TransportError)
    assert exc.reason == "cancelled"


def test_transport_abc_declares_cancel():
    assert "cancel" in Transport.__abstractmethods__
