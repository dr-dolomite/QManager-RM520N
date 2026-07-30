---
name: phone-number-already-in-poller
description: AT+CNUM works on RM520N-GL and the poller already publishes it as status.json .device.phone_number — don't propose adding a new AT read for MSISDN
metadata:
  type: reference
---

`qcmd 'AT+CNUM'` on the live test modem returns `+CNUM: ,"+639544817486",145` — a usable E.164 MSISDN (SIM-provisioned; not guaranteed on every carrier, field 1 name is empty here).

The poller already reads it: bundled into the boot chain `AT+CVERSION;+CGMM;+CGSN;+CIMI;+QCCID;+CNUM;+QGETCAPABILITY` and re-read every cycle in the `AT+QTEMP;+COPS?;+QUIMSLOT?;+CNUM;+CPIN?` batch (so it self-updates on SIM swap). It surfaces at jq path **`.device.phone_number`** in `/tmp/qmanager_status.json`.

**How to apply:** any feature wanting the phone number (SIM identity UI, new-SIM banner detail, alerts) reads `.device.phone_number` from status.json / `useModemStatus()`. Never propose a new `qcmd 'AT+CNUM'` call — it would take the shared AT lock for data already on disk.
