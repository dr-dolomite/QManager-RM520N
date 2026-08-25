# Discord Bot Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve `/lock-band` ergonomics (comma separator + numeric sort) and add visible column gutters / vertical breathing room to query embeds (`/signal`, `/bands`).

**Architecture:** Two independent edits to `discord-bot/handlers.go` plus a one-line description tweak in `commands.go`. Both work entirely client-side in the bot — no AT command schema changes (the modem still receives colon-separated, numerically sorted bands). Spacing in embeds uses Discord's standard "invisible inline field" trick (`​` zero-width space) plus a trailing blank line in field values for vertical breathing — no Discord API changes, no embed schema migration.

**Tech Stack:** Go 1.22+, `discordgo` v0.28.1, existing `qcmd` AT bridge.

---

## File Structure

**Modify:**
- `discord-bot/handlers.go` — `parseBandOption` (accept commas, numeric sort), `buildSignalEmbed` (2-per-row layout via spacer fields), `ccField` callsite in `buildBandsEmbed` (vertical padding in field values)
- `discord-bot/embeds.go` — add `spacerField()` helper used by signal embed
- `discord-bot/commands.go` — update `lte_bands` / `nr_bands` option `Description` text from `colon-separated` to `comma-separated`
- `discord-bot/handlers_test.go` — update existing `TestParseBandOption_*` tests to use comma input; add tests for sort order and unsorted input
- `discord-bot/embeds_test.go` — add test for `spacerField()` shape
- `RELEASE_NOTES.md` — add bullet under "Unreleased / dev-rm520" section
- `CLAUDE.md` — update Discord Bot section's `lock-band` reference (separator)

**Create:** none.

The split between handlers.go and embeds.go follows the existing convention — `embeds.go` owns chrome/layout primitives (action rows, color, footer); `handlers.go` builds the per-command embeds.

---

## Task 1: parseBandOption accepts commas

**Files:**
- Modify: `discord-bot/handlers.go:645-666`
- Test: `discord-bot/handlers_test.go:372-401`

- [ ] **Step 1: Update existing tests to fail against current implementation**

Replace the four existing `TestParseBandOption_*` tests in `discord-bot/handlers_test.go` with comma-input versions, and add tests for both separators + sorting + edge cases:

```go
func TestParseBandOption_CommaSeparator(t *testing.T) {
	got := parseBandOption("B3,B28")
	if got != "3:28" {
		t.Errorf("got %q, want %q", got, "3:28")
	}
}

func TestParseBandOption_StripsNPrefix(t *testing.T) {
	got := parseBandOption("n78")
	if got != "78" {
		t.Errorf("got %q, want %q", got, "78")
	}
}

func TestParseBandOption_Auto(t *testing.T) {
	got := parseBandOption("auto")
	if got != "" {
		t.Errorf("got %q, want empty string for auto", got)
	}
}

func TestParseBandOption_MixedPrefixes(t *testing.T) {
	got := parseBandOption("B3,n78")
	if got != "3:78" {
		t.Errorf("got %q, want %q", got, "3:78")
	}
}

func TestParseBandOption_BackwardCompatColon(t *testing.T) {
	// Pre-existing users with ':' should still work.
	got := parseBandOption("B3:B28")
	if got != "3:28" {
		t.Errorf("got %q, want %q", got, "3:28")
	}
}

func TestParseBandOption_SortsNumericAscending(t *testing.T) {
	// Out-of-order input must be sorted lowest→highest before joining.
	got := parseBandOption("B28,B3,B7")
	if got != "3:7:28" {
		t.Errorf("got %q, want %q (numeric sort, not lexicographic)", got, "3:7:28")
	}
}

func TestParseBandOption_SortsWithSpaces(t *testing.T) {
	// Tolerate whitespace around commas.
	got := parseBandOption("B28, B3 ,B7")
	if got != "3:7:28" {
		t.Errorf("got %q, want %q", got, "3:7:28")
	}
}

func TestParseBandOption_DropsEmptySegments(t *testing.T) {
	// Trailing/leading commas should not produce empty segments.
	got := parseBandOption("B3,,B28,")
	if got != "3:28" {
		t.Errorf("got %q, want %q", got, "3:28")
	}
}

func TestParseBandOption_NonNumericTokenSkipped(t *testing.T) {
	// Defensive — a stray "Bxx" should be dropped, not crash sort.
	got := parseBandOption("B3,Bxx,B28")
	if got != "3:28" {
		t.Errorf("got %q, want %q", got, "3:28")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd discord-bot && go test -run TestParseBandOption -v`
Expected: all comma/sort tests FAIL — current implementation splits only on `:` and does not sort.

- [ ] **Step 3: Rewrite parseBandOption**

Replace the function at `discord-bot/handlers.go:645-666`:

```go
// parseBandOption converts user input (e.g. "B3,B28" or "n78") to AT format
// (e.g. "3:28" or "78"). Accepts commas (preferred) or colons (legacy) as
// separators. Strips B/b (LTE) and n/N (NR) prefixes. Sorts band numbers
// ascending so the modem always sees a canonical order regardless of how the
// user typed them. Non-numeric tokens are dropped. Returns "" for "auto"
// (caller sends "0" = all bands = unlock).
func parseBandOption(input string) string {
	if strings.EqualFold(strings.TrimSpace(input), "auto") {
		return ""
	}
	// Accept either "," (preferred) or ":" (legacy) as separator.
	normalized := strings.ReplaceAll(input, ":", ",")
	parts := strings.Split(normalized, ",")
	nums := make([]int, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		upper := strings.ToUpper(p)
		if strings.HasPrefix(upper, "B") || strings.HasPrefix(upper, "N") {
			p = upper[1:]
		}
		if p == "" {
			continue
		}
		n, err := strconv.Atoi(p)
		if err != nil {
			continue // skip non-numeric tokens defensively
		}
		nums = append(nums, n)
	}
	sort.Ints(nums)
	clean := make([]string, 0, len(nums))
	for _, n := range nums {
		clean = append(clean, strconv.Itoa(n))
	}
	return strings.Join(clean, ":")
}
```

Add `"sort"` to the import block at the top of `handlers.go` if not already present.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd discord-bot && go test -run TestParseBandOption -v`
Expected: all 9 tests PASS.

- [ ] **Step 5: Run full discord-bot test suite**

Run: `cd discord-bot && go test ./...`
Expected: all tests PASS (no other tests should regress — `parseBandOption` is only called from `handleLockBand`).

- [ ] **Step 6: Commit**

```bash
git add discord-bot/handlers.go discord-bot/handlers_test.go
git commit -m "$(cat <<'EOF'
feat(discord-bot): /lock-band accepts comma-separated bands and auto-sorts

- Switch separator from ':' to ',' for /lock-band lte_bands and nr_bands input
  (colon still accepted for backward compat with existing users).
- Sort band numbers ascending before issuing AT command so the modem always
  sees canonical order regardless of input order.
- Drop empty/non-numeric tokens defensively.
EOF
)"
```

---

## Task 2: Update lock-band option descriptions

**Files:**
- Modify: `discord-bot/commands.go:23, 29`

- [ ] **Step 1: Update option descriptions to match new comma syntax**

In `discord-bot/commands.go`, change:

```go
{
    Type:        discordgo.ApplicationCommandOptionString,
    Name:        "lte_bands",
    Description: "LTE bands to lock, colon-separated (e.g. B3:B28), or 'auto' to unlock",
    Required:    optional,
},
{
    Type:        discordgo.ApplicationCommandOptionString,
    Name:        "nr_bands",
    Description: "NR bands to lock, colon-separated (e.g. n78), or 'auto' to unlock",
    Required:    optional,
},
```

To:

```go
{
    Type:        discordgo.ApplicationCommandOptionString,
    Name:        "lte_bands",
    Description: "LTE bands to lock, comma-separated (e.g. B3,B7,B28), or 'auto' to unlock",
    Required:    optional,
},
{
    Type:        discordgo.ApplicationCommandOptionString,
    Name:        "nr_bands",
    Description: "NR bands to lock, comma-separated (e.g. n41,n78), or 'auto' to unlock",
    Required:    optional,
},
```

- [ ] **Step 2: Run build to verify no syntax errors**

Run: `cd discord-bot && go build ./...`
Expected: builds clean (no output).

- [ ] **Step 3: Commit**

```bash
git add discord-bot/commands.go
git commit -m "feat(discord-bot): update /lock-band option descriptions to use comma examples"
```

---

## Task 3: Add spacerField helper

**Files:**
- Modify: `discord-bot/embeds.go` (append helper after `navEmojiFor`, before `capitalize`)
- Test: `discord-bot/embeds_test.go`

- [ ] **Step 1: Write failing test for spacerField shape**

Append to `discord-bot/embeds_test.go`:

```go
func TestSpacerField_IsInvisibleInline(t *testing.T) {
	f := spacerField()
	if f == nil {
		t.Fatal("spacerField returned nil")
	}
	if !f.Inline {
		t.Error("spacer must be Inline=true so it occupies a column slot")
	}
	if f.Name != "​" {
		t.Errorf("spacer Name = %q, want zero-width space", f.Name)
	}
	if f.Value != "​" {
		t.Errorf("spacer Value = %q, want zero-width space", f.Value)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd discord-bot && go test -run TestSpacerField -v`
Expected: FAIL with "undefined: spacerField".

- [ ] **Step 3: Add spacerField helper to embeds.go**

Append to `discord-bot/embeds.go` (after `navEmojiFor`, before `capitalize`):

```go
// spacerField returns an invisible inline field used to widen column gutters in
// embeds. Discord packs up to 3 inline fields per row; pairing 2 content fields
// with a trailing spacer renders them at ~33% width each but visually grouped
// as a 2-column layout with breathing room on the right. The U+200B (zero-width
// space) glyph is required — Discord rejects empty strings for Name/Value.
func spacerField() *discordgo.MessageEmbedField {
	return &discordgo.MessageEmbedField{
		Name:   "​",
		Value:  "​",
		Inline: true,
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd discord-bot && go test -run TestSpacerField -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add discord-bot/embeds.go discord-bot/embeds_test.go
git commit -m "feat(discord-bot): add spacerField helper for embed column gutters"
```

---

## Task 4: /signal embed — 2-per-row layout + vertical breathing

**Files:**
- Modify: `discord-bot/handlers.go:22-71` (`buildSignalEmbed`)
- Test: `discord-bot/handlers_test.go` (existing `TestBuildSignalEmbed_*`)

- [ ] **Step 1: Find existing signal embed tests**

Run: `cd discord-bot && grep -n "TestBuildSignalEmbed\|TestSignalEmbed" handlers_test.go`
Note the test names — these will need updating since field count and ordering change. Read each one (`Read handlers_test.go offset=<line>`) to understand current assertions.

- [ ] **Step 2: Write failing test for new layout**

Append to `discord-bot/handlers_test.go`:

```go
func TestBuildSignalEmbed_TwoAntennasPerRowWithSpacer(t *testing.T) {
	s := makeStatus("true", "true", "5G-NSA")
	// Ensure all 4 antennas have data.
	s.SignalPerAntenna = map[string]AntennaSignal{
		"main":      {RSRP: "-90", SINR: "10", RSRQ: "-10"},
		"diversity": {RSRP: "-92", SINR: "9", RSRQ: "-11"},
		"mimo3":     {RSRP: "-95", SINR: "8", RSRQ: "-12"},
		"mimo4":     {RSRP: "-97", SINR: "7", RSRQ: "-13"},
	}
	embed := buildSignalEmbed(s)

	// Expect: main, diversity, spacer, mimo3, mimo4, spacer, [source]
	// At minimum: 2 spacer fields interleaved between antenna pairs.
	spacerCount := 0
	for _, f := range embed.Fields {
		if f.Name == "​" && f.Value == "​" {
			spacerCount++
		}
	}
	if spacerCount != 2 {
		t.Errorf("expected 2 spacer fields between antenna pairs, got %d", spacerCount)
	}

	// Spacer should appear AFTER index 1 (second antenna) and AFTER index 4 (fourth antenna),
	// i.e. at indexes 2 and 5 in the antenna section.
	if len(embed.Fields) < 6 {
		t.Fatalf("expected at least 6 fields (4 antennas + 2 spacers), got %d", len(embed.Fields))
	}
	if embed.Fields[2].Name != "​" {
		t.Errorf("expected spacer at index 2, got name=%q", embed.Fields[2].Name)
	}
	if embed.Fields[5].Name != "​" {
		t.Errorf("expected spacer at index 5, got name=%q", embed.Fields[5].Name)
	}
}

func TestBuildSignalEmbed_AntennaValuesHaveTrailingBlankLine(t *testing.T) {
	s := makeStatus("true", "true", "5G-NSA")
	s.SignalPerAntenna = map[string]AntennaSignal{
		"main": {RSRP: "-90", SINR: "10", RSRQ: "-10"},
	}
	embed := buildSignalEmbed(s)

	// First field should be Main and value should end with the zero-width
	// space line (vertical breathing room).
	if len(embed.Fields) == 0 {
		t.Fatal("no fields in signal embed")
	}
	val := embed.Fields[0].Value
	if !strings.HasSuffix(val, "\n​") {
		t.Errorf("expected antenna value to end with newline+zero-width-space for vertical breathing; got %q", val)
	}
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd discord-bot && go test -run TestBuildSignalEmbed -v`
Expected: FAIL — current implementation has no spacer fields and no trailing zero-width line.

- [ ] **Step 4: Update buildSignalEmbed**

Replace the loop body in `discord-bot/handlers.go:40-54` and surrounding logic. The full updated function:

```go
func buildSignalEmbed(s *ModemStatus) *discordgo.MessageEmbed {
	bucket := signalQualityBucket(s.SignalPerAntenna)
	primary := "LTE primary"
	if s.NrState == "connected" {
		primary = "NR primary"
	}
	descr := fmt.Sprintf("%s %s · %s · %s",
		qualityEmojiForBucket(bucket),
		capitalize(bucket),
		primary,
		signalQualityBars(bucket),
	)

	ports := []string{"main", "diversity", "mimo3", "mimo4"}
	labels := map[string]string{
		"main": "Main (PRX)", "diversity": "Diversity (DRX)",
		"mimo3": "MIMO 3 (RX2)", "mimo4": "MIMO 4 (RX3)",
	}
	var fields []*discordgo.MessageEmbedField
	pairCount := 0
	for _, port := range ports {
		ant, ok := s.SignalPerAntenna[port]
		if !ok {
			continue
		}
		portEmoji := perPortEmoji(ant.RSRP)
		// Trailing "\n​" adds a blank line below for vertical breathing.
		fields = append(fields, &discordgo.MessageEmbedField{
			Name: fmt.Sprintf("%s %s", portEmoji, labels[port]),
			Value: fmt.Sprintf("RSRP %s dBm  SINR %s dB\nRSRQ %s dB\n​",
				ifEmpty(ant.RSRP, "—"), ifEmpty(ant.SINR, "—"), ifEmpty(ant.RSRQ, "—"),
			),
			Inline: true,
		})
		pairCount++
		// After every 2 antennas, insert an invisible inline spacer so Discord
		// renders 2 content columns + 1 empty column per row (wider gutters).
		if pairCount%2 == 0 {
			fields = append(fields, spacerField())
		}
	}

	if note := provenanceNote(s); note != "" {
		fields = append(fields, &discordgo.MessageEmbedField{
			Name: "Source", Value: note, Inline: false,
		})
	}

	return &discordgo.MessageEmbed{
		Author:      authorBlock(s),
		Title:       "Signal Metrics",
		Description: descr,
		Color:       embedColor(s),
		Fields:      fields,
		Footer:      footerBlock(s),
		Timestamp:   time.Unix(s.CacheTime, 0).Format(time.RFC3339),
	}
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd discord-bot && go test -run TestBuildSignalEmbed -v`
Expected: PASS for both new tests AND any pre-existing `TestBuildSignalEmbed_*` tests (they should still pass — embed metadata like Title, Description, Color, Author are unchanged; only the Fields slice is reshaped). If a pre-existing test asserts a specific field-index for `Source`, update its expected index to account for the spacers.

- [ ] **Step 6: Run full discord-bot test suite**

Run: `cd discord-bot && go test ./...`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add discord-bot/handlers.go discord-bot/handlers_test.go
git commit -m "$(cat <<'EOF'
feat(discord-bot): widen /signal column gutters with 2-per-row + vertical padding

Render the 4 antenna fields as two pairs separated by invisible inline spacer
fields so Discord lays them out as a 2-column grid with visible right gutter.
Append a zero-width-space trailing line to each antenna value for vertical
breathing room between rows.
EOF
)"
```

---

## Task 5: /bands embed — vertical breathing in carrier fields

**Files:**
- Modify: `discord-bot/handlers.go:212-225` (`ccField`)
- Test: `discord-bot/handlers_test.go`

- [ ] **Step 1: Inspect existing ccField tests**

Run: `cd discord-bot && grep -n "TestBuildBandsEmbed\|TestCcField\|ccField" handlers_test.go`
Read any existing tests that assert on field values.

- [ ] **Step 2: Write failing test for ccField vertical padding**

Append to `discord-bot/handlers_test.go`:

```go
func TestCcField_ValueHasTrailingBlankLine(t *testing.T) {
	cc := CarrierComponent{
		Type: "PCC", Technology: "LTE", Band: "B3",
		PCI: "295", EARFCN: "1350", BandwidthMHz: "15",
		RSRP: "-93", SINR: "27.0",
	}
	f := ccField(cc)
	if f == nil {
		t.Fatal("ccField returned nil")
	}
	if !strings.HasSuffix(f.Value, "\n​") {
		t.Errorf("expected carrier value to end with newline+zero-width-space; got %q", f.Value)
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd discord-bot && go test -run TestCcField_ValueHasTrailingBlankLine -v`
Expected: FAIL — current `ccField` has no trailing zero-width line.

- [ ] **Step 4: Update ccField to append vertical breathing line**

Replace `discord-bot/handlers.go:212-225`:

```go
func ccField(cc CarrierComponent) *discordgo.MessageEmbedField {
	arfcnLabel := "EARFCN"
	if cc.Technology == "NR" {
		arfcnLabel = "ARFCN"
	}
	name := fmt.Sprintf("%s %s · %s %s", ccEmoji(cc.Type, cc.Technology), cc.Type, cc.Technology, cc.Band)
	// Trailing "\n​" adds a blank line below for vertical breathing between rows.
	value := fmt.Sprintf("PCI %s\n%s %s\n%s MHz\nRSRP %s / SINR %s\n​",
		ifEmpty(cc.PCI, "—"),
		arfcnLabel, ifEmpty(cc.EARFCN, "—"),
		ifEmpty(cc.BandwidthMHz, "—"),
		ifEmpty(cc.RSRP, "—"), ifEmpty(cc.SINR, "—"),
	)
	return &discordgo.MessageEmbedField{Name: name, Value: value, Inline: true}
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd discord-bot && go test -run "TestCcField|TestBuildBandsEmbed" -v`
Expected: PASS. Pre-existing bands-embed tests should still pass — only the value's trailing whitespace changed; substring assertions like `strings.Contains(value, "PCI 295")` are unaffected.

- [ ] **Step 6: Run full discord-bot test suite**

Run: `cd discord-bot && go test ./...`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add discord-bot/handlers.go discord-bot/handlers_test.go
git commit -m "$(cat <<'EOF'
feat(discord-bot): add vertical breathing room to /bands carrier fields

Append a zero-width-space trailing line to each carrier component value so
Discord renders extra row gap between the up-to-3 inline fields per row.
EOF
)"
```

---

## Task 6: Build, deploy, and smoke-test on device

**Files:** none modified — verification only.

- [ ] **Step 1: Cross-build the ARMv7 binary**

Run from repo root:

```bash
bash build-discord-bot.sh
```

Expected: produces `discord-bot/qmanager_discord` (ARMv7 static). No build errors.

- [ ] **Step 2: Deploy to the modem**

Use whatever deploy mechanism is current for this repo (typically `scp -O qmanager_discord root@<modem>:/usr/bin/qmanager_discord` then `systemctl restart qmanager-discord`). Confirm with the user before running — this is a deploy step, not local-only.

- [ ] **Step 3: Smoke-test in Discord DM with the bot**

Manual check — verify:

1. `/signal` — 4 antenna cards now render in 2 rows of 2 (Main/Diversity on top, MIMO3/MIMO4 below) with visible gap on the right and breathing room between rows.
2. `/bands` — carrier component cards have visible vertical gap below each.
3. `/lock-band lte_bands:B28,B3,B7` → bot replies "LTE: locked to B3/B7/B28" (sorted ascending). Confirm via `AT+QNWPREFCFG="lte_band"` query that modem received `3:7:28`.
4. `/lock-band lte_bands:B3:B28` (legacy colon input) still works — backward compat.
5. `/lock-band lte_bands:auto` → "LTE: unlocked (auto)".
6. Discord slash-command autocomplete shows the updated description ("comma-separated").

If any check fails, capture `journalctl -u qmanager-discord` output and the bot's `/tmp/discord-debug.log` if running in foreground mode (see `CLAUDE.md` re: journald gap on this device).

- [ ] **Step 4: No commit (verification only)**

---

## Task 7: Documentation updates

**Files:**
- Modify: `RELEASE_NOTES.md`
- Modify: `CLAUDE.md` (Discord Bot section)

- [ ] **Step 1: Add release-notes bullet**

In `RELEASE_NOTES.md`, locate the unreleased / current dev-rm520 section's "New Features" or "Improvements" subsection (per project convention, New Features comes before Improvements; bullets are 1-2 sentences in user-facing tone). Add:

```markdown
- **`/lock-band` accepts comma-separated bands and auto-sorts.** Use natural comma input (`B3,B7,B28` or `n41,n78`) — bands are automatically sorted lowest to highest before the lock command is sent. Colon-separated input still works for existing users.
- **Roomier `/signal` and `/bands` embeds.** Antenna and carrier cards now render with wider column gutters and vertical breathing between rows for easier scanning.
```

- [ ] **Step 2: Update CLAUDE.md Discord Bot section**

In `CLAUDE.md` under `### Discord Bot`, the existing notes don't pin the colon separator — but if any sentence references colon input, update it. Specifically, add a new bullet near the bottom of the section:

```markdown
- **`/lock-band` separator**: User input uses commas (`B3,B7,B28`) — colons accepted for legacy. `parseBandOption` in `handlers.go` normalizes both via `strings.ReplaceAll(input, ":", ",")` then numerically sorts, so the modem always sees a canonical ascending colon-joined string regardless of input order. The AT command itself (`AT+QNWPREFCFG="lte_band",3:7:28`) still uses colons — that is the modem's wire format, not the user contract.
```

- [ ] **Step 3: Commit**

```bash
git add RELEASE_NOTES.md CLAUDE.md
git commit -m "docs(discord-bot): note comma separator and embed spacing refinements"
```

---

## Self-Review Checklist (already performed)

- **Spec coverage:**
  - "comma instead of colon" → Task 1 (parser) + Task 2 (option description)
  - "auto-sort lowest to highest" → Task 1 (`sort.Ints`)
  - "more horizontal column spacing" → Task 4 (signal 2-per-row spacer fields)
  - "more vertical spacing" → Task 4 + Task 5 (trailing `\n​` in field values)

- **No placeholders:** every step has either exact code, exact command, or exact prose. No "TBD".

- **Type consistency:** `parseBandOption` signature unchanged (still `func(string) string`). `spacerField()` returns `*discordgo.MessageEmbedField`. `ccField` signature unchanged. Tests reference the same names.

- **Reversibility:** all changes are inside the bot's Go code; no AT command schema change; no Discord application command schema change beyond the option `Description` text (which Discord re-syncs on next `registerCommands` call at bot startup).
