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
    # False only when the identity read itself failed (non-zero exit) — a
    # missing file, a permission error, a dead shell. Distinct from a
    # successful read that simply found no "Project Name:" line (that case
    # is identity_read_ok=True, project_name="", tier=UNKNOWN, and the
    # installer's own `""` case arm warns-and-proceeds for it). The model
    # gate in preflight.py needs this split: since the GUI always passes
    # --force, the installer's own RM551E* hard-block never runs, so an
    # unreadable identity file must fail the GUI's gate closed instead of
    # warning.
    identity_read_ok: bool


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
        identity_read_ok=version.ok,
    )
