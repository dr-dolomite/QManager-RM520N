---
name: scenario-profile-binding
description: How SIM profiles bind to Connection Scenarios via scenario_id; apply step order and guard behavior
metadata:
  type: project
---

Profile JSON stores `settings.scenario_id` (string: `""` | `"balanced"` | `"gaming"` | `"streaming"` | `"custom-<ts>"`). Frontend sends it as a flat top-level field `scenario_id` in the save POST body.

**Apply step order (4 steps):** `apn → ttl_hl → scenario → imei`. Scenario must precede IMEI because `AT+CFUN=1,1` reboots the modem and would wipe radio config applied after it.

**activate.sh profile_managed guard:** After parsing SCENARIO_ID and before any AT command, sources `profile_mgr.sh`, reads `get_active_profile`, checks `.settings.scenario_id` from that profile file. If non-empty, returns `cgi_error "profile_managed"` and exits. This is defense-in-depth; the frontend also gates the UI.

**scenario_mgr.sh** at `/usr/lib/qmanager/scenario_mgr.sh`:
- Load guard: `_SCENARIO_MGR_LOADED`
- `SCENARIO_DIR=/etc/qmanager/scenarios` (confirmed from save.sh)
- `ACTIVE_SCENARIO_FILE=/etc/qmanager/active_scenario`
- `scenario_apply` sets `_scenario_apply_failed` global (comma-separated AT sub-step names) on partial band-lock failure; returns 0 even for partial, returns 1 only if mode_pref AT command fails.
- Custom scenario JSON shape: `.config.atModeValue` for mode, `.config.lte_bands`, `.config.nsa_nr_bands`, `.config.sa_nr_bands` for bands (from save.sh POST body spec).

**Why:** Allows a single profile-apply action to set APN, TTL/HL, radio mode/bands, and IMEI in correct dependency order.

**How to apply:** Any new code that reads or writes scenario bindings from profiles should use `settings.scenario_id`. Any CGI that can alter radio config independently must check the profile_managed guard.
