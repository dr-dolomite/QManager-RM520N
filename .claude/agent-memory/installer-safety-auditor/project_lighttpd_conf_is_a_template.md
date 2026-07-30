---
name: project_lighttpd_conf_is_a_template
description: lighttpd.conf is a fully-overwritten static template deployed from the repo on every install/OTA, not merged — runtime CGI edits to it are pointless/dangerous; mod_alias is not currently loaded
metadata:
  type: project
---

`scripts/install_rm520n.sh` installs `/usrdata/qmanager/lighttpd.conf` via a straight `install_file` copy from the repo's `scripts/usrdata/qmanager/lighttpd.conf` (line ~1002), after backing up the previous copy to `.bak` (line 841-843). It is NOT parsed, merged, or patched — every install/OTA replaces it wholesale with whatever ships in that release's `out`/repo tree. Any runtime CGI that tried to `sed`/append into the live `lighttpd.conf` would have its change silently reverted on the next OTA.

Current `server.modules` (confirmed by reading `scripts/usrdata/qmanager/lighttpd.conf`, 2026-07-18): `mod_redirect, mod_cgi, mod_proxy, mod_openssl`. **`mod_alias` is NOT loaded.** The docs (`docs/reference/qmanager-independence.md`) list the Entware packages actually installed: `lighttpd-mod-cgi`, `lighttpd-mod-openssl`, `lighttpd-mod-redirect`, `lighttpd-mod-proxy` — no `lighttpd-mod-alias`. If a future feature needs `alias.url`, it requires BOTH (a) adding `"mod_alias"` to the shipped `server.modules` list (safe — it's baked into the versioned template, not runtime-mutated) AND (b) adding `lighttpd-mod-alias` to the Entware package install list. (b) is the trap: `install_dependencies()` (where package installs live) is skipped on every OTA via `--skip-packages` (see [[project_ota_skips_packages]]), so an existing user upgrading in-place would get a `server.modules` line referencing an uninstalled module — lighttpd fails to start entirely (full web UI outage) until they reinstall fresh or the package gets bundled/installed unconditionally.

No `server.max-*` timeout/size directives are configured in this file — CGI requests have no explicit request or execution timeout ceiling from lighttpd's side beyond defaults.

**How to apply:** Before recommending `mod_alias` (or any new lighttpd module) for a feature, check whether it's already in `server.modules` in `scripts/usrdata/qmanager/lighttpd.conf` — if not, treat adding it as equivalent risk to adding a new Entware package dependency: the opkg install step must be unconditional (outside the `--skip-packages` gate) or the feature must avoid needing a new module altogether (e.g. serving external content via a symlink inside the existing document-root instead of an alias rule, since symlink-following needs no new lighttpd module).
