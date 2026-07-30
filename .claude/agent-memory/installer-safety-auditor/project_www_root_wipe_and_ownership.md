---
name: project_www_root_wipe_and_ownership
description: install_frontend() wipes everything under $WWW_ROOT except cgi-bin on EVERY install and OTA; $WWW_ROOT itself is root-owned, not www-data
metadata:
  type: project
---

Confirmed by reading `scripts/install_rm520n.sh` (2026-07-18):

- `WWW_ROOT="/usrdata/qmanager/www"` (line ~26/51). `install_frontend()` (line 851) runs on every fresh install AND every OTA upgrade (called from `main()` whenever `DO_FRONTEND=1`, which is the default — `qmanager_update` never passes a flag that disables it). Its cleanup loop:
  ```
  for item in "$WWW_ROOT"/*; do
      name=$(basename "$item")
      case "$name" in
          cgi-bin) continue ;;
          *) rm -rf "$item" ;;
      esac
  done
  cp -r "$SRC_FRONTEND"/* "$WWW_ROOT/"
  ```
  This `rm -rf`s every top-level entry directly under `$WWW_ROOT` except `cgi-bin`, then replaces it with the freshly built Next.js static export (`out/`). Any file, directory, OR symlink placed at the top level of `$WWW_ROOT` by anything other than the shipped `out/` tree is **destroyed on the next install/OTA** — including a symlink meant to point at externally-downloaded content (e.g. downloadable language packs, user uploads, etc.). A symlink survives as a symlink object being deleted (rm -rf on a symlink just unlinks it, doesn't touch the target) — the target directory itself is untouched if it lives outside `$WWW_ROOT` — but the symlink must be RECREATED after every `install_frontend()` run or the target becomes unreachable via HTTP until the next install.
- `$WWW_ROOT` is never `chown`ed to `www-data`. It's created via plain `mkdir -p` while running as root, so it (and everything `cp -r`'d into it) ends up root-owned. Contrast with `$CONF_DIR` (`/etc/qmanager`, chowned `www-data:www-data` at line 1024) and `$SESSION_DIR` (chowned `www-data:www-data` at line 1056) — those ARE handed to www-data. A CGI (running as www-data) cannot write directly into `$WWW_ROOT` or any root-owned subdirectory under it without EACCES.
- Sibling directories under `/usrdata/qmanager/` OTHER than `www` (e.g. a hypothetical `/usrdata/qmanager/lang-packs/`) are NOT touched by `install_frontend()`'s cleanup loop at all — it only iterates `"$WWW_ROOT"/*`. That makes `/usrdata/qmanager/<sibling>/` a safe, OTA-durable location for any feature that needs www-data-writable, web-servable persistent storage, PROVIDED lighttpd is told to serve it (document-root is fixed at `$WWW_ROOT`, so it needs either a symlink inside `$WWW_ROOT` re-created every install, or a lighttpd alias rule — see [[project_lighttpd_conf_is_a_template]]).

**How to apply:** Any new feature that needs to place web-servable, externally-writable content (not part of the static frontend bundle) must (1) store it OUTSIDE `$WWW_ROOT`, under a dedicated `/usrdata/qmanager/<feature>/` directory the installer creates and `chown`s to `www-data:www-data` (mirroring the `/etc/data/qmanager` 0700 staging-dir pattern), and (2) if served via a symlink inside `$WWW_ROOT`, add an explicit re-link step that runs unconditionally in `install_frontend()` (or immediately after it) on every install AND every OTA — not just fresh install. Flag any design that assumes a file placed inside `$WWW_ROOT` by anything other than the installer will survive an OTA.
