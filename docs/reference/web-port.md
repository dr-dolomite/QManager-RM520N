# Web Port — custom lighttpd HTTP / HTTPS ports

> **Applies to:** RM520N-GL (SDX65) · added 2026-11-03 (P7c) · verified on hardware 2026-11-03: CGI move 80/443 → 8088/8443 applied in ~4 s, apply killed at 0.3 s and 2.5 s left every listening port DROPped on `rmnet+`, a held 8443 rolled back on its own in 14 s, CGI reset to 80/443; browser follow (Chrome, 2026-11-03): moved to :8443 within 8 s, an HTTP-only change reloaded 2 s after `applied`, back to 80/443 likewise (slow-rollback path not run live)
> **RG501Q-EU (SDX55):** lib, render and CGI parse paths verified in a /tmp sandbox; the live move is unverified

The **Web Port** card on `/system-settings/device-access` (and optional onboarding step 6) moves the ports lighttpd serves QManager on. Default 80 / 443. Plain HTTP only ever redirects to HTTPS, so the HTTPS port is the one a user opens. Ported from RM551E v0.1.34 (UI and contracts); RM551E's uhttpd/UCI backend was not ported.

## Where things live

| Piece | Path |
| --- | --- |
| Port file (the one source) | `/usrdata/qmanager/web_port` — `http=N`, `https=N`, optional `prev_http=` / `prev_https=` while a move is in flight. root 0644, **parsed, never sourced**. Missing = 80/443; writing the default pair with no prev removes the file. |
| Library | `scripts/usr/lib/qmanager/web_port.sh` → `/usr/lib/qmanager/web_port.sh` (`wp_read_file`, `wp_write_file`, `wp_validate`, `wp_render`, `wp_fw_ports`, `wp_listening`, `wp_port_open`, `wp_busy`, `wp_result`). `wp_listening` / `wp_port_taken` need root (they match lighttpd's PID in `netstat -p`); www-data sees `-` for every socket, so the CGI uses `wp_port_open` |
| Root helper | `scripts/usr/bin/qmanager_web_port` — `show` / `set H S` / `reset` (SSH and sudo), `render` / `apply` (root, refused under sudo) |
| CGI | `system/web_port.sh` — GET `{http_port, https_port, listening{http,https}, last_result}`; POST `{http_port, https_port}` → `{apply_in_progress, http_port, https_port}` |
| Result file | `/tmp/qmanager_web_port_result` — `<status> <http> <https> <epoch>`; status `pending | applied | unchanged | rolled_back | failed` |
| Lock | `/run/qmanager_web_port/lock` (flock, held by `apply`) |
| Conf markers | `scripts/usrdata/qmanager/lighttpd.conf`: three lines end in `# qm:web_port:http`, `# qm:web_port:https`, `# qm:web_port:redirect` |
| Frontend | `components/system-settings/web-port/web-port-card.tsx`, `components/onboarding/steps/step-web-port.tsx`, `hooks/use-web-port.ts`, `lib/web-port.ts`, `types/web-port.ts`; shapes `PORT_GRID` / `PORT_FIELD` / `SKELETON_WEB_PORT` |

## Invariants

- **The conf is always derived.** `lighttpd.service` runs `ExecStartPre=-/usr/bin/qmanager_web_port render`, which rewrites the three marker lines from the port file, reads them back, runs `lighttpd -tt` on the result and only then `mv`s it into place. The `-` prefix means a render failure never blocks lighttpd. A conf without all three markers is left untouched (`failed`).
- **Render reset guard.** If the saved pair fails `-tt`, render resets the port file only when 80/443 **passes** `-tt` where the saved pair failed. It never resets when `/opt/sbin/lighttpd` is not executable (`/opt` mounts ~30 s into boot). `-tt` runs before the "already identical" check, so a cert or module fault keeps the saved port.
- **Firewall before listen.** `qmanager_firewall` opens `{80, 443} ∪ configured ∪ prev` (`wp_fw_ports`) on lo / bridge0 / eth0 / tailscale0 and DROPs them on `rmnet+`. `set` reloads the firewall right after writing the port file (with prev), and `apply` reloads it again before restarting lighttpd; `render` reloads it when the conf changed. Reloads go through `systemctl reload qmanager-firewall`, then a direct call. A failed reload aborts `set` (port file restored, `error apply_failed firewall`) and `apply` (old pair restored, `failed`, lighttpd not restarted).
- **apply is detached.** `set` launches `apply` in the transient unit `qm-web-port` (`systemd-run --collect`), because restarting lighttpd kills the CGI's cgroup. Under sudo there is no in-place fallback (`error apply_failed detach`). `apply` sleeps 1 s so the CGI reply leaves first.
- **Rollback.** `apply` waits up to 10 s for both new ports to listen. If not, it writes the old pair (prev) and restarts; if that also fails, 80/443; result `rolled_back` (or `failed` if nothing listens).
- **Busy.** `set` refuses with `busy` while OTA (`/tmp/qmanager_update.pid`) or a config restore (`/tmp/qmanager_config_restore.pid`) runs, the lock is held, or `qm-web-port` exists.
- **Reserved ports**: 22, 53, 989, 5037, 8080 and the browsers' unsafe-port list (`WP_RESERVED`). A port already held by something other than lighttpd is `port_in_use`.
- Helper stdout is one line: `applying H S` | `unchanged H S` | `error <code> [arg]`. Exit 0 ok, 1 fail, 2 invalid, 3 busy. CGI error codes: `invalid_port | ports_equal | port_reserved | port_in_use | busy | apply_failed` (all in `errors.json`).

## Browser move (`lib/web-port.ts`)

A save that moves the port is self-severing. `followMove(target, path, startedAt)` polls once a second, bounded by 60 s from the save (at least 10 s from the call):

- **This origin's CGI** (`authFetch` GET, `last_result`). `set` writes `pending` before the save replies, so any other status read afterwards belongs to this move. `applied` with the target's ports navigates; `rolled_back` / `failed` / `unchanged` returns `rolled_back` on this origin (the card toasts `toast_unreachable` and refreshes). This is the only signal when the origin does not change (HTTP-only change on an HTTPS page): the old lighttpd answers `pending` until it restarts, so the browser never moves early.
- **The target** (`no-cors` probe). lighttpd binds every socket or none, so a target that answers is the applied config and the browser moves.
- **80/443**, only while this origin is down: if it answers, the rollback fell back to the defaults; the card toasts `toast_back_on` with an Open action and stays.
- After 45 s (apply's worst case: three restarts with a 10 s listen wait each) with nothing else answering, it navigates anyway, because Firefox keys certificate exceptions by host:port and the probe can fail against a working server. Trade-off: a Firefox user with no exception for 443 cannot see a rollback to 80/443, so after 45 s the browser may go to the dead target.
- `toast_timeout` when the bound is reached while this origin still answers `pending`, or when the target **is** this origin and it is still down at the bound.
- A follow is aborted (`signal`) when the card or the Done step unmounts, so it never navigates or refreshes later. Onboarding Done stays put on any failure and toasts; the next click opens `/dashboard/` where QManager is, without waiting again.

The result JSON is read only on this origin: the CGI sends `Access-Control-Allow-Origin: *`, which browsers refuse for a credentialed request, and the `qm_session` cookie (no `Domain`, `SameSite=Strict`) would reach another port but the response could not be read. The moving status tells the user to accept the certificate on the new port. Navigation is the success signal (toast navigation exception); a no-op save toasts `toast_unchanged`.

Onboarding saves on step 6 but moves only from Done (`StepDone movedOrigin: PendingMove`, the save time is carried so a late click skips the wait), so the wizard is never cut off mid-step.

## Lifecycle

- **Install / OTA**: `install_rm520n.sh` copies the conf, then runs `qmanager_web_port render` fail-soft, so a saved port survives an upgrade. `print_summary` prints `ip:port` when HTTPS ≠ 443. The GUI installer reads the port back (`InstallOutcome.https_port`) for its final link.
- **Uninstall** removes `web_port`, `.web_port.*`, `lighttpd.conf.new`, `/run/qmanager_web_port`, `/tmp/.qmanager_web_port_result.*`.
- **Health check**: "lighttpd listening on web ports" uses the lib's pair.
- **modem bridge**: `modem_cgi` reads the HTTPS port from the device; an already-running bridge keeps 443 until restarted.

## Recovery over SSH

```sh
qmanager_web_port          # configured vs listening
qmanager_web_port reset    # back to 80 / 443
```
