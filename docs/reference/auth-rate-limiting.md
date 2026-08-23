# Auth Rate Limiting — the progressive lockout ladder

> **Applies to:** RM520N-GL (SDX65) · verified 2026-08
> **RG501Q-EU (SDX55):** unverified — see [`platform-matrix.md`](./platform-matrix.md)

QManager's login endpoint throttles brute-force password guessing with a **progressive lockout ladder**: the first five wrong passwords are free, the sixth locks the form for 30 seconds, and every *single* failure after that escalates one rung — 120s, 300s, 900s — until a correct password or an hour of quiet resets it. This replaced a flat limiter that punished a fat-fingered owner exactly as hard as it punished a script (both got a fixed 5-minute wall). The ladder is short where humans err and long where automation lives.

Short version: the limiter is a small JSON file in `/tmp` guarded by a lock file, read by three shell functions in `cgi_auth.sh`, and surfaced to the UI by two CGI endpoints. The one subtle rule is that **`auth/check.sh` may only ever *read* the limiter state** — it is called on every load of the public splash page, so a mutating read would let a visitor extend their own lockout by pressing F5.

---

## Quick Reference

| Item | Value |
|------|-------|
| Library | `scripts/usr/lib/qmanager/cgi_auth.sh` |
| State file | `/tmp/qmanager_auth_attempts.json` (tmpfs — clears on reboot) |
| Lock file | `/tmp/qmanager_auth_attempts.lock` (lazily created by `www-data`, `chmod 666`) |
| Login endpoint | `POST /cgi-bin/quecmanager/auth/login.sh` |
| Status endpoint | `GET /cgi-bin/quecmanager/auth/check.sh` (public, `_SKIP_AUTH=1`) |
| Frontend hook | `hooks/use-auth.ts` → `useLogin()` returns `lockout: LockoutState` |
| Login UI | `components/auth/login-component.tsx` |
| Test harness | `scripts/test/auth-lockout-ladder.sh` (31 assertions) |
| Run the harness | `bun run test:harness` (auto-discovered) or `sh scripts/test/auth-lockout-ladder.sh` |
| Free attempts | `MAX_ATTEMPTS=5` |
| Ladder | `LOCKOUT_STEPS="30 120 300 900"` (seconds; last entry is the cap) |
| Pre-ladder window | `LOCKOUT_WINDOW=300` (seconds the level-0 attempt counter lives) |
| Level decay | `LEVEL_DECAY=3600` (seconds of quiet before the level resets to 0) |
| i18n keys | `common` → `login.locked_title`, `login.locked_body`, `login.invalid_password`, `login.attempts_left_one/_other`, `login.locked` |

> ℹ️ NOTE — jargon. **CGI** = a shell script lighttpd executes per HTTP request as the `www-data` user. **flock** = a kernel advisory lock on a file descriptor; think of a "do not disturb" sign only one process can hold. **tmpfs** = a RAM-backed filesystem (`/tmp` here), so its contents vanish on reboot. **429** = the HTTP status for "too many requests".

---

## The ladder

| Event | Level after | Locked for | `attempts_remaining` reported |
|-------|-------------|-----------|-------------------------------|
| Failures 1–5 | 0 | — (form usable) | 4, 3, 2, 1, 0 |
| Failure 6 (the gate trips) | 1 | 30 s | 0 |
| Next single failure | 2 | 120 s | 0 |
| Next single failure | 3 | 300 s | 0 |
| Next single failure | 4 (cap) | 900 s | 0 |
| Every further failure | 4 | 900 s | 0 |
| **Successful login** | 0 | — | 5 (state file deleted) |
| **1 hour with no failure** | 0 | — | recomputed from `count` |

Two behaviours here are easy to misread and are deliberate:

- **The lock is applied *before* the password is checked.** `login.sh` calls `qm_check_rate_limit` ahead of `qm_verify_password`, so a locked-out caller gets a 429 without the hash ever being computed. A correct password submitted during a lockout is still refused.
- **Once the ladder is engaged, one failure is enough to escalate.** You do not have to fail five more times to move from 30 s to 120 s. `count` only ever gates the *first* level-0 → level-1 transition; after that the `level` field alone drives the timing. This is what makes the ladder bite a script quickly while a human who mistypes once, waits 30 seconds, and gets it right is never punished further.

### Why it decays

`LEVEL_DECAY=3600` means an hour with no failed attempt resets the level to 0 on the next read. Without it, one bad afternoon would leave the device permanently at the 15-minute rung — a self-inflicted denial of service for the owner. The decay is computed on read (from `last_failure`), not by a timer, so nothing needs to be scheduled.

---

## State file schema

`/tmp/qmanager_auth_attempts.json`:

```json
{
  "count": 3,
  "first_attempt": 1753000000,
  "locked_until": 0,
  "level": 1,
  "last_failure": 1753000000
}
```

| Field | Meaning |
|-------|---------|
| `count` | Failed attempts inside the current pre-ladder window |
| `first_attempt` | Epoch of the attempt that opened the window (`LOCKOUT_WINDOW` measures from here) |
| `locked_until` | Epoch the lockout lifts; `0` = not locked |
| `level` | Ladder rung `0`–`4`, clamped to the number of `LOCKOUT_STEPS` entries |
| `last_failure` | Epoch of the most recent failure; drives `LEVEL_DECAY` |

`level` and `last_failure` are **new** in this change. Every field is read with a jq default (`.level // 0`, `.last_failure // 0`, …), so a state file written by the pre-ladder build — which had only the first three fields — loads without error and simply starts at level 0.

> ℹ️ NOTE — **no migration is needed and `config.sh`'s missing key-migration primitive is not implicated here.** The file lives in tmpfs, so an OTA update followed by the usual reboot destroys it anyway. The defaulted reads exist for the narrower case of an in-place service restart with no reboot.

The state is written atomically (`jq -n … > "$file.tmp" && mv "$file.tmp" "$file"`), so a reader never sees a half-written object.

---

## Public functions in `cgi_auth.sh`

| Function | Mutates state | Purpose |
|----------|---------------|---------|
| `qm_get_rate_limit_status()` | **Never** | Read-only probe. Sets `RATE_LIMIT_RETRY_AFTER` and `RATE_LIMIT_ATTEMPTS_REMAINING`. Returns `0` = not locked, `1` = locked |
| `qm_check_rate_limit()` | Yes | Login-path gate. Same read, plus the level-0 → level-1 engage and the expired-window reset. Signature unchanged from before the ladder |
| `qm_record_failed_attempt()` | Yes | Called after a failed `qm_verify_password`. Bumps `count`; if the ladder is already engaged, escalates a rung and re-locks |
| `qm_clear_attempts()` | Yes | Called on successful login. Deletes the state file — level, count and lock all gone |
| `qm_attempts_flock_wait <fd> <timeout>` | — | Bounded lock acquisition, see below |

`cgi_base.sh` gained a stub for `qm_get_rate_limit_status` alongside the existing auth stubs, so a script sourcing the base without the auth library still resolves the symbol.

### Two invariants that a future edit will otherwise break

**1. `check.sh` must call only the read-only accessor.**

`auth/check.sh` is `_SKIP_AUTH=1` and is fetched by `app/page.tsx` — the public overview splash — on **every page load**. If it called `qm_check_rate_limit` instead of `qm_get_rate_limit_status`, a user sitting on a lockout could refresh the page and push their own `locked_until` further out, or trip the gate merely by visiting. Section 8 of `scripts/test/auth-lockout-ladder.sh` is a regression test for exactly this: it snapshots the state file, calls the accessor, and asserts byte-for-byte equality.

**2. Mutations happen inside a subshell, so their variables do not survive.**

Every write is wrapped like this:

```sh
_qm_ensure_attempts_lock
(
    qm_attempts_flock_wait 9 3
    _qm_engage_lockout 1
) 9<"$ATTEMPTS_LOCK"
```

The `( … ) 9<"$lock"` form is what holds the flock for the duration of the block — but it is also a **subshell**, so anything the inner functions assign (`_RL_LEVEL`, `_RL_LOCKED_UNTIL`, …) is discarded when the block exits. Callers therefore **re-read the state after the block** before reporting anything to the client; `qm_check_rate_limit` does exactly that to compute `RATE_LIMIT_RETRY_AFTER`. Adding a "just read the variable the helper set" shortcut here compiles, runs, and silently reports zeros.

### Locking on BusyBox

The device ships BusyBox v1.31.1, whose `flock` applet has **no `-w` / `--timeout`** flag. `qm_attempts_flock_wait` therefore polls `flock -x -n` in a one-second loop for a bounded number of seconds, mirroring `sim_registry_flock_wait` in `sim_registry.sh`.

If the lock is still held when the window expires, the write **proceeds unlocked** rather than hanging or failing. That is the deliberate tradeoff: losing one counted attempt to a race is better than a login endpoint that blocks a request or returns a 500. Concurrent login attempts on a single-admin device are rare enough that the exposure is theoretical.

The lock file is created lazily by the CGI (running as `www-data`) and `chmod 666`'d, because the same file may later be touched by a differently-owned process. `/tmp` is world-writable, so no installer or sudoers change was needed.

---

## Response shapes

### `POST auth/login.sh`

Locked out — **HTTP 429**:

```json
{
  "success": false,
  "error": "rate_limited",
  "detail": "Too many failed attempts",
  "retry_after": 118,
  "attempts_remaining": 0
}
```

Wrong password — **HTTP 200** (the request succeeded; the credential did not):

```json
{
  "success": false,
  "error": "invalid_password",
  "detail": "Invalid password",
  "attempts_remaining": 2
}
```

`attempts_remaining` on the invalid-password branch is produced by calling `qm_get_rate_limit_status` *after* `qm_record_failed_attempt`, so it reflects the failure that just happened.

### `GET auth/check.sh`

Authenticated (unchanged):

```json
{ "authenticated": true }
```

Unauthenticated — now carries live limiter state:

```json
{
  "authenticated": false,
  "rate_limited": true,
  "retry_after": 24,
  "attempts_remaining": 0
}
```

…and when not locked, `"rate_limited": false, "retry_after": 0, "attempts_remaining": <N>`.

This is what lets a **page reload during a lockout restore the countdown**. Before it, refreshing `/login/` re-enabled the submit button; pressing it simply earned another 429 with no explanation of why the form had lied.

> ⚠️ WARNING — accepted disclosure. An **anonymous** caller can now learn that the device is currently rate-limited and how long is left. This is a real, deliberate widening of the unauthenticated surface. It reveals no credential material and no device identity, and the alternative (a login form that cannot tell the user why it is refusing them) was judged worse for a single-admin appliance on a private LAN. Treat any further field added to `check.sh`'s unauthenticated branch as a security change.

---

## Two design decisions, chosen knowingly

### 1. The counter is global, not per-IP

There is one `count`/`level` pair for the whole device, not one per client address.

On a single-admin appliance sitting on a private LAN, per-IP keying buys little: an attacker on the same LAN can usually pick a fresh source address, and the store would need to become a keyed map with stale-entry pruning — meaningful complexity in shell, for a threat model that is mostly "someone on the LAN".

**The consequence is real and accepted:** one attacker can lock out the legitimate owner. On this device that is a nuisance, not a compromise — the owner can still reach the modem over SSH/ADB, and the lockout self-clears in at most 15 minutes.

### 2. State lives in `/tmp`, so a reboot clears the lockout

`/tmp` is tmpfs. Rebooting the modem wipes `qmanager_auth_attempts.json` and drops the level to 0.

Only an authenticated user can reboot through the UI, so this is **not a privilege-escalation path** from the web interface. It *is* a genuine bypass for anyone with physical access to the power supply — pull power, and the ladder resets.

It was chosen over `/etc/qmanager/` (the persistent UBIFS partition) because the alternative is a **flash write on every failed login attempt**. A brute-force script would then be writing to flash a few times a second — turning the rate limiter into a wear-out vector against the device it protects. An attacker who can already power-cycle the modem has stronger options than guessing the web password.

---

## Gotcha: `attempts_remaining: 0` on an *unlocked* form

This is a real, reachable state and it looks like a bug.

Once a user is on the ladder and a lockout expires, the form becomes usable again — but `attempts_remaining` still reports **0**, because `count` stays at 5-or-more until either a successful login or the one-hour decay. The value is honest: it means **"the next wrong password re-locks you immediately"**, not "you cannot try".

The UI handles it by *not* rendering a countdown at zero. `login-component.tsx` shows the plain `login.invalid_password` ("Incorrect password.") in that state rather than `login.attempts_left` ("0 attempts left."), which would be both alarming and wrong. `LoginResult.attempts_remaining` in `hooks/use-auth.ts` carries a comment saying so.

---

## Frontend contract

`hooks/use-auth.ts` exports three new types:

```ts
type LoginError = "invalid_password" | "rate_limited" | "setup_required" | "network";

interface LoginResult {
  success: boolean;
  error?: LoginError;
  detail?: string;            // backend English, diagnostic fallback only
  retry_after?: number;       // present when error is "rate_limited"
  attempts_remaining?: number;
}

interface LockoutState {
  active: boolean;
  retryAfter: number;
  attemptsRemaining: number;
}
```

`useLogin()` now also returns `lockout`, seeded on mount from `check.sh` (fetched with `cache: "no-store"` — a cached copy would show an enabled button during a lockout the server is still enforcing).

> ℹ️ NOTE — **a pre-existing bug was fixed here.** The old code returned `error: data.detail || data.error`, overwriting the machine sentinel with human-readable English. That made `rate_limited` indistinguishable from any other failure at the call site, which is why the login form could not previously branch on it. `error` now always carries the sentinel; the backend's prose moved to `detail`.

The lockout label is formatted by `formatLockout()` in `login-component.tsx`: `28 s` under a minute, `4:32` above it. The 900-second rung is what forced this — which is also why the i18n template changed from `"Locked ({{seconds}}s)"` to `"Locked ({{seconds}})"` in all five locales. **The unit must not be baked into the template**; the formatter owns it.

---

## Running the harness

```sh
sh scripts/test/auth-lockout-ladder.sh     # directly
bun run test:harness                       # via scripts/test/run-harnesses.sh (auto-discovered)
```

31 assertions across eight sections:

1. The first five failures are allowed, and `attempts_remaining` counts down
2. Attempt 6 engages the ladder at 30 s, before the password is checked
3. Once on the ladder, each single failure escalates one rung
4. The ladder caps rather than growing without bound
5. A successful login clears the ladder completely
6. An hour of quiet decays the level back to zero
7. A pre-upgrade state file without `level`/`last_failure` still loads
8. The read-only accessor used by `check.sh` never mutates state

The harness **fast-forwards by rewriting timestamps** in the state file rather than sleeping, so the full 900-second ladder runs in well under a second. It sources the real library against a temp `ATTEMPTS_FILE`; no modem is needed.

Two deliberate omissions, both explained in the file's own header:

- **No `set -e`** — `qm_check_rate_limit` returns `1` as the normal "you are locked" signal, so `-e` would abort on the first *correct* lockout.
- **No `set -u`** — the library guards its own re-entry with `[ -n "$_CGI_AUTH_LOADED" ]` on an intentionally-unset variable. lighttpd never runs CGI under `-u`, so imposing it would test a shell the library never meets.

Failures are counted explicitly instead. If `flock` is absent on the dev host it is stubbed with a note; on a real box the actual lock path is exercised.

---

## Validation performed

- `busybox-portability-checker`: PASS on all seven categories, with live on-device confirmation that `flock -x -n` works and `-w` does not exist, that jq 1.7.1 handles `@tsv`, and that `www-data` can create and lock a file in `/tmp`.
- `installer-safety-auditor`: CLEAR — no installer, sudoers, systemd or OTA surface is touched.
- `scripts/test/run-all.sh`: PASS, 158 scripts. New harness 31/31.

---

## Related docs

- Session model, cookies, `require_auth` / `_SKIP_AUTH` — `docs/reference/qmanager-independence.md`
- The public splash that calls `check.sh` on every load — `docs/reference/overview-splash.md`
- Pre-auth visual language, `TonalBanner`, the pre-auth type scale — `DESIGN.md` > Typography > Hierarchy (pre-auth card exception)
- Glyphs on the pre-auth routes — `docs/reference/icon-system.md`
