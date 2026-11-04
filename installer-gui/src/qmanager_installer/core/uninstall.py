"""Uninstall runner.

uninstall_rm520n.sh ships in the same tarball, so this reuses InstallRunner's
push -> verify -> extract -> run -> stream sequence verbatim and only swaps
the script name via the `script=` seam.

--purge is deliberately NOT exposed: it destroys user configuration, and that
is not a decision a GUI should make on someone's behalf.
"""

from __future__ import annotations

from .installer import InstallRunner


class UninstallRunner(InstallRunner):
    def __init__(self, transport, payload, on_line, on_progress, log=None, cancel_event=None) -> None:
        super().__init__(
            transport,
            payload,
            on_line=on_line,
            on_progress=on_progress,
            log=log,
            script="uninstall_rm520n.sh",
            cancel_event=cancel_event,
        )
