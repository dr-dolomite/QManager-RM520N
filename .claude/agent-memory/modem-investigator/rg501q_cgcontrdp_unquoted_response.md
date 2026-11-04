---
name: rg501q-cgcontrdp-unquoted-response
description: RG501Q-EU returns +CGCONTRDP fields UNQUOTED while RM520N-GL quotes them — breaks every awk -F'"' parser; also affects the grep -iv '"ims"' filter
metadata:
  type: reference
---

**AT+CGCONTRDP response quoting differs between the two devices.** Same carrier, same APN, same moment:

- RM520N-GL (`RM520NGLAAR03A03M4G_A0.304`):
  `+CGCONTRDP: 1,5,"SMARTLTE","10.148.167.210",,"10.151.151.44","10.151.151.48"`
- RG501Q-EU (`RG501QEUAAR12A11M4G_04.202`):
  `+CGCONTRDP: 1,5,SMARTLTE,10.167.105.28,,10.151.151.44,10.151.151.48`

**Why:** the RG501Q's older SDX55 firmware emits bare tokens. `AT+CGDCONT?`,
`AT+CGPADDR` and `AT+QMAP` are still quoted on BOTH devices — the divergence is
specific to `+CGCONTRDP`, so a spot-check of a neighbouring command will not
reveal it.

**How to apply:**
- Any parser splitting a CGCONTRDP line on `"` (`awk -F'"'`) silently returns
  **empty**, not an error, on RG501Q. Empty is indistinguishable from "context
  not up yet", so callers that poll on emptiness spin their full timeout.
- Quote-agnostic field extraction (`cut -d',' -fN | tr -d '"'`) works on both
  and is the correct shape for this command.
- A quote-dependent *filter* is the same trap: `grep -iv '"ims"'` fails to
  exclude the IMS record on RG501Q (it reads `2,6,ims,...`). It survives today
  only because cid 1 sorts first and `head -1` takes it.
- `AT+CGCONTRDP=?` also differs: RM520N advertises `( 1 )`, RG501Q `( 1,2 )`.

**Verified working on RG501Q** (all rc=0, 3/3 consistent): `AT+CGCONTRDP`,
`AT+CGCONTRDP=1`, `AT+CGCONTRDP=?`, `AT+CGACT?`, `AT+CGPADDR`. The command is
fully supported — treat any "CGCONTRDP unsupported on RG501Q" claim as a
misdiagnosed parser bug. `AT+QMAP="CONNECT"` is genuinely absent (rc=1).
See [[at_probe_over_host_com_port]] for transport fallbacks.
