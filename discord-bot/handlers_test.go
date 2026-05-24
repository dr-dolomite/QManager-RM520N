package main

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func makeStatus(internet, reachable, networkType string) *ModemStatus {
	return &ModemStatus{
		ConnInternetAvailable: internet,
		ModemReachable:        reachable,
		NetworkType:           networkType,
		CacheTime:             time.Now().Unix(),
		SignalPerAntenna: map[string]AntennaSignal{
			"main": {RSRP: "-85", RSRQ: "-10", SINR: "15", RSSI: "-65"},
		},
	}
}

func TestBuildSignalEmbed_Title(t *testing.T) {
	s := makeStatus("true", "true", "5G-NSA")
	if buildSignalEmbed(s).Title != "Signal Metrics" {
		t.Errorf("title wrong")
	}
}

func TestBuildSignalEmbed_PillRow_HasBars(t *testing.T) {
	s := makeStatus("true", "true", "5G-NSA")
	s.NrState = "connected"
	s.SignalPerAntenna = map[string]AntennaSignal{
		"main": {RSRP: "-75", SINR: "18", RSRQ: "-10"},
	}
	embed := buildSignalEmbed(s)
	if !strings.Contains(embed.Description, "▰") {
		t.Errorf("pill row missing bar glyphs: %q", embed.Description)
	}
	if !strings.Contains(embed.Description, "Excellent") {
		t.Errorf("pill row missing Excellent label: %q", embed.Description)
	}
	if !strings.Contains(embed.Description, "NR primary") {
		t.Errorf("pill row missing NR primary tag: %q", embed.Description)
	}
}

func TestBuildSignalEmbed_PillRow_LtePrimary(t *testing.T) {
	s := makeStatus("true", "true", "LTE")
	s.NrState = ""
	s.LteState = "connected"
	s.SignalPerAntenna = map[string]AntennaSignal{
		"main": {RSRP: "-100", SINR: "8"},
	}
	embed := buildSignalEmbed(s)
	if !strings.Contains(embed.Description, "LTE primary") {
		t.Errorf("pill row=%q want LTE primary", embed.Description)
	}
	if !strings.Contains(embed.Description, "Fair") {
		t.Errorf("pill row=%q want Fair quality", embed.Description)
	}
}

func TestBuildSignalEmbed_PerPortColorEmoji(t *testing.T) {
	s := makeStatus("true", "true", "5G-NSA")
	s.SignalPerAntenna = map[string]AntennaSignal{
		"main":      {RSRP: "-85", SINR: "18", RSRQ: "-10"},
		"diversity": {RSRP: "-100", SINR: "8", RSRQ: "-13"},
		"mimo3":     {RSRP: "-115", SINR: "-2", RSRQ: "-18"},
	}
	embed := buildSignalEmbed(s)
	greens, yellows, reds := 0, 0, 0
	for _, f := range embed.Fields {
		if strings.Contains(f.Name, "🟢") {
			greens++
		}
		if strings.Contains(f.Name, "🟡") {
			yellows++
		}
		if strings.Contains(f.Name, "🔴") {
			reds++
		}
	}
	if greens != 1 || yellows != 1 || reds != 1 {
		t.Errorf("per-port emoji counts: green=%d yellow=%d red=%d", greens, yellows, reds)
	}
}

func TestBuildSignalEmbed_ProvenanceFootnote(t *testing.T) {
	s := makeStatus("true", "true", "5G-NSA")
	s.NrState = "connected"
	s.LteState = "connected"
	s.SignalPerAntenna = map[string]AntennaSignal{
		"main": {RSRP: "-85", SINR: "18"},
	}
	embed := buildSignalEmbed(s)
	found := false
	for _, f := range embed.Fields {
		if strings.Contains(f.Value, "EN-DC") || strings.Contains(f.Value, "Showing NR") {
			found = true
		}
	}
	if !found {
		t.Error("missing provenance footnote field")
	}
}

func TestBuildStatusEmbed_Title(t *testing.T) {
	s := makeStatus("true", "true", "LTE")
	if buildStatusEmbed(s).Title != "Modem Status" {
		t.Errorf("wrong title")
	}
}

func TestBuildStatusEmbed_PillRow_Up(t *testing.T) {
	s := makeStatus("true", "true", "LTE")
	s.ConnLatency = "23"
	embed := buildStatusEmbed(s)
	if !strings.Contains(embed.Description, "Internet up") {
		t.Errorf("description=%q", embed.Description)
	}
	if !strings.Contains(embed.Description, "23 ms") {
		t.Errorf("description missing latency: %q", embed.Description)
	}
}

func TestBuildStatusEmbed_PillRow_Down(t *testing.T) {
	s := makeStatus("false", "true", "LTE")
	embed := buildStatusEmbed(s)
	if !strings.Contains(embed.Description, "Internet down") {
		t.Errorf("description=%q", embed.Description)
	}
	if embed.Color != colorAmber {
		t.Errorf("color=%#x want amber for internet down + modem reachable", embed.Color)
	}
}

func TestBuildStatusEmbed_ConnectionField_HasLatencyStats(t *testing.T) {
	s := makeStatus("true", "true", "LTE")
	s.ConnLatency = "23"
	s.ConnAvgLatency = "28"
	s.ConnJitter = "4"
	s.ConnPacketLoss = "0.0"
	s.PingTarget = "8.8.8.8"
	embed := buildStatusEmbed(s)
	found := false
	for _, f := range embed.Fields {
		if strings.Contains(f.Name, "Connection") {
			found = true
			if !strings.Contains(f.Value, "avg 28") || !strings.Contains(f.Value, "jitter 4") {
				t.Errorf("connection value missing avg/jitter: %q", f.Value)
			}
			if !strings.Contains(f.Value, "8.8.8.8") {
				t.Errorf("connection value missing ping target: %q", f.Value)
			}
		}
	}
	if !found {
		t.Error("missing Connection field")
	}
}

func TestBuildStatusEmbed_UptimeField_BothLines(t *testing.T) {
	s := makeStatus("true", "true", "LTE")
	s.Uptime = "2d 6h 30m"
	s.ConnUptime = "4h 12m"
	embed := buildStatusEmbed(s)
	for _, f := range embed.Fields {
		if strings.Contains(f.Name, "Uptime") {
			if !strings.Contains(f.Value, "Connection") || !strings.Contains(f.Value, "Device") {
				t.Errorf("uptime value missing both lines: %q", f.Value)
			}
		}
	}
}

func TestBuildStatusEmbed_WatchcatField(t *testing.T) {
	s := makeStatus("true", "true", "LTE")
	s.WatchcatState = "monitoring"
	s.WatchcatFailures = "3"
	embed := buildStatusEmbed(s)
	found := false
	for _, f := range embed.Fields {
		if strings.Contains(f.Name, "Watchcat") {
			found = true
			if !strings.Contains(f.Value, "monitoring") || !strings.Contains(f.Value, "3 failures") {
				t.Errorf("watchcat value=%q", f.Value)
			}
		}
	}
	if !found {
		t.Error("missing Watchcat field")
	}
}

func TestBuildEventsEmbed_Empty(t *testing.T) {
	embed := buildEventsEmbed([]Event{}, 0, 0, 0, 0)
	if embed.Description == "" {
		t.Error("expected description for empty events")
	}
	if embed.Color != colorGray {
		t.Errorf("empty events color=%#x want gray", embed.Color)
	}
}

func TestBuildEventsEmbed_PillRow(t *testing.T) {
	events := []Event{
		{Timestamp: 1000, Severity: "warning", Message: "warn1"},
		{Timestamp: 2000, Severity: "info", Message: "info1"},
	}
	embed := buildEventsEmbed(events, 1, 2, 7, 47)
	if !strings.Contains(embed.Description, "1 critical") {
		t.Errorf("description missing crit count: %q", embed.Description)
	}
	if !strings.Contains(embed.Description, "last 2 of 47") {
		t.Errorf("description missing total: %q", embed.Description)
	}
}

func TestBuildEventsEmbed_SeverityColorOverride(t *testing.T) {
	cases := []struct {
		events []Event
		want   int
	}{
		{[]Event{{Severity: "critical", Message: "x"}}, colorRed},
		{[]Event{{Severity: "warning", Message: "x"}}, colorAmber},
		{[]Event{{Severity: "info", Message: "x"}}, colorBlue},
	}
	for _, c := range cases {
		got := buildEventsEmbed(c.events, 0, 0, 0, len(c.events)).Color
		if got != c.want {
			t.Errorf("events color=%#x want %#x for severity %q", got, c.want, c.events[0].Severity)
		}
	}
}

func TestBuildBandsEmbed_Title(t *testing.T) {
	s := makeStatus("true", "true", "5G-NSA")
	embed := buildBandsEmbed(s)
	if embed.Title != "Band Details" {
		t.Errorf("title=%q, want Band Details", embed.Title)
	}
}

func TestBuildBandsEmbed_PillRow_EnDc(t *testing.T) {
	s := makeStatus("true", "true", "5G-NSA")
	s.NrState = "connected"
	s.LteState = "connected"
	s.TotalBandwidthMHz = "100"
	s.CarrierComponents = []CarrierComponent{
		{Type: "PCC", Technology: "LTE", Band: "B3"},
		{Type: "SCC", Technology: "LTE", Band: "B7"},
		{Type: "SCC", Technology: "NR", Band: "n78"},
	}
	embed := buildBandsEmbed(s)
	want := "🟢 EN-DC active • 📊 100 MHz total • 🛰️ 3 carriers"
	if embed.Description != want {
		t.Errorf("description=%q, want %q", embed.Description, want)
	}
}

func TestBuildBandsEmbed_PillRow_LteOnly(t *testing.T) {
	s := makeStatus("true", "true", "LTE-A")
	s.LteState = "connected"
	s.TotalBandwidthMHz = "40"
	s.CarrierComponents = []CarrierComponent{
		{Type: "PCC", Technology: "LTE", Band: "B3"},
		{Type: "SCC", Technology: "LTE", Band: "B7"},
	}
	embed := buildBandsEmbed(s)
	if !strings.Contains(embed.Description, "LTE-A active") {
		t.Errorf("description=%q, want LTE-A active", embed.Description)
	}
}

func TestBuildBandsEmbed_PillRow_NoCa(t *testing.T) {
	s := makeStatus("true", "true", "LTE")
	s.LteState = "connected"
	s.LteBand = "B3"
	embed := buildBandsEmbed(s)
	if !strings.Contains(embed.Description, "No CA data") {
		t.Errorf("description=%q, want No CA data note", embed.Description)
	}
}

func TestBuildBandsEmbed_PillRow_ModemUnreachable(t *testing.T) {
	s := makeStatus("false", "false", "")
	embed := buildBandsEmbed(s)
	if !strings.Contains(embed.Description, "unreachable") {
		t.Errorf("description=%q, want unreachable", embed.Description)
	}
	if embed.Color != colorRed {
		t.Errorf("color=%#x, want red", embed.Color)
	}
}

func TestBuildBandsEmbed_CcCards_Order(t *testing.T) {
	s := makeStatus("true", "true", "5G-NSA")
	s.CarrierComponents = []CarrierComponent{
		{Type: "PCC", Technology: "LTE", Band: "B3", PCI: "123", EARFCN: "1850", BandwidthMHz: "20", RSRP: "-85", SINR: "18"},
		{Type: "SCC", Technology: "NR", Band: "n78", PCI: "789", EARFCN: "642000", BandwidthMHz: "60", RSRP: "-92", SINR: "11"},
	}
	embed := buildBandsEmbed(s)
	if len(embed.Fields) < 2 {
		t.Fatalf("want >=2 fields, got %d", len(embed.Fields))
	}
	if !strings.Contains(embed.Fields[0].Name, "PCC") || !strings.Contains(embed.Fields[0].Name, "B3") {
		t.Errorf("field[0].Name=%q", embed.Fields[0].Name)
	}
	if !strings.Contains(embed.Fields[1].Name, "SCC") || !strings.Contains(embed.Fields[1].Name, "n78") {
		t.Errorf("field[1].Name=%q", embed.Fields[1].Name)
	}
	if !strings.Contains(embed.Fields[1].Value, "ARFCN 642000") {
		t.Errorf("field[1].Value missing ARFCN label: %q", embed.Fields[1].Value)
	}
	if !strings.Contains(embed.Fields[0].Value, "EARFCN 1850") {
		t.Errorf("field[0].Value missing EARFCN label: %q", embed.Fields[0].Value)
	}
}

func TestBuildBandsEmbed_CcCards_OverflowCap(t *testing.T) {
	s := makeStatus("true", "true", "5G-NSA")
	for i := 0; i < 8; i++ {
		s.CarrierComponents = append(s.CarrierComponents, CarrierComponent{
			Type: "SCC", Technology: "LTE", Band: fmt.Sprintf("B%d", i),
		})
	}
	embed := buildBandsEmbed(s)
	ccFields := 0
	overflow := false
	for _, f := range embed.Fields {
		if strings.Contains(f.Name, "SCC") {
			ccFields++
		}
		if strings.Contains(f.Name, "More carriers") {
			overflow = true
		}
	}
	if ccFields != 6 {
		t.Errorf("CC fields=%d, want 6", ccFields)
	}
	if !overflow {
		t.Error("missing overflow field for 8 CCs")
	}
}

func TestBuildBandsEmbed_ServingCellField(t *testing.T) {
	s := makeStatus("true", "true", "5G-NSA")
	s.LteCellID = "0x1A2B3C"
	s.NrCellID = "0x4D5E6F"
	s.LteTAC = "12345"
	s.NrTAC = "90123"
	embed := buildBandsEmbed(s)
	found := false
	for _, f := range embed.Fields {
		if strings.Contains(f.Name, "Serving cell") {
			found = true
			if !strings.Contains(f.Value, "0x1A2B3C") || !strings.Contains(f.Value, "0x4D5E6F") {
				t.Errorf("serving cell value=%q", f.Value)
			}
		}
	}
	if !found {
		t.Error("missing Serving cell field")
	}
}

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

func TestParseBandOption_DropsDuplicateBands(t *testing.T) {
	// Duplicate band numbers should be collapsed so the modem and the user-facing
	// display ("B3/B3/B28") never show repeats.
	got := parseBandOption("B3,B3,B28")
	if got != "3:28" {
		t.Errorf("got %q, want %q", got, "3:28")
	}
}

func TestParseBandOption_DropsDuplicatesAcrossSeparatorsAndOrder(t *testing.T) {
	// Duplicates introduced by mixing comma+colon and unordered input must also
	// collapse after sort.
	got := parseBandOption("B28,B3:B28,B7,B3")
	if got != "3:7:28" {
		t.Errorf("got %q, want %q", got, "3:7:28")
	}
}

func TestParseBandOption_AllInvalidReturnsEmpty(t *testing.T) {
	// Documenting test: if every token is non-numeric, the function returns "" —
	// the caller (handleLockBand) treats this the same as "auto" and unlocks
	// all bands. This is intentional but worth pinning down with a test so it
	// can't regress silently.
	got := parseBandOption("Bxx,Nyy")
	if got != "" {
		t.Errorf("got %q, want empty string", got)
	}
}

func TestEmbedForSource_Routes(t *testing.T) {
	s := makeStatus("true", "true", "5G-NSA")
	cases := []struct {
		source string
		want   string
	}{
		{"signal", "Signal Metrics"},
		{"bands", "Band Details"},
		{"status", "Modem Status"},
	}
	for _, c := range cases {
		embed := embedForSource(c.source, s)
		if embed == nil || embed.Title != c.want {
			t.Errorf("embedForSource(%q): got %v, want title %q", c.source, embed, c.want)
		}
	}
}

func TestEmbedForSource_Unknown(t *testing.T) {
	embed := embedForSource("totally-unknown", makeStatus("true", "true", "LTE"))
	if embed != nil {
		t.Errorf("expected nil for unknown source, got %+v", embed)
	}
}

func TestRawSliceFor(t *testing.T) {
	rawJSON := []byte(`{"network":{"type":"5G"},"lte":{"band":"B3"},"nr":{"band":"n78"},"connectivity":{"latency_ms":15},"device":{"model":"RM520"},"watchcat":{"state":"idle"},"signal_per_antenna":{"nr_rsrp":[1]}}`)
	cases := []struct {
		source      string
		mustHave    []string
		mustNotHave []string
	}{
		{"bands", []string{`"network"`, `"lte"`, `"nr"`}, []string{`"watchcat"`, `"device"`}},
		{"signal", []string{`"signal_per_antenna"`, `"lte"`, `"nr"`}, []string{`"network"`, `"watchcat"`}},
		{"status", []string{`"connectivity"`, `"device"`, `"network"`, `"watchcat"`}, []string{`"signal_per_antenna"`}},
		{"device", []string{`"device"`}, []string{`"network"`, `"watchcat"`}},
		{"watchcat", []string{`"watchcat"`}, []string{`"device"`}},
	}
	for _, c := range cases {
		got, err := rawSliceFor(c.source, rawJSON)
		if err != nil {
			t.Fatalf("rawSliceFor(%q): %v", c.source, err)
		}
		gotStr := string(got)
		for _, want := range c.mustHave {
			if !strings.Contains(gotStr, want) {
				t.Errorf("rawSliceFor(%q) missing %s: %s", c.source, want, gotStr)
			}
		}
		for _, no := range c.mustNotHave {
			if strings.Contains(gotStr, no) {
				t.Errorf("rawSliceFor(%q) should not contain %s: %s", c.source, no, gotStr)
			}
		}
	}
}

// We can't easily unit-test the dispatcher (requires a live discordgo.Session),
// but we can at least verify capitalize is used correctly for failure titles.
// This is a sanity check for the title-aware failure-embed change.
func TestCapitalize_UsedInFailureTitle(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"signal", "Signal"},
		{"bands", "Bands"},
		{"status", "Status"},
		{"", ""},
	}
	for _, c := range cases {
		got := capitalize(c.in)
		if got != c.want {
			t.Errorf("capitalize(%q)=%q, want %q", c.in, got, c.want)
		}
	}
}

func TestBuildDeviceEmbed(t *testing.T) {
	s := makeStatus("true", "true", "5G-NSA")
	s.Model = "RM520N-GL"
	s.Manufacturer = "Quectel"
	s.Firmware = "RM520NGLAAR03A05M4G"
	s.IMEI = "861234567890123"
	s.LteCategory = "20"
	s.MIMO = "4x4"
	s.SupportedLteBands = "1,3,7"
	embed := buildDeviceEmbed(s)
	if embed.Title != "Device Info" {
		t.Errorf("title=%q", embed.Title)
	}
	if !strings.Contains(embed.Description, "RM520N-GL") {
		t.Errorf("description=%q", embed.Description)
	}
	if !strings.Contains(embed.Description, "Cat 20") {
		t.Errorf("description missing LTE Cat: %q", embed.Description)
	}
	have := func(name string) bool {
		for _, f := range embed.Fields {
			if strings.Contains(f.Name, name) {
				return true
			}
		}
		return false
	}
	for _, name := range []string{"Model", "Manufacturer", "IMEI", "Firmware", "MIMO", "Supported LTE"} {
		if !have(name) {
			t.Errorf("missing field containing %q", name)
		}
	}
}

func TestBuildSimEmbed(t *testing.T) {
	s := makeStatus("true", "true", "LTE")
	s.SimSlot = "1"
	s.Operator = "VZW"
	s.APN = "internet"
	s.ICCID = "8914800000123456789"
	s.IMSI = "311480123456789"
	s.PhoneNumber = "+15551234567"
	embed := buildSimEmbed(s)
	if embed.Title != "SIM Details" {
		t.Errorf("title=%q", embed.Title)
	}
	if !strings.Contains(embed.Description, "VZW") || !strings.Contains(embed.Description, "internet") {
		t.Errorf("description=%q", embed.Description)
	}
	have := func(name string) bool {
		for _, f := range embed.Fields {
			if strings.Contains(f.Name, name) {
				return true
			}
		}
		return false
	}
	for _, name := range []string{"Slot", "Carrier", "APN", "ICCID", "IMSI", "Phone"} {
		if !have(name) {
			t.Errorf("missing field containing %q", name)
		}
	}
}

func TestBuildWatchcatEmbed(t *testing.T) {
	s := makeStatus("true", "true", "LTE")
	s.WatchcatEnabled = "true"
	s.WatchcatState = "monitoring"
	s.WatchcatTier = "2"
	s.WatchcatFailures = "3"
	s.WatchcatTotal = "5"
	s.WatchcatLastTime = fmt.Sprintf("%d", time.Now().Unix()-3600)
	s.WatchcatLastTier = "3"
	embed := buildWatchcatEmbed(s)
	if embed.Title != "Watchcat Status" {
		t.Errorf("title=%q", embed.Title)
	}
	if !strings.Contains(embed.Description, "monitoring") {
		t.Errorf("description=%q", embed.Description)
	}
	if !strings.Contains(embed.Description, "Tier 2") {
		t.Errorf("description=%q want Tier 2", embed.Description)
	}
	have := func(name string) bool {
		for _, f := range embed.Fields {
			if strings.Contains(f.Name, name) {
				return true
			}
		}
		return false
	}
	for _, name := range []string{"Enabled", "State", "tier", "Failure", "Total", "Last recovery"} {
		if !have(name) {
			t.Errorf("missing field containing %q", name)
		}
	}
}

func TestBuildWatchcatEmbed_NeverRecovered(t *testing.T) {
	s := makeStatus("true", "true", "LTE")
	s.WatchcatState = "idle"
	s.WatchcatLastTime = ""
	embed := buildWatchcatEmbed(s)
	for _, f := range embed.Fields {
		if strings.Contains(f.Name, "Last recovery") {
			if !strings.Contains(strings.ToLower(f.Value), "never") {
				t.Errorf("expected Never for empty last recovery, got %q", f.Value)
			}
		}
	}
}

func TestEmbedForSource_EventsReturnsNil(t *testing.T) {
	// Events refresh deliberately bypasses embedForSource because
	// buildEventsEmbed needs different inputs. Verify it returns nil
	// so handleRefreshOrNav's events branch is the only path that
	// builds the events embed.
	embed := embedForSource("events", makeStatus("true", "true", "LTE"))
	if embed != nil {
		t.Errorf("embedForSource(\"events\") should return nil; events refresh handled separately. Got: %+v", embed)
	}
}

func TestBuildSignalEmbed_TwoAntennasPerRowWithSpacer(t *testing.T) {
	s := makeStatus("true", "true", "5G-NSA")
	s.SignalPerAntenna = map[string]AntennaSignal{
		"main":      {RSRP: "-90", SINR: "10", RSRQ: "-10"},
		"diversity": {RSRP: "-92", SINR: "9", RSRQ: "-11"},
		"mimo3":     {RSRP: "-95", SINR: "8", RSRQ: "-12"},
		"mimo4":     {RSRP: "-97", SINR: "7", RSRQ: "-13"},
	}
	embed := buildSignalEmbed(s)

	spacerCount := 0
	for _, f := range embed.Fields {
		if f.Name == "​" && f.Value == "​" {
			spacerCount++
		}
	}
	if spacerCount != 2 {
		t.Errorf("expected 2 spacer fields between antenna pairs, got %d", spacerCount)
	}

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

	if len(embed.Fields) == 0 {
		t.Fatal("no fields in signal embed")
	}
	val := embed.Fields[0].Value
	if !strings.HasSuffix(val, "\n​") {
		t.Errorf("expected antenna value to end with newline+zero-width-space for vertical breathing; got %q", val)
	}
}

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
