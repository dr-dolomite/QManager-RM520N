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

# Same literal install_rm520n.sh's install_dependencies() uses:
#   ENTWARE_ARCH="armv7sf-k3.2"
#   ENTWARE_URL="http://bin.entware.net/${ENTWARE_ARCH}/installer"
#   dl_get "$ENTWARE_URL/opkg" /opt/bin/opkg || die "Failed to download opkg..."
# Probe the actual opkg binary path, not the site root — a mirror can serve a
# landing page at "/" while 404ing the real installer path.
_ENTWARE_ARCH = "armv7sf-k3.2"
_ENTWARE_INSTALLER_URL = f"http://bin.entware.net/{_ENTWARE_ARCH}/installer/opkg"

# curl preferred, wget accepted — same order the installer uses. NO_DOWNLOADER
# is fatal because install_rm520n.sh dies outright without one.
_ENTWARE_PROBE = (
    "if command -v curl >/dev/null 2>&1; then "
    f"curl -fsS --max-time 8 -o /dev/null {_ENTWARE_INSTALLER_URL} && echo REACHABLE || "
    "{ [ -x /opt/bin/opkg ] && echo UNREACHABLE_HAVE_OPKG || echo UNREACHABLE; }; "
    "elif command -v wget >/dev/null 2>&1; then "
    f"wget -q -T 8 -O /dev/null {_ENTWARE_INSTALLER_URL} && echo REACHABLE || "
    "{ [ -x /opt/bin/opkg ] && echo UNREACHABLE_HAVE_OPKG || echo UNREACHABLE; }; "
    "else echo NO_DOWNLOADER; fi"
)

# install_rm520n.sh:406-407 / uninstall_rm520n.sh:135 both die outright when
# not root. Non-fatal locally (stdout is just the uid), so no timeout needed.
_ROOT_PROBE = "id -u"

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

    root_result = transport.exec(_ROOT_PROBE)
    uid = root_result.stdout.strip() if root_result.ok else ""
    checks.append(
        Check(
            "root",
            CheckState.PASS if uid == "0" else CheckState.BLOCK,
            f"uid {uid}" if uid else "uid unknown",
            {"uid": uid},
        )
    )

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

    # The RM551E* hard-block in install_rm520n.sh only runs when --force is
    # NOT passed — the GUI always passes --force, so that guard never runs on
    # the device. This is our only line of defence, and it must fail CLOSED:
    # a tier of UNKNOWN because the identity file could not be read at all
    # (exec failed) is treated as BLOCK, not WARN. A tier of UNKNOWN because
    # the file read fine but matched no known prefix — the installer's `*`
    # arm — still only warns, unchanged.
    if device.tier is Tier.UNKNOWN and not device.identity_read_ok:
        tier_state = CheckState.BLOCK
    else:
        tier_state = {
            Tier.SUPPORTED: CheckState.PASS,
            Tier.COMMUNITY: CheckState.WARN,
            Tier.BLOCKED: CheckState.BLOCK,
            Tier.UNKNOWN: CheckState.WARN,
        }[device.tier]
    checks.append(Check("model", tier_state, device.project_name or "unknown",
                        {"tier": device.tier.value, "identity_read_ok": device.identity_read_ok}))

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
        # No mirror AND no Entware already installed: install_dependencies()
        # in install_rm520n.sh HARD-DIES fetching opkg — after preflight,
        # mid-install, with the device already partially mutated.
        "UNREACHABLE": CheckState.BLOCK,
        "NO_DOWNLOADER": CheckState.BLOCK,
        # Anything else — empty output, a timed-out probe, a half-open
        # connection's garbage — is an UNKNOWN, and unknowns fail CLOSED here
        # for the same reason an unreadable identity file does: we cannot
        # tell a reachable mirror from an unreachable one, and guessing
        # "reachable" is the guess that mutates the device before dying.
    }.get(entware, CheckState.BLOCK)
    checks.append(Check("entware", entware_state, entware or "unknown", {"raw": entware}))

    return PreflightReport(checks=checks, device=device, installed_version=installed, action=action)
