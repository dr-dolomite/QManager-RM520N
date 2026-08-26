---
name: quectel-project-version-double-space-labels
description: Both RM520N-GL and RG501Q-EU write "Branch  Name:" / "Project Rev :" with irregular spacing; any single-space grep silently matches nothing
metadata:
  type: reference
---

`/etc/quectel-project-version` uses **column-aligned** labels, not single-space
ones. Verified byte-for-byte with `od -c` on 2026-08-24:

- RM520N-GL (SDX6X): `Project Name: `, `Project Rev : `, `Branch  Name: `, `Custom  Name: `
- RG501Q-EU (SDX55): identical label spacing

So `Branch` and `Custom` carry **two** spaces before `Name`, and `Project Rev`
has a space **before** the colon. `Project Name:` and `Package Time:` are the
only single-space labels.

**Why:** a `grep "^Branch Name"` (one space) matches on **neither** device — it
returns empty and every `case` falls through to the default branch. This is
invisible on RM520N-GL because the default happens to be the right answer.

**How to apply:** never write a parser for this file from a doc table or a
hand-typed fixture — those normalize the spacing and the resulting unit test
passes against a file that does not exist on any device. Match on the label
*word* with a wildcard (`^Branch[[:space:]]*Name`) and always prove it by
running the grep against the device's own bytes over SSH/adb, not a local copy.
Related: [[posh_ssh_connection_recipe]].
