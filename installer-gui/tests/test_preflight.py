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
            "id -u": Result(0, "0\n", ""),
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


def test_identity_file_readable_but_unparseable_still_warns():
    # Read succeeded (exit 0) but the content has no "Project Name:" line —
    # the installer's own `""` case arm warns and proceeds, so we must too.
    t = FakeTransport(**{"quectel-project-version": Result(0, "no such field\n", "")})
    r = run_preflight(t, PAYLOAD)
    assert check(r, "model").state is CheckState.WARN
    assert not r.blocked


def test_unreadable_identity_file_blocks_the_model_gate():
    # The exec itself failed (missing file, permission error, dead shell).
    # --force disables the installer's own RM551E* hard-block, so an
    # unreadable identity file must fail the GUI's gate closed rather than
    # warn-and-proceed like the unparseable-but-readable case above.
    t = FakeTransport(**{"quectel-project-version": Result(1, "", "No such file")})
    r = run_preflight(t, PAYLOAD)
    c = check(r, "model")
    assert c.state is CheckState.BLOCK
    assert r.blocked


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


def test_entware_unreachable_without_opkg_blocks():
    # install_dependencies() in install_rm520n.sh HARD-DIES on mirror failure
    # (`die "Failed to download opkg from $ENTWARE_URL"`) when Entware isn't
    # already present — after preflight, mid-install. That death must be
    # caught here, not discovered halfway through a device mutation.
    t = FakeTransport(**{"bin.entware.net": Result(0, "UNREACHABLE\n", "")})
    r = run_preflight(t, PAYLOAD)
    assert check(r, "entware").state is CheckState.BLOCK
    assert r.blocked


def test_entware_unreachable_is_only_info_when_opt_is_already_present():
    # Entware may already be present from a previous install — harmless,
    # since install_dependencies() only touches the network when opkg is
    # missing.
    t = FakeTransport(**{"bin.entware.net": Result(0, "UNREACHABLE_HAVE_OPKG\n", "")})
    r = run_preflight(t, PAYLOAD)
    assert check(r, "entware").state is CheckState.INFO
    assert not r.blocked


def test_no_downloader_blocks_because_the_installer_dies_without_one():
    t = FakeTransport(**{"bin.entware.net": Result(0, "NO_DOWNLOADER\n", "")})
    r = run_preflight(t, PAYLOAD)
    assert check(r, "entware").state is CheckState.BLOCK
    assert r.blocked


def test_entware_probe_hits_the_installer_opkg_path_not_the_site_root():
    # A mirror can serve a landing page at the root while 404ing the actual
    # installer path install_dependencies() fetches — probe the real path.
    t = FakeTransport()
    run_preflight(t, PAYLOAD)
    probe = next(c for c in t.commands if "bin.entware.net" in c)
    assert "armv7sf-k3.2/installer/opkg" in probe


# --- root / privilege -----------------------------------------------------


def test_root_check_passes_when_uid_is_zero():
    r = run_preflight(FakeTransport(), PAYLOAD)
    assert check(r, "root").state is CheckState.PASS
    assert not r.blocked


def test_root_check_blocks_when_not_root():
    # install_rm520n.sh:406-407 dies outright when `id -u` != 0. Without
    # this check, a non-root SSH login gets a clean preflight, sits through
    # push + sha256 + extract of the payload, and only then hits a bare
    # `exit 1`.
    t = FakeTransport(**{"id -u": Result(0, "1000\n", "")})
    r = run_preflight(t, PAYLOAD)
    assert check(r, "root").state is CheckState.BLOCK
    assert r.blocked


def test_entware_probe_with_unreadable_output_fails_closed():
    # A transport hiccup, a timeout, or any output the probe did not intend
    # must not fall open to a soft warning. We just made an unreadable identity
    # file BLOCK; an unreadable mirror probe is the same class of unknown.
    for raw in ("", "   ", "garbage from a half-open connection"):
        t = FakeTransport(**{"bin.entware.net": Result(0, raw, "")})
        r = run_preflight(t, PAYLOAD)
        assert check(r, "entware").state is CheckState.BLOCK, f"raw={raw!r} fell open"
