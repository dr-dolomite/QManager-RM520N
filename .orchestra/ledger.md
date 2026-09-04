# Orchestra ledger — custom-dns SDX55 availability gate

Run started: 2026-09-04
Mode: Full (Agent tool + real shell; no Codex CLI on this machine)
LEAD seat: Opus 5 (FRONTIER) — conductor
Baseline commit: 764a5e5 (branch: development)
Baseline dirty: ` M scripts/usr/bin/qmanager_poller` (pre-existing, outside every write set)

## Routing decisions
- A backend CGI tri-state gate -> WORKHORSE -> orchestra-worker (pinned opus/high) — small but load-bearing shell logic on a fail-open gate
- B frontend caption + 5 locales -> WORKHORSE -> orchestra-worker — mechanical but i18n:check gates it
- C docs -> WORKHORSE -> orchestra-worker — prose, needs the real diff first
- Device verification -> conductor (only seat with SSH creds + CLAUDE.md says device run is authoritative)
- Blind verification -> orchestra-verifier (FRONTIER, inherit)

## Tasks
| id | task | seat | write set | state |
|----|------|------|-----------|-------|
| A | get_dns_mode tri-state + resolv fallback | orchestra-worker | scripts/www/cgi-bin/quecmanager/network/custom_dns.sh | DISPATCHED |
| B | ABSENT caption + locales + type comment | orchestra-worker | components/local-network/custom-dns/dns-strip.tsx, public/locales/*/common.json, types/custom-dns.ts | DISPATCHED |
| C | docs: custom-dns.md + platform-matrix.md | orchestra-worker | docs/reference/custom-dns.md, docs/reference/platform-matrix.md | PENDING |

## Attempts (append-only)
- wave 1 dispatched: A + B in parallel, write sets verified disjoint
- pre-change device baselines captured by conductor for regression comparison

### Device baselines (pre-change), CGI md5 731cf779f76fc02233e4de82126f0b28 on BOTH
- RG501Q-EU (b7e3d6f1): dnsMode=UNKNOWN available=false currentUpstream=[] currentSource=unknown  <- reproduces the user report exactly
- RM520N-GL (61368cd2): dnsMode=PROXY available=true currentUpstream=[10.151.151.44,10.151.151.48] currentSource=carrier

### Acceptance for the device run
- RG501Q post-fix MUST read: dnsMode=ABSENT available=true currentUpstream=[10.151.151.44,10.151.151.48] currentSource=carrier
- RM520N post-fix MUST be byte-identical to its baseline above (no regression on the reference target)

- A: REPORTED(DONE) -> conductor device run PASSED (patched md5 1fb8fe83fdafd5706286636e6c87a2a6 confirmed on BOTH devices before running; live CGI left untouched at 731cf779)
  - RG501Q: ABSENT/true/[.44,.48]/carrier  = acceptance met
  - RM520N: PROXY/true/[.44,.48]/carrier   = byte-identical to baseline, no regression
  - GET path proven on hardware. POST (write) path NOT yet proven - needs a live config write, which requires user consent per CLAUDE.md.

- WRITE TEST on RG501Q (user-approved): POST save -> ok:true, sentinel at dnsmasq.conf:307, file returned radio:radio,
  dnsmasq PIDs 1829/1830 unchanged across HUP (reload not restart), resolution via 192.168.120.1 kept working.
  POST clear -> ok:true, block gone, `diff` vs pre-test backup CLEAN. Device fully restored; /tmp artifacts removed;
  installed CGI still 731cf779 on both. NOT proven: which upstream actually answered a query (no query logging enabled).
- Observation (pre-existing, NOT introduced here): a save flips /etc/data/dnsmasq.conf from root:radio 0664 to radio:radio 0644.
  Content restored byte-identically; owner/mode is the apply pipeline's designed chown. Both root and radio can still write.
- A: VERIFIED (device) | B: REPORTED(DONE), gates re-run by conductor: i18n:check exit 0, bun run build exit 0,
  locale diffs 3 lines each with CR/LF balance intact on all five (CRLF preserved).
- C: DISPATCHED (docs). Blind verifier DISPATCHED on the code change (A+B) with read-only device mandate.
- C: REPORTED(DONE) -> ACCEPTED. docs/reference/custom-dns.md (+110) and platform-matrix.md (+23).
- Conductor scope call: docs worker flagged the "Harness" row pointing at scripts/test/local-network-settings-design-language.sh,
  which was deleted in 9cdb945 (harnesses retired). I removed it, then REVERTED: the same dead path is referenced by
  ip-passthrough.md, ttl-mtu.md and 4 rows of DESIGN.md (where it is described as enforcing design bans). Fixing one of six
  makes the docs inconsistent, not correct. Out of scope for this commit; surfaced to the user as separate work.
  Verified the row is byte-identical to baseline and shows as a context line in the diff.
- Gates re-run after the revert: git diff --stat docs/ = 110/23 lines (no whole-file ending flip; core.autocrlf=true normalizes on commit).

- VERIFIER: PASS_WITH_NOTES. Independently reproduced the root cause, confirmed the SDX55 selector truly does not exist
  (zero DNSMode hits in mobileap_cfg.xsd and in strings over QCMAP_ConnectionManager / libqcmap_client.so.1), ran the
  regexes against 8 fixtures on BOTH BusyBox 1.29.3 and 1.31.1 with identical results, and confirmed RM520N GET is
  byte-identical patched vs baseline. Also established /etc/resolv.conf and /run/resolv.conf are the SAME file on
  RM520N (symlink chain), so the fallback loop cannot diverge there in any state.
- Findings triage:
  D1 grep rc2-means-error collapsed into ABSENT (wrong-open) -> FIXING (fix wave 1)
  D2 presence grep is line-scoped, split tag reads ABSENT      -> DOCUMENT ONLY (latent, no shipped firmware does this)
  D3 passthroughBypass stub blast radius widened               -> DOCUMENT ONLY (not rendered; no false claim reaches a user)
  D4 doc over-hedged dnsmasq 2.79 IPv6 flags (they ARE set)    -> FIXING (docs)
  D4b verifier could not confirm the save/clear cycle (read-only mandate). Conductor DID run it earlier with evidence
      in this ledger; claim stands on the conductor's run, not the verifier's.
- HEAD moved 764a5e5 -> c19f78a mid-run (parallel session, poller only). merge-base --is-ancestor 764a5e5 HEAD = true,
  all 10 files still dirty and intact. Commit will use explicit pathspecs in ONE `git commit -- <paths>` call.
- Fix wave 1 DISPATCHED (batched: D1 code + D2/D3/D4 docs). Device re-verification required after it lands.

- Fix wave 1: REPORTED(DONE) -> conductor device re-verification PASSED on BOTH devices (patched md5 8244bb10 confirmed
  on-device before running). All 7 get_dns_mode outcomes correct on BusyBox 1.29.3 AND 1.31.1, identical results.
  Empirically confirmed on-device: grep no-match rc=1, grep missing-file rc=2 — the distinction D1 relies on.
  Truncated fixture (no DHCPCfg, no DNSMode) -> UNKNOWN, i.e. the container anchor fails closed as designed.
  Real GET unchanged: RG501Q ABSENT/true, RM520N PROXY/true. Devices cleaned; installed CGI still 731cf779.
- Final gates: i18n:check exit 0, bun run build exit 0.
- A/B/C: VERIFIED. Fix wave 1: VERIFIED.
- COMMITTED c472255 (10 files) via a single `git commit -- <pathspecs>` call, .orchestra/ excluded.
- Post-commit note: DESIGN.md, ip-passthrough.md and ttl-mtu.md appeared dirty from ANOTHER session picking up the
  spawned stale-harness task. Correctly excluded from this commit. Not ours to touch.

RUN COMPLETE.
