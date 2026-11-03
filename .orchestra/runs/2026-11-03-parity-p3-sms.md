# Run: P3 — SMS full port (MERGED 2026-11-03, 5c96f574)

Roadmap: `.orchestra/runs/2026-10-31-rm551e-ui-parity.md` P3. Source: RM551E v0.1.34 (`D:/Projects/QM PROJECT/QManager`).
Base: development 69604a63.

## P5 close-out (2026-11-03)
- RM520N-GL 61368cd2: `qmanager-watchcat` active since 08:46:53, NRestarts 0, wants-symlink present (a Watchdog
  page save after the reboot). GET `monitoring/watchdog.sh` as www-data: 200, all 17 settings, quality limits.
- Device watchcat md5 173e34b8 = adc3bca3; development has 84025f29 (S8 Tier-4 cap) on top. Tier 4 is off, so
  no behaviour difference; deploying it needs a service restart (user OK).
- P5 worktree removed, `claude/p5-wd-backend-ea7696` deleted (merged in f0107058).

## Probe (read-only, 61368cd2; RG501Q-EU unreachable)
- `AT+CSCA?` → `+CSCA: "+639180000101",145`. qsms has no SMSC verb; RM551E also uses AT, so SMSC stays on `qcmd`.
- `AT+CPMS?` → ME/ME/ME 153/255; `AT+CPMS=?` lists ME, MT, SM, SR. `qsms status all` ME 153/255, SM 31/35.
- `qsms list all`: 184 parts, keys content/encoding/index/sender/stat/storage/timestamp; alphanumeric senders
  arrive clean (GOMO, SMART, TNT).
- No `/etc/qmanager/sms_storage`, no sent log yet.

## RM551E delta (v0.1.34)
- `sms.sh`: threads + SENT log (`sms_sent.sh`, `/usrdata/qmanager/sms_sent.json`, cap 300), `smsc` in GET,
  `?action=smsc`, `set_smsc` (AT+CSCA write + read back), delete by identity / by address, sender `addr_kind` +
  `display_source` (jq `explode`, no regex).
- `sms_storage.sh`: saved choice `/etc/qmanager/sms_storage` (ME|SM, missing = ME), applied by CPMS, read back.
- UI: thread list + conversation, composer, settings dialog (SMSC, storage), message menu, details, forward
  dialog, identity disc, short-code directory, sender logos (fetched by the browser from third parties).

## Plan
Backend (one builder, worktree):
1. `scripts/usr/lib/qmanager/sms_sent.sh` (port).
2. `cellular/sms.sh`: port the 551E model, keeping RM520N's 24 h reference split, per-memory `storage.me/sm`
   and the `--ref/--from` resume path. CPMS heal and `qmanager_sms_storage` apply the saved choice, not a fixed ME.
3. `cellular/sms_storage.sh` (port). RM520N needs no broker restore: WMS never moves CPMS.
4. Forwarder: confirm it reads SM when the choice is SM.
5. Lifecycle: confirm new lib/CGI ship by glob; uninstall removes `sms_sent.json` and `sms_storage` with
   `/etc/qmanager`; auditor only if an installer line changes.
Frontend (one builder, after the backend contract is fixed): port the 551E components and hooks
(`use-sms`, `use-sms-storage`), Forwarding page header + two-up grid + ConditionScreen; keep the read-state hook
and the per-memory meter; keys in all five catalogs; Material glyphs + `icons:check`.

Validation: gates (tsc, lint, i18n:check, icons:check, build); busybox checker; blind qm-verifier; device as
www-data: GET, `?action=smsc`, storage GET. Writes only on OK: `set_smsc` with the current value, storage
SM → ME round trip. Send/thread proof needs SIM credit.
Rollback: revert the merge; a missing choice file reads ME.

## Open calls
1. Deploy the S8 watchcat (restart) now?
2. Sender logos: port (browser fetches logos by domain from third parties) or initials only?
3. OK the two live writes above during validation?
