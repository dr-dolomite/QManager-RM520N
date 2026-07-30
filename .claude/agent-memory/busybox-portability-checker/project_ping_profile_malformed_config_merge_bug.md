---
name: project_ping_profile_malformed_config_merge_bug
description: Pre-existing (not newly introduced) latent bug in ping_profile.sh POST handler — malformed existing config crashes the atomic key-merge with write_failed
type: project
---

`scripts/www/cgi-bin/quecmanager/settings/ping_profile.sh`'s POST handler reads the existing config file's raw bytes into `existing_json` (line ~184: `existing_json=$(cat "$CONFIG" 2>/dev/null)`) and pipes them straight into `jq` for the atomic key-merge (line ~188), with no `jq empty`/validity check first. If `$CONFIG` contains anything that isn't valid JSON (e.g. corrupted by a partial write, disk-full, or an old/foreign format), the merge's `jq` call fails, `${CONFIG}.tmp` is removed, and the endpoint returns `{"success":false,"error":"write_failed"}` — permanently, until the file is manually fixed or deleted, since every subsequent save hits the same crash.

**Confirmed pre-existing:** reproduced with `git stash` back to HEAD (before the profile-optional fix landed) using the project's own `scripts/test/ping-profile-cgi.sh` — Test 7 deliberately writes `this is not valid json` into `$PING_PROFILE_CONFIG` to test the GET fallback path, and the next POST test ("bare hostname accepted") then fails with a `jq: parse error` because it inherits that corrupted file. This is a **test-ordering-revealed latent bug in the merge logic itself**, not something the profile-optional change introduced — verified byte-for-byte identical on both the fixed and pre-fix versions of the file.

**Not blocking for the profile-optional fix** (out of scope — that fix only touches the `new_profile` resolution logic, lines ~146-161, and doesn't touch the merge). Worth a follow-up ticket: harden the merge to fall back to `{}` when `existing_json` fails `jq -e . >/dev/null 2>&1`, mirroring the GET path's `case` fallback pattern, so a corrupted config self-heals on next save instead of wedging the endpoint.
