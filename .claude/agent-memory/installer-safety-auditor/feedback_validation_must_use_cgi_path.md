---
name: feedback_validation_must_use_cgi_path
description: Phase 5 validation must exercise the actual lighttpd→CGI→www-data path, not root-via-SSH with _SKIP_AUTH=1
metadata:
  type: feedback
---

Phase 5 validation must exercise the full lighttpd→CGI→www-data execution path. Running as root via SSH with `_SKIP_AUTH=1` masks permission bugs because root bypasses filesystem ACLs entirely.

**Why:** The Custom DNS feature shipped with a broken staging write (`EACCES` when `www-data` tried to create a file in `/etc/data/`). The Phase 5 test was run as root over SSH, which never hits the `EACCES` because root can write anywhere. The real www-data code path was never exercised until the UI end-to-end test ran.

**How to apply:** Any CGI feature that writes to a path not under `/etc/qmanager/` (www-data-owned) or `/tmp/` must be validated by sending an HTTP request through lighttpd, not by calling the script directly as root. Add a note to the Phase 5 validator brief whenever the CGI writes to `/etc/data/`, `/lib/systemd/`, or any other path that www-data would not ordinarily own.
