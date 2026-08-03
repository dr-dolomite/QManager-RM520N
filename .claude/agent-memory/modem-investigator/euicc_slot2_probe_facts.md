---
name: euicc-slot2-probe-facts
description: 9eSIM V0 eUICC in slot 2 needs a full power cycle to be seen (QSIMDET hot-swap off); ISD-R AID opens a logical channel; blank-profile card reports dummy all-1s ICCID/IMSI and CEREG denied
metadata:
  type: project
---

A physical 9eSIM V0 eUICC card seated in SIM slot 2 of the test RM520N-GL is only detected after a **full power cycle**, not after mid-session insertion.

**Why:** `AT+QSIMDET?` returns `0,1` — hot-swap detection is *disabled*, so the modem never re-scans the slot when a card is inserted while running. Before the reboot the card was invisible (`+QSIMSTAT: 0,0`, `+QINISTAT: 0`, CPIN/CIMI/QCCID all ERROR); after the reboot it initialized fully (`+QSIMSTAT: 0,1`, `+QINISTAT: 7`, `+CPIN: READY`).

**How to apply:**
- Never conclude "card absent / firmware lacks APDU support" from a hot-inserted card. Ask for a power cycle first, then re-probe.
- Firmware `RM520NGLAAR03A03M4G_A0.303.A0.303` has the full raw-APDU set: `AT+CSIM`, `AT+CRSM`, `AT+CCHO`, `AT+CCHC`, `AT+CGLA`.
- `AT+CCHO="A0000005591010FFFFFFFF8900000100"` (ISD-R AID) returns `+CCHO: 1` / OK — the ISD-R applet is reachable, so LPA-style work over `AT+CGLA` is technically viable on this stack. Close with `AT+CCHC=<ch>`; leaked channels are a finite resource.
- A blank eUICC (zero enabled profiles) still reports `CPIN: READY` and returns **placeholder** identifiers — `+QCCID: 89111111111111111111` and `AT+CIMI` → `111111111111111` (all-1s). Treat an all-1s ICCID/IMSI as "eUICC with no operational profile", not as a real SIM. This will make SIM-detection / `known_iccids` / the SIM-swap banner register a bogus SIM identity.
- With no profile enabled, `+CEREG: 0,3` (registration denied), `+CGREG: 0,0`, `+COPS: 0` — expected, not a fault.
