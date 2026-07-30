---
name: project_install_file_elf_and_config_defaults
description: install_file() auto-detects ELF to skip CRLF-stripping binaries; qm_config_get() already has a safe missing-key fallback
type: project
---

Two mechanisms that make binary↔script swaps and config-schema additions safer
than they'd first appear:

**`install_file()` (install_rm520n.sh line 176-189) auto-detects ELF.** It
peeks the first 4 bytes for the `\x7fELF` magic; if absent, it runs
`tr -d '\r'` before the final `chmod`. This means CRLF-stripping is NOT
hardcoded to a file-extension allowlist — it's driven by content sniffing. A
file that used to be a compiled ELF binary and becomes a POSIX shell script
(same install call site, same destination path) automatically starts getting
CRLF-stripped with zero installer changes required. Conversely a real ELF
binary is correctly left untouched (stripping `\r` bytes from it would corrupt
the binary). `install_tree()` (line 207) does the equivalent per-file check
for whole-directory deploys (CGI tree, etc).

**`qm_config_get()` (scripts/usr/lib/qmanager/config.sh line 71-82) already
has a safe default-on-missing-key pattern**: `jq '.[$s][$k] // empty'`, and if
that's empty, returns the caller-supplied `$3` default instead. This means new
keys added to an existing JSON section (e.g. adding `ping_interval` under
`[watchcat]`) are SAFE on already-upgraded devices PROVIDED every read call
site passes an explicit default (`qm_config_get watchcat ping_interval "5"`).
The hazard isn't reading a missing key — it's `qm_config_init` (line 13-14)
short-circuiting (`[ -s "$QM_CONFIG" ] && return 0`) on any device with a
non-empty config file, so the DEFAULTS heredoc's baked-in values for a brand
new key never reach an already-installed device's file. The key simply won't
exist there, ever, unless something explicitly `qm_config_set`s it. Every call
site MUST supply its own inline default — never assume `qm_config_init`
backfills new keys into existing installs.

**How to apply:** when reviewing a Tier-4 diff that adds new `qmanager.conf`
keys, grep every `qm_config_get section key` call site for that key and
confirm none of them omit the third (default) argument.
