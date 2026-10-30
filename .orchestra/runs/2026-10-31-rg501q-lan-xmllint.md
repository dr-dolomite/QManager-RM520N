# 2026-10-31 — rg501q-lan-xmllint

Session: rg501q-lan-xmllint (side session of the atd-poller residue PM). Branch `claude/rg501q-lan-xmllint-8584ed`, based on `development` 5b985b4f.

## Problem

RG501Q-EU has no `xmllint`. `qm_lan_read` returned 2, so `network/lan_config.sh` GET answered `lan_read_failed`; `qmanager_lan_apply` exited 5 `xmllint_missing`; installer normalize skipped.

## Plan (Small lane)

1. Replace the four `xmllint --xpath` reads in `scripts/usr/lib/qmanager/lan_subnet.sh` with one awk pass scoped to `<MobileAPLanCfg>` / `<DHCPCfg>`.
2. Keep `xmllint --noout` in `qm_lan_write` only where present; drop return code 2 from lib + helper.
3. Prove on both devices from `/tmp` (awk == xmllint on RM520N-GL), then deploy-and-GET with PM go.
4. busybox-portability-checker, blind qm-verifier, docs + release-note bullet.

`install_rm520n.sh` needs no change: it only calls `qm_lan_subnet_normalize`.

## Results

- aea25f87 fix(lan): read mobileap_cfg.xml with awk, not xmllint
- 70876052 docs(lan): RG501Q-EU reads without xmllint; awk read contract
- /tmp proof, both devices (serials checked): RM520N-GL awk output equals xmllint on mobileap_cfg.xml, factory file, .qm-bak; RG501Q-EU reads 192.168.120.1 255.255.255.0 .20 .60; read works as www-data; write on a copy changes only the 3 target lines and keeps 1001:1001 0755; normalize on factory copies follows its rule. Live mobileap_cfg.xml md5 unchanged.
- busybox-portability-checker: SAFE TO SHIP on both devices (CRLF, space-indent and no-indent copies; write on copies; xmllint branch ran on RM520N-GL, skipped on RG501Q-EU).
- Deploy 2026-10-31, user yes in this session + PM go. Both devices: lan_subnet.sh 4851a4f07600070d3a71d6fb7e97e860 and qmanager_lan_apply 95c80c0125d03878b809a1a281e23c3f, equal to aea25f87. Old copies in /tmp/lanship/*.orig (RAM only). New lib left in place.
  - RG501Q-EU b7e3d6f1, GET lan_config.sh as www-data (minted session): success, 192.168.120.1, 255.255.255.0, prefix 24. Before: lan_read_failed.
  - RM520N-GL 61368cd2, same GET: success, 192.168.225.1, 255.255.255.0, prefix 24.
  - mobileap_cfg.xml md5 unchanged on both (eebbc8d8…, 6345d32d…). No POST, reboot or restart.
- Not run: a real apply (POST + reboot) on either device.
- qm-verifier (blind): PASS_WITH_NOTES. Its 'other session deployed' note was this session's approved deploy; release-note bullet trimmed to 2 sentences.
