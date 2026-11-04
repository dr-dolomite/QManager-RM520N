---
name: project_alert_lib_cgi_basename_collision
description: email_alerts.sh/sms_alerts.sh exist as BOTH a load-bearing poller library AND a CGI settings endpoint with the identical basename in different directories — a "delete legacy alert scripts" sweep must target the CGI copy only
type: project
---

Two completely different files share the same basename, in different directories:

- **Library (load-bearing, sourced by the poller daemon):** `scripts/usr/lib/qmanager/email_alerts.sh`, `scripts/usr/lib/qmanager/sms_alerts.sh`, `scripts/usr/lib/qmanager/discord_alerts.sh`. `scripts/usr/bin/qmanager_poller` (~line 351-361) does `. /usr/lib/qmanager/email_alerts.sh 2>/dev/null || { qlog_warn "..."; check_email_alert() { :; }; email_alerts_init() { :; }; }` — i.e. **if this library goes missing, the poller silently degrades to a no-op stub and logs only a `qlog_warn`**. No fatal error, no installer-visible failure — alert delivery just quietly stops working after an OTA that deletes the wrong file.
- **CGI endpoint (settings UI backend, safe to retire):** `scripts/www/cgi-bin/quecmanager/monitoring/email_alerts.sh`, `scripts/www/cgi-bin/quecmanager/monitoring/sms_alerts.sh`, `scripts/www/cgi-bin/quecmanager/monitoring/discord_bot/configure.sh` (discord's CGI endpoint is named `discord_bot/configure.sh`, NOT `discord_bot.sh` — there is no `discord_bot.sh` lib file; the discord library is `discord_alerts.sh`).

**How to apply:** Any design brief that says "delete legacy CGI scripts: email_alerts.sh, sms_alerts.sh, discord_bot/*.sh" is ambiguous by basename alone and MUST be checked against full paths before a builder acts on it — a naive `find -name email_alerts.sh -delete` or a builder pattern-matching on basename would catch the `usr/lib/qmanager` copy too and silently kill email/SMS alert delivery repo-wide. Audits/plans should always spell out the full relative path for "delete" targets in this area, and explicitly state that the `usr/lib/qmanager/*_alerts.sh` libraries are retained. See the crash.log/alerts audit dated 2026-07-20 for the concrete instance this was caught in.

Related: `qmanager_poller`'s "optional, non-fatal" sourcing pattern for these libs means the installer's `cleanup_legacy_scripts()` (filesystem-diff based, see project_config_pruning_asymmetry.md) would ALSO remove any of these libs if they're absent from source in a future refactor — same class of risk from a different code path.
