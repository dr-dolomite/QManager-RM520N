---
name: reference_awk_comma_split_and_alternation_confirmed
description: BusyBox awk construct support confirmed live for the +CGCONTRDP comma-split parser rewrite (both devices, 2026-08-30)
type: reference
---

Confirmed live on both BusyBox awk builds (1.31.1 RM520N-GL, 1.29.3 RG501Q-EU), byte-identical output on both:

- `split(str, arr, ",")` with a literal single-char separator — works, treated literally not as regex.
- `gsub(/"/, "", f[i])` — gsub on an array element assigns back into the array correctly.
- `tolower()` — works.
- `next` inside a pattern-action block (`/pattern/ { ...; if (cond) next; ... }`) — works, resumes normal line-by-line processing.
- Alternation in a bracket-anchored ERE: `gsub(/^[ \t]+|[ \t]+$/, "", s)` — works on both builds. This was the one construct worth doubting (some minimal awk/regex engines drop `|`); BusyBox awk supports it fine.
- `sub(/^.*\+CGCONTRDP:[ \t]*/, "", line)` — escaped literal `+` plus `[ \t]` bracket expression — works.

**RG501Q-EU's live `+CGCONTRDP` response is genuinely unquoted on the wire** (`AT+CGCONTRDP=1` → `+CGCONTRDP: 1,5,SMARTLTE,10.167.105.28,,10.151.151.44,10.151.151.48`), confirmed via a real `qcmd` call, not just the SDX55 fixture in the test harness — this is a live production bug pattern, not a hypothetical.

See [[reference_ssh_upload_and_tooling]] for the upload/cleanup mechanics used to run this (`rm -rf <specific path>` works; a bare `rm -rf $var` or one built with `2>&1` in the same PowerShell block trips the local sandbox — use `find <dir> -mindepth 1 -delete` as the safe fallback for cleanup).
