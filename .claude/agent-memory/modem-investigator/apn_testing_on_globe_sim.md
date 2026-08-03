---
name: apn-testing-on-globe-sim
description: The Globe PH test SIM grants an arbitrary APN verbatim, so http.globe.com.ph is a safe non-default APN for proving attach-cycle behavior; carrier default comes back UPPERCASE
metadata:
  type: reference
---

When testing APN apply/attach behavior on the live RM520N-GL (Globe PH SIM, ICCID ...8860):

- **`http.globe.com.ph` is a reliable non-default test APN.** The network grants it verbatim — `AT+CGCONTRDP=1` echoes it back exactly. This matters because a test APN the carrier *rejects* makes an attach-cycle test ambiguous: you cannot tell "the fix didn't detach" from "the fix detached correctly but the network refused the APN".
- **Always pre-flight the candidate APN with a manual bracket before building the real test.** `AT+CGDCONT=1,"IPV4V6","<apn>"` / sleep 3 / `AT+COPS=2` / sleep 1 / `AT+COPS=0` / sleep 6 / `AT+CGCONTRDP=1`. Two minutes here removes the main source of false FAILs.
- **Carrier default reads back as `INTERNET.GLOBE.COM.PH` (uppercase) only when the context attaches with a BLANK configured APN.** Once you explicitly configure `internet.globe.com.ph` and re-bracket, the negotiated value comes back lowercase. Same APN, different case — so any skip-check comparing configured vs negotiated **must** case-fold, and don't treat the case flip as a restoration failure.
- The bearer alternates between an IPv4-only (`100.101.x.x`) and a dual-stack/IPv6 (`32.1.15.216...`) grant across successive attaches on this SIM. Not a fault — don't read it as a regression.

**Why:** these three facts each produced a misleading intermediate result during the 2026-08-03 APN attach-cycle verification.

**How to apply:** any live test of APN write / attach / revert behavior. Compare the NEGOTIATED view (`AT+CGCONTRDP=<cid>`) — `AT+CGDCONT?` only echoes what was requested and will happily show a value the network never granted.
