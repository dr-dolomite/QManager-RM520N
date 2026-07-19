#!/bin/sh
# qmanager-path.sh — Ensure Entware (/opt/bin, /opt/sbin) is on PATH for
# interactive login shells (serial console / getty).
#
# SSH sessions and CGI scripts already get this: cgi_base.sh exports a full
# PATH for CGI, and the dropbear login profile covers SSH. This file only
# closes the one remaining gap — a physical/serial console login shell,
# which sources /etc/profile.d/*.sh via /etc/profile but otherwise starts
# with the vendor's bare PATH. Purely cosmetic; nothing functional depends
# on this file being present.
#
# Sourced (not executed) by any POSIX-ish login shell that reads
# /etc/profile.d/*.sh — bash, dash, ash all do. Idempotent: safe to source
# more than once per shell (e.g. nested logins) without duplicating PATH.

case ":$PATH:" in
    *:/opt/bin:*)
        # Already present — nothing to do.
        ;;
    *)
        PATH="/opt/bin:/opt/sbin:$PATH"
        export PATH
        ;;
esac
