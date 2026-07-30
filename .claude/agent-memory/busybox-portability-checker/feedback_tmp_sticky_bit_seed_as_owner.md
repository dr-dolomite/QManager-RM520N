---
name: feedback_tmp_sticky_bit_seed_as_owner
description: /tmp has the sticky bit — seed throwaway test config files as the same user the CGI will run as, or mv-over-existing-file fails with a false-positive permission error
type: feedback
---

`/tmp` on RM520N-GL is `drwxrwxrwt` (sticky bit set), owned by root. In a sticky directory, only a file's OWNER (or root) can rename/unlink it — write access to the directory alone is not enough. This bit me during scoped on-device validation of `ping_profile.sh`'s optional-`profile` fix (2026-07-19): I seeded throwaway config files as the SSH login user (root) via a plain `printf > file`, then drove the CGI script as `www-data` via `sudo -u www-data`. The script's atomic key-merge (`jq ... > file.tmp && mv file.tmp file`) failed with `mv: Operation not permitted` — NOT because the script was buggy, but because `www-data` (non-owner) couldn't rename over a root-owned file inside sticky `/tmp`.

**Why this matters:** the real target directory, `/etc/qmanager/`, is `drwxrwxrwx` WITHOUT the sticky bit and already owned by `www-data:www-data` — so this failure mode cannot happen in production. It's purely a test-harness artifact of using `/tmp` as the throwaway location while seeding as a different user than the one driving the CGI.

**How to apply:** whenever scoped on-device testing seeds a throwaway config file before invoking a CGI script as `www-data`, seed it AS `www-data` too (`printf '%s' "$content" | sudo -n -u www-data sh -c "cat > '$path'"`), not as the SSH login user. If a `mv`/rename failure shows up during on-device validation, check `ls -ld` on the parent dir for the sticky bit and `ls -la` for ownership mismatch before concluding the script under test has a bug — reproduce with matched ownership first.
