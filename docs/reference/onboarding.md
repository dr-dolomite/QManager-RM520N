# Onboarding — the `/setup` first-run wizard

> **Applies to:** RM520N-GL (SDX65) · code-read 2026-10-31, browser-checked with a fetch shim, **not device-tested**
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

`/setup` is the wizard a fresh install lands on before any password exists. It sets the web password (and, best-effort, the SSH root password and the device name), then offers three optional radio steps — network mode, APN or SIM profile, band preset — and an optional web-port step before handing off to `/dashboard/`. It exists so a new owner reaches a working, password-protected modem without visiting four settings pages. Every write goes to an existing CGI endpoint; the wizard has no backend of its own.

---

## Quick Reference

| Item | Value |
|------|-------|
| Route | `app/setup/page.tsx` |
| Wizard state machine | `components/onboarding/onboarding-wizard.tsx` |
| Single-card shell (dots, Back / Skip / Continue) | `components/onboarding/onboarding-shell.tsx` (`TOTAL_STEPS`) |
| Selectable row | `components/onboarding/option-row.tsx` |
| Shared write helper | `components/onboarding/post-step.ts` (`postStep`, `stepFailureMessage`) |
| Family shapes | `components/onboarding/shapes.ts` (`SHELL_CARD`, `optionRow`, `INNER_TILE`, …) |
| Steps | `components/onboarding/steps/step-{welcome,password,network-mode,connection,band-locking,web-port,done}.tsx` |
| Password rules (shared with Change Password) | `components/auth/password-requirements.tsx`, `components/auth/strong-password-toggle.tsx` |
| Setup gate | `GET /cgi-bin/quecmanager/auth/check.sh` → `setup_required` |
| i18n | namespace `onboarding` (`public/locales/<lang>/onboarding.json`); failures resolve through `errors`; SSH warning is `common` → `login.ssh_sync_failed` |

---

## Steps

| # | Step | Required | Backend call | Skipped / no-op when |
|---|------|----------|--------------|----------------------|
| 1 | Welcome | — | none | — |
| 2 | Password | **yes** (Continue disabled until valid) | `POST auth/login.sh`, then `POST system/settings.sh` if a device name was typed | — |
| 3 | Network mode | no | `POST cellular/settings.sh` | `AUTO` with NR5G arch `0` (the defaults) advances without a write |
| 4 | Connection | no | `POST cellular/apn.sh` **or** `POST profiles/save.sh` | nothing chosen advances without a write |
| 5 | Band preferences | no | `POST bands/lock.sh`, once per category | both presets on `all` advances without a write |
| 6 | Web port | no | `POST system/web_port.sh` | unchanged ports advance without a write |
| 7 | Done | — | none; the button opens `/dashboard/`, on the new origin after a port move (`followMove`) | — |

Skip is offered on steps 3–6 (`onSkip` in `onboarding-wizard.tsx`). Step 6 saves a port change but does not move the browser; it hands the new origin to Done (`movedOrigin`), which moves once the new origin answers and toasts `web_port.toast_unreachable` if the server rolled back — [web-port.md](web-port.md#browser-move-libweb-portts).

---

## The setup gate

`app/setup/page.tsx` decides whether to render the wizard:

1. `isLoggedIn()` true → `/dashboard/`.
2. `GET auth/check.sh`. `{"authenticated": false, "setup_required": true}` → render the wizard. Any answer without `setup_required: true` → `/login/`.
3. A fetch or JSON failure retries — `CHECK_ATTEMPTS = 3`, `CHECK_RETRY_MS = 1500` — then falls back to **`/login/`**, never to the wizard.

`useLogin()` in `hooks/use-auth.ts` makes the same choice from the other side: an unreachable `check.sh` leaves the login form in `ready`, not `setup_required`.

> ⚠️ WARNING: do not make "backend unreachable" or "empty `auth.json`" open the wizard. `is_setup_required` in `cgi_auth.sh` is true **only when `/etc/qmanager/auth.json` does not exist** — an empty or truncated file is locked, recovered with `qmanager_reset_password`. Setup sets the root SSH password, so any wider trigger reopens unauthenticated root access. See [auth-rate-limiting.md](auth-rate-limiting.md#setup-required-means-a-missing-authjson).

---

## Write contract — `post-step.ts`

Every step write except the password goes through `postStep(endpoint, body)`, which calls `authFetch` with a JSON body and **never throws**:

| Outcome | `StepWriteResult` |
|---------|-------------------|
| HTTP 2xx **and** `success === true` | `{ ok: true }` |
| Any other response | `{ ok: false, error, detail }` — `detail` is only the backend's own text, never an HTTP status |
| `fetch` rejected | `{ ok: false, unreachable: true }` |

Rules every step follows:

- **`.success` is the only signal.** These CGIs answer HTTP 200 with `{"success": false, …}` when the modem refuses, so `resp.ok` alone reports a refused write as applied. A partial apply (`cellular/settings.sh` → `{"success": false, "error": "partial_failure", "failed_fields": […], "applied_fields": […]}`) counts as a failure.
- **On failure: one `toast.error`, stay on the step.** The message comes from `stepFailureMessage(t, result, fallback)` — `shell.error_unreachable` for a transport failure, otherwise `resolveErrorMessage` on the returned `error` / `detail`. The user can correct and retry, or Skip.
- **On success: no toast.** Advancing to the next step is the confirmation (the navigation exception in [toast-confirmation.md](toast-confirmation.md#the-navigation-exception)).
- The registered submit function is cleared only on a step change (`advance` / `goBack`), never before awaiting it, so Continue after a failure re-runs the write. An in-flight flag blocks a double click. Clearing it before the await made a retry skip the write and advance with no password set.

---

## Step 2 — Password

```json
POST /cgi-bin/quecmanager/auth/login.sh
{ "password": "Abc123", "confirm": "Abc123", "enforce_strong": true }
```

Sent by `setupPassword()` in `hooks/use-auth.ts` with a plain `fetch` (no session exists yet). The rules — minimum 6, and with `enforce_strong` uppercase + lowercase + digit — are checked client-side by `isPasswordValid()` and again by `login.sh`; the server copy and the `password_weak` code are in [auth-rate-limiting.md](auth-rate-limiting.md#password-strength-rule).

Success:

```json
{ "success": true, "ssh_synced": true }
```

`login.sh` also sets the session cookies here, which is what lets steps 3–5 use `authFetch`.

- **`"ssh_synced": false`** means the web password is set but the SSH root password still has its install-time value. The step still advances, and fires a 20-second `toast.warning` with `common` → `login.ssh_sync_failed`. It is the one warning in the wizard that must outlive its step.
- **Device name** is best-effort. If the field is non-empty, the step sends `{"action": "save_settings", "hostname": "<name>"}` to `POST system/settings.sh` and ignores the result; a failure never blocks onboarding and is not reported.
- Failures (`password_weak`, `password_mismatch`, `save_failed`) toast and stay.

> ⚠️ WARNING: Back from step 3 remounts step 2 with empty fields, but the password is already set. `login.sh` then takes its **normal login** branch (`confirm` is ignored): the same password logs in again and advances; a different one returns `invalid_password` and **counts as a failed login on the lockout ladder**.

---

## Step 3 — Network mode

```json
POST /cgi-bin/quecmanager/cellular/settings.sh
{ "mode_pref": "LTE:NR5G", "nr5g_mode": 2 }
```

| Field | Values sent by the wizard | Server accepts |
|-------|---------------------------|----------------|
| `mode_pref` | `AUTO`, `LTE`, `NR5G`, `LTE:NR5G` | also `WCDMA`, `LTE:WCDMA`, `NR5G:LTE:WCDMA` |
| `nr5g_mode` | `0` auto, `1` NSA, `2` SA — reset to `0` when a non-5G mode is picked | `0`, `1`, `2` |

Both fields are always sent together. The endpoint and its AT commands are in [cellular-basic-settings.md](cellular-basic-settings.md).

---

## Step 4 — Connection (APN or SIM profile)

The PDP-type select holds the profile store's AT spelling (`IPV4V6`, `IP`, `IPV6`). The two endpoints disagree on vocabulary, so the APN branch maps it through `APN_PDP` first.

**APN only** — the single-APN (WS6) branch of `apn.sh`, chosen because the body has no `index` key:

```json
POST /cgi-bin/quecmanager/cellular/apn.sh
{ "action": "save", "cid": 1, "pdp_type": "ipv4v6", "apn": "internet" }
```

`pdp_type` must be **lowercase** `ipv4` / `ipv6` / `ipv4v6`; anything else returns `invalid_pdp_type`. `action: "save"` is required.

**Save as a SIM profile:**

```json
POST /cgi-bin/quecmanager/profiles/save.sh
{ "name": "Home", "mno": "custom", "sim_iccid": "", "cid": 1, "apn_name": "internet",
  "pdp_type": "IPV4V6", "imei": "", "ttl": 0, "hl": 0 }
```

Here `pdp_type` is **uppercase** `IP` / `IPV6` / `IPV4V6` (`_validate_pdp_type` in `profile_mgr.sh`). `mno` is the preset id, or `MNO_CUSTOM_ID` when none was picked; `ttl` / `hl` come from the preset, else `0`. `profiles/save.sh` only writes the profile file — it does not apply it to the modem ([sim-profiles.md](sim-profiles.md)).

> ⚠️ WARNING — lost response on the APN branch (not hardware-verified for the wizard). `apn.sh` runs the full `AT+COPS=2` / `AT+COPS=0` attach cycle inline. On the RM520N-GL that drops `eth0` for about 4 seconds, so a write that **landed** can come back as a rejected `fetch`. `postStep` reports that as `unreachable`, and the step toasts "Couldn't reach the modem." and stays. Unlike `/cellular/settings/apn`, the wizard has no reconciling re-read; a retry runs the attach cycle again. Mechanism: [wan-profile-management.md](wan-profile-management.md#a-lost-response-is-not-a-refusal--the-frontend-contract).

---

## Step 5 — Band preferences

```json
POST /cgi-bin/quecmanager/bands/lock.sh
{ "band_type": "lte", "bands": "1:3:7" }
```

- `band_type` is `lte`, `nsa_nr5g` or `sa_nr5g`; `bands` is **colon-delimited numbers** (anything else → `invalid_bands`).
- `lock.sh` locks one category per request, so the step sends them **serially**. One 5G choice is sent twice, as `nsa_nr5g` and `sa_nr5g`.
- Presets (`low`, `mid`, `custom`; `all` sends nothing) are filtered against the modem's own bands from `useModemStatus()`: `device.supported_lte_bands` for LTE, and the **union** of `supported_nsa_nr5g_bands` and `supported_sa_nr5g_bands` for 5G. A preset that filters to nothing sends nothing for that category.
- Because the 5G list is a union sent to both categories, a band the modem supports in only one mode reaches the other category too; if the modem refuses it, that category fails and the notice names it.
- A failure keeps `{ applied, failed }` state: one toast (`band_locking.toast_partial` or `toast_failed`), an inline notice with each category's reason, and Continue re-sends **only the failed categories**. Any edit clears that state.

Band-lock semantics and the failover watcher are in [band-locking.md](band-locking.md).

---

## Related

- Password rules, `password_weak`, the lockout ladder and the setup trigger — [auth-rate-limiting.md](auth-rate-limiting.md)
- Toast rules and the navigation exception — [toast-confirmation.md](toast-confirmation.md)
- Namespaces and `bun run i18n:check` — [i18n.md](i18n.md)
- Pre-auth `/` and `/login/` — [overview-splash.md](overview-splash.md)
