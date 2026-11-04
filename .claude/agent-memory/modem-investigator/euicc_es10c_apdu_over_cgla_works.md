---
name: euicc-es10c-apdu-over-cgla-works
description: Hand-rolled ES10c APDUs over AT+CGLA work on the RM520N-GL — GetEID/GetProfilesInfo/GetEUICCInfo1 all returned 9000; includes the CGLA length-param gotcha and the working byte strings
metadata:
  type: project
---

Raw GSMA SGP.22 ES10c commands **work over `AT+CGLA`** on firmware `RM520NGLAAR03A03M4G_A0.303.A0.303` — no `lpac` needed for the read path (2026-08-01 probe, 9eSIM V0 card in slot 2).

**Why:** an LPA feasibility question. Confirmed end to end: open ISD-R with `AT+CCHO="A0000005591010FFFFFFFF8900000100"` (returns ch 1), send ES10c via STORE DATA, close with `AT+CCHC=1`. The modem handles APDU chaining itself — full response comes back inline with `9000`, no `61xx`/GET RESPONSE round-trip needed even for a 58-byte reply.

**How to apply:**
- **`AT+CGLA=<ch>,<len>,"<hex>"` — `<len>` is the count of HEX CHARACTERS, i.e. 2x the byte length** (per 3GPP 27.007). Getting this wrong is the #1 way to make a valid APDU look broken.
- Working strings (channel 1), all `SW=9000`:
  - GetEID → `AT+CGLA=1,24,"81E2910006BF3E035C015A00"`
  - GetProfilesInfo → `AT+CGLA=1,18,"81E2910003BF2D0000"`
  - GetEUICCInfo1 → `AT+CGLA=1,18,"81E2910003BF200000"`
- The card is a **strict TLV parser**: a malformed tag list (`5C025A`, length says 2 bytes but only 1 given) returns `6A80` (wrong data), not a best-effort parse. Encode ASN.1 correctly or expect clean rejection.
- Legacy `80CA004C00` (GET DATA for EID) returns `6D00` (INS not supported) — ISD-R only accepts STORE DATA (`81E29100`). Don't fall back to it.
- Test card facts: EID `89086030202200000026000175328554`; `BF2D02A000` = ProfileInfoListOk with an **empty** sequence (zero profiles, matches the all-1s placeholder ICCID); SGP.22 SVN `2.2.2`; single GSMA CI key ID `81370F5125D0B1D408D4C3B232E6D25E795BEBFB` for both verification and signing (the production/live GSMA root).
- `lpac` is still needed for the **write** path (ES9+ HTTPS to SM-DP+, BPP download, mutual auth signatures) — but enumeration/status UI can be pure shell + `qcmd`.
