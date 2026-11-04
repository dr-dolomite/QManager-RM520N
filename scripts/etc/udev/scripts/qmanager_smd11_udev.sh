#!/bin/sh
# =============================================================================
# qmanager_smd11_udev.sh — udev hook for /dev/smd11 permissions
# =============================================================================
# Invoked by /etc/udev/rules.d/99-qmanager-smd11.rules whenever the kernel
# emits an "add" event for /dev/smd11. Sets ownership to root:dialout and
# mode 660 so www-data (member of dialout) can open the device for AT
# commands via qcmd.
#
# This runs in udev's minimal environment (no PATH, no controlling tty).
# We set PATH explicitly to cover both /bin and /usr/bin layouts (RM520N-GL
# uses /bin; PRAIRE-derived platforms may use /usr/bin via usrmerge).
#
# Exit 0 unconditionally — udev logs RUN+= failures noisily and we do not
# want a missing /dev node (race between event and our handler) to spam the
# kernel log. The qmanager_setup oneshot covers any miss at boot.
# =============================================================================

PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

DEVICE="/dev/smd11"

if [ -c "$DEVICE" ]; then
    chown root:dialout "$DEVICE" 2>/dev/null
    chmod 660 "$DEVICE" 2>/dev/null
fi

exit 0
