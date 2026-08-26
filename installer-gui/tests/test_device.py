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
    assert info.identity_read_ok is True


def test_read_device_info_marks_identity_read_ok_false_when_the_exec_fails():
    # `cat` exits non-zero (missing file, permission denied, etc.). The tier
    # still collapses to UNKNOWN (empty project name), but the preflight
    # model gate needs to tell THIS apart from a readable-but-unrecognised
    # name — an unreadable identity file means the installer's own
    # RM551E* hard-block (disabled by --force) never ran either, so the GUI
    # must fail closed instead of warning.
    t = FakeTransport(
        {"quectel-project-version": Result(1, "", "No such file"), "/proc/cmdline": Result(0, CMDLINE, "")}
    )
    info = read_device_info(t)
    assert info.project_name == ""
    assert info.tier is Tier.UNKNOWN
    assert info.serial == "61368cd2"
    assert info.identity_read_ok is False


def test_read_device_info_identity_read_ok_true_even_when_name_is_unparseable():
    # File read succeeded (exit 0) but has no "Project Name:" line — this is
    # the installer's `""` case arm (warn and proceed), NOT the unreadable
    # case, so identity_read_ok must stay True.
    t = FakeTransport(
        {"quectel-project-version": Result(0, "no such field\n", ""), "/proc/cmdline": Result(0, CMDLINE, "")}
    )
    info = read_device_info(t)
    assert info.project_name == ""
    assert info.tier is Tier.UNKNOWN
    assert info.identity_read_ok is True
