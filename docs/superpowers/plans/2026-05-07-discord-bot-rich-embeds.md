# Discord Bot Rich Embeds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the four query embeds (`/signal`, `/bands`, `/status`, `/events`) with shared visual chrome (author + pill-row description + emoji-prefixed fields + footer with timestamp + action button row), surface every poller field that's currently invisible from Discord (per-CC `carrier_components`, latency stats, traffic, watchcat, etc.), and add three new commands (`/device`, `/sim`, `/watchcat`).

**Architecture:** All work is in `discord-bot/` (a Go binary `qmanager_discord` built with `github.com/bwmarrin/discordgo`). Cache layer (`cache.go`) gets new poller fields and a `CarrierComponent` type. A new `embeds.go` file holds shared chrome helpers (emoji vocab, color logic, button row builder, auto-disable scheduler). Existing embed builders in `handlers.go` are rewritten; new commands are added alongside. Component handler grows a generic `qm:<action>:<source>` dispatcher to route Refresh / cross-jump / Copy raw clicks.

**Tech Stack:** Go 1.22+, `github.com/bwmarrin/discordgo`. Tests use stdlib `testing` package — no extra deps.

**Spec:** `docs/superpowers/specs/2026-05-07-discord-bot-rich-embeds-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `discord-bot/cache.go` | Modify | Add new poller struct fields (`network.{total_bandwidth_mhz, bandwidth_details, carrier_components, apn}`, `lte/nr.{earfcn/arfcn, pci, cell_id, tac, bandwidth}`, `device.{conn_uptime_seconds, cpu_usage, memory_*, firmware, build_date, mfr, model, imei, imsi, iccid, phone_number, lte_category, mimo, supported_*_bands}`, `connectivity.{jitter_ms, packet_loss_pct, ping_target, during_recovery}`, full `watchcat`, full `traffic`). Define `CarrierComponent`. Extend `mapPollerToStatus`. |
| `discord-bot/cache.go` (same file) | Modify | Add `readEventCounts(path string) (crit, warn, info, total int, err error)` helper for /events pill row. |
| `discord-bot/embeds.go` | Create | Emoji vocabulary, `embedColor`, `relativeTime`, `formatBytes`, `signalQualityBars`, `signalQualityBucket`, `ccEmoji`, `authorBlock`, `footerBlock`, `buildActionRow`, `disabledActionRow`, `scheduleButtonExpiry`. |
| `discord-bot/handlers.go` | Modify | Rewrite `buildSignalEmbed`, `buildBandsEmbed`, `buildStatusEmbed`, `buildEventsEmbed`. Add `buildDeviceEmbed`, `buildSimEmbed`, `buildWatchcatEmbed`. Add `handleDevice`, `handleSim`, `handleWatchcat`. Extend `handleCommand` to route new names. Extend `handleComponent` with `qm:<action>:<source>` dispatcher. Update `respondEmbed` to optionally attach components. Drop unused `embedColorForInternet` (replaced by `embedColor`). |
| `discord-bot/commands.go` | Modify | Register `/device`, `/sim`, `/watchcat` slash commands. |
| `discord-bot/cache_test.go` | Modify | Add tests for new fields in `mapPollerToStatus`, `CarrierComponent` deserialization, `readEventCounts`. |
| `discord-bot/handlers_test.go` | Modify | Replace existing field-level assertions with structural ones (description pill row, button row composition, color logic, auto-disable behavior). Add tests for new embed builders. Update existing tests that assert on the old field shape (e.g. `Internet`, `Technology`). |
| `discord-bot/embeds_test.go` | Create | Unit tests for the shared chrome helpers (color logic, button row composition per source, emoji vocabulary present, `formatBytes`, `relativeTime`, `signalQualityBars`). |

---

## Task 1: Extend `pollerCache` to deserialize new fields

**Files:**
- Modify: `discord-bot/cache.go` (struct definitions only — no logic changes yet)
- Test: `discord-bot/cache_test.go`

- [ ] **Step 1: Write the failing test**

Add to `discord-bot/cache_test.go`:

```go
func TestReadStatus_NewPollerFields(t *testing.T) {
	path := writeTempJSON(t, map[string]any{
		"timestamp":       time.Now().Unix(),
		"modem_reachable": true,
		"network": map[string]any{
			"type":                 "5G-NSA",
			"carrier":              "VZW",
			"sim_slot":             1,
			"ca_active":            true,
			"ca_count":             2,
			"nr_ca_active":         true,
			"nr_ca_count":          1,
			"total_bandwidth_mhz":  100,
			"bandwidth_details":    "B3: 20 MHz + B7: 20 MHz + n78: 60 MHz",
			"apn":                  "internet",
			"wan_ipv4":             "10.0.0.1",
			"carrier_components": []any{
				map[string]any{
					"type":          "PCC",
					"technology":    "LTE",
					"band":          "B3",
					"earfcn":        1850,
					"bandwidth_mhz": 20,
					"pci":           123,
					"rsrp":          -85,
					"rsrq":          -10,
					"rssi":          -65,
					"sinr":          18.0,
				},
				map[string]any{
					"type":          "SCC",
					"technology":    "NR",
					"band":          "n78",
					"earfcn":        642000,
					"bandwidth_mhz": 60,
					"pci":           789,
					"rsrp":          -92,
					"sinr":          11.0,
				},
			},
		},
		"lte": map[string]any{
			"state": "connected", "band": "B3",
			"earfcn": 1850, "pci": 123,
			"cell_id": "0x1A2B3C", "tac": "12345",
			"bandwidth": 20,
		},
		"nr": map[string]any{
			"state": "connected", "band": "n78",
			"arfcn": 642000, "pci": 789,
			"cell_id": "0x4D5E6F", "tac": "90123",
		},
		"connectivity": map[string]any{
			"internet_available": true,
			"latency_ms":         15.4,
			"avg_latency_ms":     20.1,
			"jitter_ms":          3.2,
			"packet_loss_pct":    0.5,
			"ping_target":        "8.8.8.8",
			"during_recovery":    false,
		},
		"device": map[string]any{
			"temperature":      47.3,
			"cpu_usage":        41,
			"memory_used_mb":   312,
			"memory_total_mb":  512,
			"uptime_seconds":   200000,
			"conn_uptime_seconds": 15000,
			"firmware":         "RM520NGLAAR03A05M4G",
			"build_date":       "20240115",
			"manufacturer":     "Quectel",
			"model":            "RM520N-GL",
			"imei":             "861234567890123",
			"imsi":             "311480123456789",
			"iccid":            "8914800000123456789",
			"phone_number":     "+15551234567",
			"lte_category":     "20",
			"mimo":             "4x4",
			"supported_lte_bands":      "1,2,3,4,5,7,8,12,13,14,17,18,19,20,25,26,28,29,30,32,34,38,39,40,41,42,43,46,48,66,71",
			"supported_nsa_nr5g_bands": "1,2,3,5,7,8,12,20,25,28,38,40,41,48,66,71,77,78",
			"supported_sa_nr5g_bands":  "1,2,3,5,7,8,12,20,25,28,38,40,41,48,66,71,77,78,79",
		},
		"traffic": map[string]any{
			"rx_bytes_per_sec": 1500000,
			"tx_bytes_per_sec": 250000,
		},
		"watchcat": map[string]any{
			"enabled":             true,
			"state":               "monitoring",
			"current_tier":        2,
			"failure_count":       3,
			"last_recovery_time":  1714000000,
			"last_recovery_tier":  3,
			"total_recoveries":    5,
		},
	})
	defer os.Remove(path)

	s, err := readStatus(path)
	if err != nil {
		t.Fatalf("readStatus error: %v", err)
	}
	// Network additions
	if s.TotalBandwidthMHz != "100" {
		t.Errorf("TotalBandwidthMHz=%q, want 100", s.TotalBandwidthMHz)
	}
	if s.APN != "internet" {
		t.Errorf("APN=%q, want internet", s.APN)
	}
	if len(s.CarrierComponents) != 2 {
		t.Fatalf("CarrierComponents len=%d, want 2", len(s.CarrierComponents))
	}
	if s.CarrierComponents[0].Type != "PCC" || s.CarrierComponents[0].Band != "B3" {
		t.Errorf("CC[0]=%+v", s.CarrierComponents[0])
	}
	if s.CarrierComponents[0].EARFCN != "1850" {
		t.Errorf("CC[0].EARFCN=%q, want 1850", s.CarrierComponents[0].EARFCN)
	}
	if s.CarrierComponents[1].Technology != "NR" || s.CarrierComponents[1].PCI != "789" {
		t.Errorf("CC[1]=%+v", s.CarrierComponents[1])
	}
	// LTE additions
	if s.LteCellID != "0x1A2B3C" || s.LteTAC != "12345" {
		t.Errorf("LTE cell/TAC: %q / %q", s.LteCellID, s.LteTAC)
	}
	// NR additions
	if s.NrCellID != "0x4D5E6F" {
		t.Errorf("NrCellID=%q, want 0x4D5E6F", s.NrCellID)
	}
	// Connectivity additions
	if s.ConnJitter != "3" {
		t.Errorf("ConnJitter=%q, want 3", s.ConnJitter)
	}
	if s.PingTarget != "8.8.8.8" {
		t.Errorf("PingTarget=%q, want 8.8.8.8", s.PingTarget)
	}
	// Device additions
	if s.Model != "RM520N-GL" || s.Firmware != "RM520NGLAAR03A05M4G" {
		t.Errorf("Model/Firmware: %q / %q", s.Model, s.Firmware)
	}
	if s.IMEI != "861234567890123" {
		t.Errorf("IMEI=%q", s.IMEI)
	}
	if s.MIMO != "4x4" {
		t.Errorf("MIMO=%q, want 4x4", s.MIMO)
	}
	// Traffic
	if s.RxRate == "" || s.TxRate == "" {
		t.Errorf("Rx/Tx rate empty: %q / %q", s.RxRate, s.TxRate)
	}
	// Watchcat
	if s.WatchcatState != "monitoring" || s.WatchcatTier != "2" {
		t.Errorf("Watchcat state/tier: %q / %q", s.WatchcatState, s.WatchcatTier)
	}
	if s.WatchcatTotal != "5" {
		t.Errorf("WatchcatTotal=%q, want 5", s.WatchcatTotal)
	}
	// Conn uptime
	if s.ConnUptime == "" {
		t.Errorf("ConnUptime empty")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd discord-bot && go test -run TestReadStatus_NewPollerFields ./...`
Expected: FAIL — `ModemStatus` has no field `TotalBandwidthMHz`, `CarrierComponents`, etc. (compile error).

- [ ] **Step 3: Extend the structs**

Replace the `ModemStatus` struct in `discord-bot/cache.go` with this expanded version (the entire `type ModemStatus struct { ... }` block):

```go
type ModemStatus struct {
	ConnInternetAvailable string
	ConnLatency           string
	ConnAvgLatency        string
	ConnJitter            string
	ConnPacketLoss        string
	PingTarget            string
	DuringRecovery        string
	ModemReachable        string
	NetworkType           string
	Operator              string
	SignalPerAntenna      map[string]AntennaSignal
	LteBand               string
	NrBand                string
	NrState               string
	LteState              string
	CaActive              string
	CaCount               string
	NrCaActive            string
	NrCaCount             string
	TotalBandwidthMHz     string
	BandwidthDetails      string
	CarrierComponents     []CarrierComponent
	APN                   string
	WanIP                 string
	SimSlot               string

	// Per-radio cell info
	LteCellID string
	NrCellID  string
	LteTAC    string
	NrTAC     string

	// Device
	Uptime           string
	ConnUptime       string
	CpuTemp          string
	CpuUsage         string
	MemUsedMB        string
	MemTotalMB       string
	Model            string
	Manufacturer     string
	Firmware         string
	BuildDate        string
	IMEI             string
	IMSI             string
	ICCID            string
	PhoneNumber      string
	LteCategory      string
	MIMO             string
	SupportedLteBands  string
	SupportedNsaBands  string
	SupportedSaBands   string

	// Traffic
	RxRate string
	TxRate string

	// Watchcat
	WatchcatEnabled  string
	WatchcatState    string
	WatchcatTier     string
	WatchcatFailures string
	WatchcatTotal    string
	WatchcatLastTime string
	WatchcatLastTier string

	ServiceStatus string
	CacheTime     int64
}

type CarrierComponent struct {
	Type         string
	Technology   string
	Band         string
	EARFCN       string
	BandwidthMHz string
	PCI          string
	RSRP         string
	RSRQ         string
	RSSI         string
	SINR         string
}
```

Then expand the `pollerNetwork`, `pollerRadio`, `pollerDevice`, `pollerConn` structs and add `pollerWatchcat`, `pollerTraffic`, `pollerCarrierComponent`. Replace the existing struct block (currently `type pollerNetwork struct { ... }` through `type pollerConn struct { ... }`) with:

```go
type pollerNetwork struct {
	Type              string                    `json:"type"`
	Carrier           string                    `json:"carrier"`
	SimSlot           *int                      `json:"sim_slot"`
	ServiceStatus     string                    `json:"service_status"`
	CaActive          bool                      `json:"ca_active"`
	CaCount           *int                      `json:"ca_count"`
	NrCaActive        bool                      `json:"nr_ca_active"`
	NrCaCount         *int                      `json:"nr_ca_count"`
	TotalBandwidthMHz *int                      `json:"total_bandwidth_mhz"`
	BandwidthDetails  string                    `json:"bandwidth_details"`
	CarrierComponents []pollerCarrierComponent  `json:"carrier_components"`
	APN               string                    `json:"apn"`
	WanIPv4           string                    `json:"wan_ipv4"`
}

type pollerRadio struct {
	State     string `json:"state"`
	Band      string `json:"band"`
	EARFCN    *int   `json:"earfcn"`
	ARFCN     *int   `json:"arfcn"`
	PCI       *int   `json:"pci"`
	CellID    string `json:"cell_id"`
	TAC       string `json:"tac"`
	Bandwidth *int   `json:"bandwidth"`
}

type pollerCarrierComponent struct {
	Type         string   `json:"type"`
	Technology   string   `json:"technology"`
	Band         string   `json:"band"`
	EARFCN       *int     `json:"earfcn"`
	BandwidthMHz *int     `json:"bandwidth_mhz"`
	PCI          *int     `json:"pci"`
	RSRP         *float64 `json:"rsrp"`
	RSRQ         *float64 `json:"rsrq"`
	RSSI         *float64 `json:"rssi"`
	SINR         *float64 `json:"sinr"`
}

type pollerDevice struct {
	Temperature      *float64 `json:"temperature"`
	CpuUsage         *int     `json:"cpu_usage"`
	MemoryUsedMB     *int     `json:"memory_used_mb"`
	MemoryTotalMB    *int     `json:"memory_total_mb"`
	UptimeSeconds    *int64   `json:"uptime_seconds"`
	ConnUptimeSecs   *int64   `json:"conn_uptime_seconds"`
	Firmware         string   `json:"firmware"`
	BuildDate        string   `json:"build_date"`
	Manufacturer     string   `json:"manufacturer"`
	Model            string   `json:"model"`
	IMEI             string   `json:"imei"`
	IMSI             string   `json:"imsi"`
	ICCID            string   `json:"iccid"`
	PhoneNumber      string   `json:"phone_number"`
	LteCategory      string   `json:"lte_category"`
	MIMO             string   `json:"mimo"`
	SupportedLte     string   `json:"supported_lte_bands"`
	SupportedNsaNr5g string   `json:"supported_nsa_nr5g_bands"`
	SupportedSaNr5g  string   `json:"supported_sa_nr5g_bands"`
}

type pollerConn struct {
	InternetAvailable *bool    `json:"internet_available"`
	Status            string   `json:"status"`
	LatencyMs         *float64 `json:"latency_ms"`
	AvgLatencyMs      *float64 `json:"avg_latency_ms"`
	JitterMs          *float64 `json:"jitter_ms"`
	PacketLossPct     *float64 `json:"packet_loss_pct"`
	PingTarget        string   `json:"ping_target"`
	DuringRecovery    *bool    `json:"during_recovery"`
}

type pollerTraffic struct {
	RxBytesPerSec *int64 `json:"rx_bytes_per_sec"`
	TxBytesPerSec *int64 `json:"tx_bytes_per_sec"`
}

type pollerWatchcat struct {
	Enabled          bool   `json:"enabled"`
	State            string `json:"state"`
	CurrentTier      *int   `json:"current_tier"`
	FailureCount     *int   `json:"failure_count"`
	LastRecoveryTime *int64 `json:"last_recovery_time"`
	LastRecoveryTier *int   `json:"last_recovery_tier"`
	TotalRecoveries  *int   `json:"total_recoveries"`
}
```

Then in the `pollerCache` struct, add three new fields after the existing `Connectivity` field:

```go
type pollerCache struct {
	Timestamp           int64           `json:"timestamp"`
	ModemReachable      bool            `json:"modem_reachable"`
	LastSuccessfulPoll  int64           `json:"last_successful_poll"`
	Network             pollerNetwork   `json:"network"`
	LTE                 pollerRadio     `json:"lte"`
	NR                  pollerRadio     `json:"nr"`
	SignalPerAntenna    pollerAntennas  `json:"signal_per_antenna"`
	Device              pollerDevice    `json:"device"`
	Connectivity        pollerConn      `json:"connectivity"`
	Traffic             pollerTraffic   `json:"traffic"`
	Watchcat            pollerWatchcat  `json:"watchcat"`
}
```

- [ ] **Step 4: Extend `mapPollerToStatus`**

Replace the body of `mapPollerToStatus` in `discord-bot/cache.go`. The new version maps every new field. Replace the entire function:

```go
func mapPollerToStatus(p *pollerCache) *ModemStatus {
	s := &ModemStatus{
		CacheTime:             p.Timestamp,
		ModemReachable:        boolStr(p.ModemReachable),
		NetworkType:           p.Network.Type,
		Operator:              p.Network.Carrier,
		SimSlot:               intPtrStr(p.Network.SimSlot),
		ServiceStatus:         p.Network.ServiceStatus,
		CaActive:              boolStr(p.Network.CaActive),
		CaCount:               intPtrStr(p.Network.CaCount),
		NrCaActive:            boolStr(p.Network.NrCaActive),
		NrCaCount:             intPtrStr(p.Network.NrCaCount),
		TotalBandwidthMHz:     intPtrStr(p.Network.TotalBandwidthMHz),
		BandwidthDetails:      p.Network.BandwidthDetails,
		CarrierComponents:     mapCarrierComponents(p.Network.CarrierComponents),
		APN:                   p.Network.APN,
		WanIP:                 p.Network.WanIPv4,
		LteBand:               p.LTE.Band,
		LteState:              p.LTE.State,
		LteCellID:             p.LTE.CellID,
		LteTAC:                p.LTE.TAC,
		NrBand:                p.NR.Band,
		NrState:               p.NR.State,
		NrCellID:              p.NR.CellID,
		NrTAC:                 p.NR.TAC,
		CpuTemp:               floatPtrFmt(p.Device.Temperature, "%.1f °C"),
		CpuUsage:              intPtrStr(p.Device.CpuUsage),
		MemUsedMB:             intPtrStr(p.Device.MemoryUsedMB),
		MemTotalMB:            intPtrStr(p.Device.MemoryTotalMB),
		Uptime:                uptimeStr(p.Device.UptimeSeconds),
		ConnUptime:            uptimeStr(p.Device.ConnUptimeSecs),
		Model:                 p.Device.Model,
		Manufacturer:          p.Device.Manufacturer,
		Firmware:              p.Device.Firmware,
		BuildDate:             p.Device.BuildDate,
		IMEI:                  p.Device.IMEI,
		IMSI:                  p.Device.IMSI,
		ICCID:                 p.Device.ICCID,
		PhoneNumber:           p.Device.PhoneNumber,
		LteCategory:           p.Device.LteCategory,
		MIMO:                  p.Device.MIMO,
		SupportedLteBands:     p.Device.SupportedLte,
		SupportedNsaBands:     p.Device.SupportedNsaNr5g,
		SupportedSaBands:      p.Device.SupportedSaNr5g,
		ConnInternetAvailable: boolPtrStr(p.Connectivity.InternetAvailable),
		ConnLatency:           floatPtrFmt(p.Connectivity.LatencyMs, "%.0f"),
		ConnAvgLatency:        floatPtrFmt(p.Connectivity.AvgLatencyMs, "%.0f"),
		ConnJitter:            floatPtrFmt(p.Connectivity.JitterMs, "%.0f"),
		ConnPacketLoss:        floatPtrFmt(p.Connectivity.PacketLossPct, "%.1f"),
		PingTarget:            p.Connectivity.PingTarget,
		DuringRecovery:        boolPtrStr(p.Connectivity.DuringRecovery),
		RxRate:                int64PtrStr(p.Traffic.RxBytesPerSec),
		TxRate:                int64PtrStr(p.Traffic.TxBytesPerSec),
		WatchcatEnabled:       boolStr(p.Watchcat.Enabled),
		WatchcatState:         p.Watchcat.State,
		WatchcatTier:          intPtrStr(p.Watchcat.CurrentTier),
		WatchcatFailures:      intPtrStr(p.Watchcat.FailureCount),
		WatchcatTotal:         intPtrStr(p.Watchcat.TotalRecoveries),
		WatchcatLastTime:      int64PtrStr(p.Watchcat.LastRecoveryTime),
		WatchcatLastTier:      intPtrStr(p.Watchcat.LastRecoveryTier),
		SignalPerAntenna:      buildAntennaMap(&p.SignalPerAntenna, p.NR.State == "connected"),
	}
	return s
}

func mapCarrierComponents(in []pollerCarrierComponent) []CarrierComponent {
	out := make([]CarrierComponent, 0, len(in))
	for _, cc := range in {
		out = append(out, CarrierComponent{
			Type:         cc.Type,
			Technology:   cc.Technology,
			Band:         cc.Band,
			EARFCN:       intPtrStr(cc.EARFCN),
			BandwidthMHz: intPtrStr(cc.BandwidthMHz),
			PCI:          intPtrStr(cc.PCI),
			RSRP:         floatPtrFmt(cc.RSRP, "%.0f"),
			RSRQ:         floatPtrFmt(cc.RSRQ, "%.0f"),
			RSSI:         floatPtrFmt(cc.RSSI, "%.0f"),
			SINR:         floatPtrFmt(cc.SINR, "%.1f"),
		})
	}
	return out
}

func int64PtrStr(i *int64) string {
	if i == nil {
		return ""
	}
	return fmt.Sprintf("%d", *i)
}
```

- [ ] **Step 5: Run all cache tests**

Run: `cd discord-bot && go test -run TestReadStatus ./...`
Expected: PASS for both `TestReadStatus_AllFields` (existing) and `TestReadStatus_NewPollerFields` (new).

- [ ] **Step 6: Run full bot test suite to make sure nothing else broke**

Run: `cd discord-bot && go test ./...`
Expected: All tests PASS. (Some existing handler tests will still pass because they only assert on field count / titles — those will be rewritten in later tasks.)

- [ ] **Step 7: Commit**

```bash
git add discord-bot/cache.go discord-bot/cache_test.go
git commit -m "feat(discord-bot): extend cache with full poller field coverage

Adds CarrierComponent type and parses network.carrier_components,
total_bandwidth_mhz, bandwidth_details, APN. Adds per-radio cell_id /
TAC / EARFCN / PCI. Surfaces device identifiers (IMEI/IMSI/ICCID,
firmware, model, supported bands), connectivity stats (jitter, loss,
ping_target, during_recovery), traffic rates, and the full watchcat
block. Embed builders will consume these in subsequent tasks."
```

---

## Task 2: Add `readEventCounts` helper

**Files:**
- Modify: `discord-bot/cache.go`
- Test: `discord-bot/cache_test.go`

- [ ] **Step 1: Write the failing test**

Add to `discord-bot/cache_test.go`:

```go
func TestReadEventCounts(t *testing.T) {
	f, err := os.CreateTemp("", "events*.json")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(f.Name())

	lines := []string{
		`{"timestamp":1000,"type":"conn","message":"down","severity":"critical"}`,
		`{"timestamp":2000,"type":"conn","message":"warn1","severity":"warning"}`,
		`{"timestamp":3000,"type":"conn","message":"warn2","severity":"warning"}`,
		`{"timestamp":4000,"type":"conn","message":"info1","severity":"info"}`,
		`{"timestamp":5000,"type":"conn","message":"info2","severity":"info"}`,
		`{"timestamp":6000,"type":"conn","message":"info3","severity":"info"}`,
	}
	for _, l := range lines {
		f.WriteString(l + "\n")
	}
	f.Close()

	crit, warn, info, total, err := readEventCounts(f.Name())
	if err != nil {
		t.Fatalf("readEventCounts error: %v", err)
	}
	if crit != 1 || warn != 2 || info != 3 || total != 6 {
		t.Errorf("got crit=%d warn=%d info=%d total=%d", crit, warn, info, total)
	}
}

func TestReadEventCounts_MissingFile(t *testing.T) {
	_, _, _, _, err := readEventCounts("/tmp/nonexistent_qmanager_events.json")
	if err == nil {
		t.Error("expected error for missing file")
	}
}
```

- [ ] **Step 2: Run the test**

Run: `cd discord-bot && go test -run TestReadEventCounts ./...`
Expected: FAIL — `readEventCounts` is undefined.

- [ ] **Step 3: Implement `readEventCounts`**

Append to `discord-bot/cache.go` (after `readEvents`):

```go
const maxEventScan = 1000

// readEventCounts scans the NDJSON events file and returns severity counts plus total.
// total is capped at maxEventScan to bound disk reads.
func readEventCounts(path string) (crit, warn, info, total int, err error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0, 0, 0, err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if total >= maxEventScan {
			break
		}
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		var ev Event
		if json.Unmarshal(line, &ev) != nil {
			continue
		}
		total++
		switch ev.Severity {
		case "critical":
			crit++
		case "warning":
			warn++
		case "info":
			info++
		}
	}
	return crit, warn, info, total, sc.Err()
}
```

- [ ] **Step 4: Run the test again**

Run: `cd discord-bot && go test -run TestReadEventCounts ./...`
Expected: PASS for both test cases.

- [ ] **Step 5: Commit**

```bash
git add discord-bot/cache.go discord-bot/cache_test.go
git commit -m "feat(discord-bot): add readEventCounts for /events pill row"
```

---

## Task 3: Create `embeds.go` with shared chrome helpers

**Files:**
- Create: `discord-bot/embeds.go`
- Create: `discord-bot/embeds_test.go`

- [ ] **Step 1: Write the failing tests**

Create `discord-bot/embeds_test.go`:

```go
package main

import (
	"strings"
	"testing"
	"time"
)

func TestEmbedColor(t *testing.T) {
	now := time.Now().Unix()
	cases := []struct {
		name string
		s    *ModemStatus
		want int
	}{
		{"healthy", &ModemStatus{ConnInternetAvailable: "true", ModemReachable: "true", CacheTime: now}, colorGreen},
		{"degraded internet down", &ModemStatus{ConnInternetAvailable: "false", ModemReachable: "true", CacheTime: now}, colorAmber},
		{"degraded recovery", &ModemStatus{ConnInternetAvailable: "true", ModemReachable: "true", DuringRecovery: "true", CacheTime: now}, colorAmber},
		{"down modem unreachable", &ModemStatus{ConnInternetAvailable: "false", ModemReachable: "false", CacheTime: now}, colorRed},
		{"stale", &ModemStatus{ConnInternetAvailable: "true", ModemReachable: "true", CacheTime: now - 60}, colorGray},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := embedColor(c.s)
			if got != c.want {
				t.Errorf("embedColor=%#x, want %#x", got, c.want)
			}
		})
	}
}

func TestRelativeTime(t *testing.T) {
	now := time.Now().Unix()
	cases := []struct {
		secs int64
		want string
	}{
		{now - 1, "1s ago"},
		{now - 30, "30s ago"},
		{now - 90, "1m ago"},
		{now - 3700, "1h ago"},
		{now - 90000, "1d ago"},
	}
	for _, c := range cases {
		got := relativeTime(c.secs)
		if got != c.want {
			t.Errorf("relativeTime(%d): got %q, want %q", c.secs, got, c.want)
		}
	}
}

func TestRelativeTime_Stale(t *testing.T) {
	got := relativeTime(time.Now().Unix() - 60)
	if !strings.Contains(got, "stale") {
		// 60s is past stale threshold (30s)
		// our impl prefixes with "stale (1m ago)" or similar
		t.Errorf("expected stale marker for 60s ago, got %q", got)
	}
}

func TestFormatBytes(t *testing.T) {
	cases := []struct {
		in   int64
		want string
	}{
		{0, "0 B/s"},
		{500, "500 B/s"},
		{2048, "2.0 KB/s"},
		{1500000, "1.4 MB/s"},
		{2_000_000_000, "1.9 GB/s"},
	}
	for _, c := range cases {
		got := formatBytes(c.in)
		if got != c.want {
			t.Errorf("formatBytes(%d)=%q, want %q", c.in, got, c.want)
		}
	}
}

func TestSignalQualityBars(t *testing.T) {
	cases := []struct {
		bucket string
		want   string
	}{
		{"excellent", "▰▰▰▰▰"},
		{"good", "▰▰▰▰▱"},
		{"fair", "▰▰▰▱▱"},
		{"poor", "▰▰▱▱▱"},
		{"none", "▱▱▱▱▱"},
	}
	for _, c := range cases {
		got := signalQualityBars(c.bucket)
		if got != c.want {
			t.Errorf("signalQualityBars(%q)=%q, want %q", c.bucket, got, c.want)
		}
	}
}

func TestSignalQualityBucket(t *testing.T) {
	// Best RSRP from per-antenna map
	cases := []struct {
		ports map[string]AntennaSignal
		want  string
	}{
		{map[string]AntennaSignal{"main": {RSRP: "-75"}}, "excellent"},
		{map[string]AntennaSignal{"main": {RSRP: "-85"}}, "good"},
		{map[string]AntennaSignal{"main": {RSRP: "-100"}}, "fair"},
		{map[string]AntennaSignal{"main": {RSRP: "-115"}}, "poor"},
		{map[string]AntennaSignal{"main": {RSRP: "-130"}}, "none"},
		{map[string]AntennaSignal{}, "none"},
	}
	for _, c := range cases {
		got := signalQualityBucket(c.ports)
		if got != c.want {
			t.Errorf("signalQualityBucket(%v)=%q, want %q", c.ports, got, c.want)
		}
	}
}

func TestCcEmoji(t *testing.T) {
	cases := []struct {
		ccType, tech, want string
	}{
		{"PCC", "LTE", "🔵"},
		{"SCC", "LTE", "🟣"},
		{"PCC", "NR", "🟢"},
		{"SCC", "NR", "🟠"},
		{"OTHER", "LTE", "⚪"},
	}
	for _, c := range cases {
		got := ccEmoji(c.ccType, c.tech)
		if got != c.want {
			t.Errorf("ccEmoji(%s,%s)=%q, want %q", c.ccType, c.tech, got, c.want)
		}
	}
}
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `cd discord-bot && go test -run "TestEmbedColor|TestRelativeTime|TestFormatBytes|TestSignalQuality|TestCcEmoji" ./...`
Expected: FAIL — all helpers undefined (compile error).

- [ ] **Step 3: Create `embeds.go`**

Create `discord-bot/embeds.go`:

```go
package main

import (
	"fmt"
	"strconv"
	"time"

	"github.com/bwmarrin/discordgo"
)

// Color palette (semantic). colorGreen / colorRed / colorBlue / colorGray
// are kept compatible with handlers.go for now; colorAmber is new.
const (
	colorAmber = 0xf59e0b
)

// staleSeconds: cache older than this triggers gray sidebar + footer warning.
// Mirrors staleSecs in cache.go; defined here for embed-level use.
const embedStaleSecs = 30

// emoji vocabulary — single source of truth so every embed reuses identical glyphs.
var emoji = struct {
	Author       string
	PCI          string
	EARFCN       string
	Bandwidth    string
	Signal       string
	Temp         string
	Cell         string
	TAC          string
	Connection   string
	Network      string
	Uptime       string
	Watchcat     string
	Device       string
	Cells24h     string
	SCC          string
	Refresh      string
	Raw          string
	NavSignal    string
	NavBands     string
	NavStatus    string
	Expired      string
	Ok           string
	Warn         string
	Down         string
	Unknown      string
	Stale        string
}{
	Author:     "📡",
	PCI:        "🆔",
	EARFCN:     "📡",
	Bandwidth:  "📐",
	Signal:     "📈",
	Temp:       "🌡",
	Cell:       "🆔",
	TAC:        "📞",
	Connection: "🌐",
	Network:    "📶",
	Uptime:     "⏱",
	Watchcat:   "🛡",
	Device:     "🌡",
	Cells24h:   "🛰",
	SCC:        "🛰️",
	Refresh:    "↻",
	Raw:        "🧾",
	NavSignal:  "📡",
	NavBands:   "📊",
	NavStatus:  "📋",
	Expired:    "⌛",
	Ok:         "🟢",
	Warn:       "🟡",
	Down:       "🔴",
	Unknown:    "⚫",
	Stale:      "⚠",
}

// embedColor picks the sidebar color from cache state.
func embedColor(s *ModemStatus) int {
	if s.CacheTime > 0 && time.Now().Unix()-s.CacheTime > embedStaleSecs {
		return colorGray
	}
	if s.ModemReachable != "true" {
		return colorRed
	}
	if s.ConnInternetAvailable == "false" {
		return colorAmber
	}
	if s.DuringRecovery == "true" {
		return colorAmber
	}
	return colorGreen
}

// relativeTime renders a unix timestamp as "Xs ago" / "Xm ago" / "stale (Xm ago)".
// Caps at days; never negative.
func relativeTime(ts int64) string {
	if ts <= 0 {
		return "unknown"
	}
	delta := time.Now().Unix() - ts
	if delta < 0 {
		delta = 0
	}
	core := relativeCore(delta)
	if delta > embedStaleSecs {
		return "stale (" + core + ")"
	}
	return core
}

func relativeCore(secs int64) string {
	switch {
	case secs < 60:
		return fmt.Sprintf("%ds ago", secs)
	case secs < 3600:
		return fmt.Sprintf("%dm ago", secs/60)
	case secs < 86400:
		return fmt.Sprintf("%dh ago", secs/3600)
	default:
		return fmt.Sprintf("%dd ago", secs/86400)
	}
}

// formatBytes renders bytes-per-second as "1.4 MB/s" etc.
func formatBytes(b int64) string {
	const k = 1024
	switch {
	case b < k:
		return fmt.Sprintf("%d B/s", b)
	case b < k*k:
		return fmt.Sprintf("%.1f KB/s", float64(b)/k)
	case b < k*k*k:
		return fmt.Sprintf("%.1f MB/s", float64(b)/(k*k))
	default:
		return fmt.Sprintf("%.1f GB/s", float64(b)/(k*k*k))
	}
}

// signalQualityBucket maps the best-antenna RSRP into one of:
// excellent / good / fair / poor / none.
func signalQualityBucket(ports map[string]AntennaSignal) string {
	bestRSRP := 0.0
	any := false
	for _, ant := range ports {
		if ant.RSRP == "" {
			continue
		}
		v, err := strconv.ParseFloat(ant.RSRP, 64)
		if err != nil {
			continue
		}
		if !any || v > bestRSRP {
			bestRSRP = v
			any = true
		}
	}
	if !any {
		return "none"
	}
	switch {
	case bestRSRP >= -80:
		return "excellent"
	case bestRSRP >= -90:
		return "good"
	case bestRSRP >= -105:
		return "fair"
	case bestRSRP >= -120:
		return "poor"
	default:
		return "none"
	}
}

func signalQualityBars(bucket string) string {
	switch bucket {
	case "excellent":
		return "▰▰▰▰▰"
	case "good":
		return "▰▰▰▰▱"
	case "fair":
		return "▰▰▰▱▱"
	case "poor":
		return "▰▰▱▱▱"
	default:
		return "▱▱▱▱▱"
	}
}

// ccEmoji picks a color emoji that encodes both PCC/SCC tier and LTE/NR tech.
func ccEmoji(ccType, tech string) string {
	switch {
	case ccType == "PCC" && tech == "LTE":
		return "🔵"
	case ccType == "SCC" && tech == "LTE":
		return "🟣"
	case ccType == "PCC" && tech == "NR":
		return "🟢"
	case ccType == "SCC" && tech == "NR":
		return "🟠"
	default:
		return "⚪"
	}
}

// authorBlock returns the per-embed author line (e.g. "📡 QManager • RM520N-GL").
func authorBlock(s *ModemStatus) *discordgo.MessageEmbedAuthor {
	name := emoji.Author + " QManager"
	if s.Model != "" {
		name = name + " • " + s.Model
	}
	return &discordgo.MessageEmbedAuthor{Name: name}
}

// footerBlock returns the per-embed footer with relative-cache-time text.
func footerBlock(s *ModemStatus) *discordgo.MessageEmbedFooter {
	return &discordgo.MessageEmbedFooter{
		Text: "QManager • Updated " + relativeTime(s.CacheTime),
	}
}
```

- [ ] **Step 4: Run all tests**

Run: `cd discord-bot && go test ./...`
Expected: All tests in `embeds_test.go` PASS. Existing tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add discord-bot/embeds.go discord-bot/embeds_test.go
git commit -m "feat(discord-bot): shared chrome helpers (color, time, emoji, bars)

New embeds.go centralizes the visual vocabulary used by every query
embed: emoji glyph table, semantic color picker, relative-time
formatter, byte-rate humanizer, signal-quality bars, and per-CC
color-emoji selector. Future tasks consume these helpers."
```

---

## Task 4: Add `buildActionRow` and component-handler dispatcher

**Files:**
- Modify: `discord-bot/embeds.go`
- Modify: `discord-bot/embeds_test.go`

- [ ] **Step 1: Write the failing test**

Append to `discord-bot/embeds_test.go`:

```go
import (
	// add to existing imports
	"github.com/bwmarrin/discordgo"
)

func TestBuildActionRow_Bands(t *testing.T) {
	row := buildActionRow("bands")
	ar, ok := row.(discordgo.ActionsRow)
	if !ok {
		t.Fatalf("not ActionsRow: %T", row)
	}
	if len(ar.Components) != 4 {
		t.Fatalf("want 4 buttons for bands, got %d", len(ar.Components))
	}
	ids := buttonIDs(ar)
	wantIDs := []string{"qm:refresh:bands", "qm:nav:signal", "qm:nav:status", "qm:raw:bands"}
	for i, want := range wantIDs {
		if ids[i] != want {
			t.Errorf("button[%d] id=%q, want %q", i, ids[i], want)
		}
	}
}

func TestBuildActionRow_Signal(t *testing.T) {
	row := buildActionRow("signal")
	ar := row.(discordgo.ActionsRow)
	ids := buttonIDs(ar)
	wantIDs := []string{"qm:refresh:signal", "qm:nav:bands", "qm:nav:status", "qm:raw:signal"}
	for i, want := range wantIDs {
		if ids[i] != want {
			t.Errorf("button[%d] id=%q, want %q", i, ids[i], want)
		}
	}
}

func TestBuildActionRow_Status(t *testing.T) {
	row := buildActionRow("status")
	ar := row.(discordgo.ActionsRow)
	ids := buttonIDs(ar)
	wantIDs := []string{"qm:refresh:status", "qm:nav:signal", "qm:nav:bands", "qm:raw:status"}
	for i, want := range wantIDs {
		if ids[i] != want {
			t.Errorf("button[%d] id=%q, want %q", i, ids[i], want)
		}
	}
}

func TestBuildActionRow_Events(t *testing.T) {
	row := buildActionRow("events")
	ar := row.(discordgo.ActionsRow)
	if len(ar.Components) != 1 {
		t.Errorf("events should have 1 button (refresh only), got %d", len(ar.Components))
	}
	if buttonIDs(ar)[0] != "qm:refresh:events" {
		t.Errorf("events button id=%q", buttonIDs(ar)[0])
	}
}

func TestBuildActionRow_DeviceSimWatchcat(t *testing.T) {
	for _, src := range []string{"device", "sim", "watchcat"} {
		row := buildActionRow(src)
		ar := row.(discordgo.ActionsRow)
		if len(ar.Components) != 2 {
			t.Errorf("%s should have 2 buttons (refresh + raw), got %d", src, len(ar.Components))
		}
		ids := buttonIDs(ar)
		if ids[0] != "qm:refresh:"+src || ids[1] != "qm:raw:"+src {
			t.Errorf("%s buttons=%v", src, ids)
		}
	}
}

func TestDisabledActionRow(t *testing.T) {
	row := disabledActionRow("bands")
	ar := row.(discordgo.ActionsRow)
	for i, c := range ar.Components {
		btn, _ := c.(discordgo.Button)
		if !btn.Disabled {
			t.Errorf("button[%d] not disabled", i)
		}
	}
}

func TestParseCustomID(t *testing.T) {
	cases := []struct {
		in     string
		action string
		source string
		ok     bool
	}{
		{"qm:refresh:bands", "refresh", "bands", true},
		{"qm:nav:signal", "nav", "signal", true},
		{"qm:raw:status", "raw", "status", true},
		{"qm:bogus", "", "", false},
		{"", "", "", false},
		{"reboot_confirm", "", "", false},
	}
	for _, c := range cases {
		action, source, ok := parseCustomID(c.in)
		if action != c.action || source != c.source || ok != c.ok {
			t.Errorf("parseCustomID(%q): got (%q,%q,%v), want (%q,%q,%v)",
				c.in, action, source, ok, c.action, c.source, c.ok)
		}
	}
}

// buttonIDs is a test helper that pulls custom IDs out of an ActionsRow in order.
func buttonIDs(ar discordgo.ActionsRow) []string {
	out := make([]string, 0, len(ar.Components))
	for _, c := range ar.Components {
		if btn, ok := c.(discordgo.Button); ok {
			out = append(out, btn.CustomID)
		}
	}
	return out
}
```

- [ ] **Step 2: Run the test to verify failure**

Run: `cd discord-bot && go test -run "TestBuildActionRow|TestDisabledActionRow|TestParseCustomID" ./...`
Expected: FAIL — `buildActionRow`, `disabledActionRow`, `parseCustomID` undefined.

- [ ] **Step 3: Implement the row builder + parser**

Append to `discord-bot/embeds.go`:

```go
import (
	// add "strings" to existing imports
)

// navOrder defines which cross-jump buttons appear (in order) for each source.
// The current source is omitted from its own action row.
var navOrder = []string{"signal", "bands", "status"}

// buildActionRow returns the ActionsRow for a query embed.
//   - signal/bands/status: 4 buttons → Refresh, 2 cross-jumps (omitting self), Copy raw
//   - events: 1 button → Refresh only
//   - device/sim/watchcat: 2 buttons → Refresh, Copy raw
func buildActionRow(source string) discordgo.MessageComponent {
	btns := []discordgo.MessageComponent{
		discordgo.Button{Label: "Refresh", Style: discordgo.SecondaryButton, Emoji: &discordgo.ComponentEmoji{Name: "↻"}, CustomID: "qm:refresh:" + source},
	}
	switch source {
	case "signal", "bands", "status":
		for _, target := range navOrder {
			if target == source {
				continue
			}
			btns = append(btns, discordgo.Button{
				Label:    capitalize(target),
				Style:    discordgo.SecondaryButton,
				Emoji:    &discordgo.ComponentEmoji{Name: navEmojiFor(target)},
				CustomID: "qm:nav:" + target,
			})
		}
		btns = append(btns, discordgo.Button{Label: "Copy raw", Style: discordgo.SecondaryButton, Emoji: &discordgo.ComponentEmoji{Name: "🧾"}, CustomID: "qm:raw:" + source})
	case "events":
		// Refresh only — no nav, no raw (events log is its own raw view).
	default:
		// device, sim, watchcat → Refresh + Copy raw
		btns = append(btns, discordgo.Button{Label: "Copy raw", Style: discordgo.SecondaryButton, Emoji: &discordgo.ComponentEmoji{Name: "🧾"}, CustomID: "qm:raw:" + source})
	}
	return discordgo.ActionsRow{Components: btns}
}

func disabledActionRow(source string) discordgo.MessageComponent {
	row := buildActionRow(source).(discordgo.ActionsRow)
	disabled := make([]discordgo.MessageComponent, 0, len(row.Components))
	for _, c := range row.Components {
		btn := c.(discordgo.Button)
		btn.Disabled = true
		disabled = append(disabled, btn)
	}
	return discordgo.ActionsRow{Components: disabled}
}

func navEmojiFor(target string) string {
	switch target {
	case "signal":
		return "📡"
	case "bands":
		return "📊"
	case "status":
		return "📋"
	}
	return "•"
}

func capitalize(s string) string {
	if s == "" {
		return ""
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// parseCustomID parses "qm:<action>:<source>" custom IDs from button clicks.
// Returns (action, source, ok=true) on match, ("", "", false) otherwise.
func parseCustomID(id string) (string, string, bool) {
	parts := strings.Split(id, ":")
	if len(parts) != 3 || parts[0] != "qm" {
		return "", "", false
	}
	return parts[1], parts[2], true
}
```

(Make sure `strings` is in the import list at the top of `embeds.go`.)

- [ ] **Step 4: Run the action-row tests**

Run: `cd discord-bot && go test -run "TestBuildActionRow|TestDisabledActionRow|TestParseCustomID" ./...`
Expected: PASS for all cases.

- [ ] **Step 5: Run full suite**

Run: `cd discord-bot && go test ./...`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add discord-bot/embeds.go discord-bot/embeds_test.go
git commit -m "feat(discord-bot): action-row builder + qm: custom-id parser

buildActionRow returns the right button set per source: 4 for the big
three (refresh + 2 cross-jumps + copy raw), 1 for events, 2 for the
new commands. disabledActionRow returns the same row with all buttons
disabled (used by the auto-disable timer). parseCustomID routes
qm:<action>:<source> clicks in the component handler."
```

---

## Task 5: Auto-disable scheduler

**Files:**
- Modify: `discord-bot/embeds.go`
- Modify: `discord-bot/embeds_test.go`

- [ ] **Step 1: Write the failing test**

The scheduler itself fires after 14 minutes, which is too long for unit tests. Test the *helper* that builds the disabled-row + expiry message instead. Append to `discord-bot/embeds_test.go`:

```go
func TestExpiredEmbedField(t *testing.T) {
	f := expiredEmbedField()
	if f.Name == "" || f.Value == "" {
		t.Errorf("expired field has empty name/value: %+v", f)
	}
	if !strings.Contains(f.Value, "expired") {
		t.Errorf("expired field value should mention expiry: %q", f.Value)
	}
	if f.Inline {
		t.Error("expired field must be non-inline (full width)")
	}
}
```

- [ ] **Step 2: Run the test**

Run: `cd discord-bot && go test -run TestExpiredEmbedField ./...`
Expected: FAIL — `expiredEmbedField` undefined.

- [ ] **Step 3: Implement the helper + the scheduler**

Append to `discord-bot/embeds.go`:

```go
import (
	// add "log" to existing imports
)

// buttonExpiryWindow is how long after the initial response the buttons stay
// active. Discord interaction tokens expire at 15 min; we disable a minute earlier.
const buttonExpiryWindow = 14 * time.Minute

func expiredEmbedField() *discordgo.MessageEmbedField {
	return &discordgo.MessageEmbedField{
		Name:   emoji.Expired + " Buttons expired",
		Value:  "Run the command again to get fresh interactive buttons.",
		Inline: false,
	}
}

// scheduleButtonExpiry queues a one-shot edit that disables the action row
// and appends an "expired" field to the original embed. Fires after
// buttonExpiryWindow. If the bot restarts, the timer dies; buttons stay
// enabled but clicks fail silently — Discord's hard 15-minute interaction
// token expiry is the underlying constraint.
func scheduleButtonExpiry(s *discordgo.Session, i *discordgo.Interaction, source string, originalEmbed *discordgo.MessageEmbed) {
	time.AfterFunc(buttonExpiryWindow, func() {
		// Append expired field to a copy (don't mutate caller's embed).
		updated := *originalEmbed
		updated.Fields = append(append([]*discordgo.MessageEmbedField{}, originalEmbed.Fields...), expiredEmbedField())
		row := disabledActionRow(source)
		_, err := s.InteractionResponseEdit(i, &discordgo.WebhookEdit{
			Embeds:     &[]*discordgo.MessageEmbed{&updated},
			Components: &[]discordgo.MessageComponent{row},
		})
		if err != nil {
			// Token already expired — expected after 15 min. Log at debug level.
			log.Printf("scheduleButtonExpiry: edit failed for source=%s: %v", source, err)
		}
	})
}
```

- [ ] **Step 4: Run the test**

Run: `cd discord-bot && go test -run TestExpiredEmbedField ./...`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `cd discord-bot && go test ./...`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add discord-bot/embeds.go discord-bot/embeds_test.go
git commit -m "feat(discord-bot): button auto-disable scheduler (14-min window)

scheduleButtonExpiry fires once per response, edits the message to
disable buttons and append an expired field. Mirrors the existing
/reboot 30s expiry pattern. expiredEmbedField is exposed separately
so it can be unit-tested without waiting 14 minutes."
```

---

## Task 6: Rewrite `buildBandsEmbed` (hybrid layout)

**Files:**
- Modify: `discord-bot/handlers.go`
- Modify: `discord-bot/handlers_test.go`

- [ ] **Step 1: Write the failing tests**

Replace the existing `TestBuildBandsEmbed_Fields` in `discord-bot/handlers_test.go` with this richer test set:

```go
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
	// First two fields are the CC cards in array order.
	if !strings.Contains(embed.Fields[0].Name, "PCC") || !strings.Contains(embed.Fields[0].Name, "B3") {
		t.Errorf("field[0].Name=%q", embed.Fields[0].Name)
	}
	if !strings.Contains(embed.Fields[1].Name, "SCC") || !strings.Contains(embed.Fields[1].Name, "n78") {
		t.Errorf("field[1].Name=%q", embed.Fields[1].Name)
	}
	// CC card value uses ARFCN label for NR.
	if !strings.Contains(embed.Fields[1].Value, "ARFCN 642000") {
		t.Errorf("field[1].Value missing ARFCN label: %q", embed.Fields[1].Value)
	}
	// LTE card uses EARFCN label.
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
	// 6 CC cards + overflow note = 7 fields minimum. Plus optional serving cell.
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
```

(Add `"fmt"` and `"strings"` to the imports in `handlers_test.go` if not already present.)

- [ ] **Step 2: Run the tests**

Run: `cd discord-bot && go test -run TestBuildBandsEmbed ./...`
Expected: FAIL — current `buildBandsEmbed` returns the old shape.

- [ ] **Step 3: Rewrite `buildBandsEmbed` and add helpers**

Replace the entire `buildBandsEmbed` function in `discord-bot/handlers.go` with:

```go
const maxVisibleCCs = 6

func buildBandsEmbed(s *ModemStatus) *discordgo.MessageEmbed {
	descr := buildBandsDescription(s)
	color := embedColor(s)

	var fields []*discordgo.MessageEmbedField

	if len(s.CarrierComponents) == 0 {
		// Fallback — show whatever single-band data we have.
		if s.LteBand != "" {
			fields = append(fields, &discordgo.MessageEmbedField{
				Name: emoji.Network + " LTE Band", Value: s.LteBand, Inline: true,
			})
		}
		if s.NrBand != "" {
			fields = append(fields, &discordgo.MessageEmbedField{
				Name: emoji.Network + " NR Band", Value: s.NrBand, Inline: true,
			})
		}
	} else {
		visible := s.CarrierComponents
		if len(visible) > maxVisibleCCs {
			visible = visible[:maxVisibleCCs]
		}
		for _, cc := range visible {
			fields = append(fields, ccField(cc))
		}
		if len(s.CarrierComponents) > maxVisibleCCs {
			fields = append(fields, &discordgo.MessageEmbedField{
				Name:   "More carriers",
				Value:  fmt.Sprintf("+%d more — use Copy raw to view", len(s.CarrierComponents)-maxVisibleCCs),
				Inline: false,
			})
		}
	}

	if s.LteCellID != "" || s.NrCellID != "" {
		fields = append(fields, servingCellField(s), tacField(s))
	}

	return &discordgo.MessageEmbed{
		Author:      authorBlock(s),
		Title:       "Band Details",
		Description: descr,
		Color:       color,
		Fields:      fields,
		Footer:      footerBlock(s),
		Timestamp:   time.Unix(s.CacheTime, 0).Format(time.RFC3339),
	}
}

func buildBandsDescription(s *ModemStatus) string {
	if s.ModemReachable != "true" {
		return emoji.Down + " Modem unreachable"
	}
	stalePrefix := ""
	if s.CacheTime > 0 && time.Now().Unix()-s.CacheTime > embedStaleSecs {
		stalePrefix = emoji.Stale + " Stale · "
	}
	bw := s.TotalBandwidthMHz
	if bw == "" {
		bw = "?"
	}
	n := len(s.CarrierComponents)
	if n == 0 {
		return stalePrefix + emoji.Warn + " No CA data — single-carrier or modem report unavailable"
	}
	hasLte, hasNr := false, false
	for _, cc := range s.CarrierComponents {
		if cc.Technology == "LTE" {
			hasLte = true
		}
		if cc.Technology == "NR" {
			hasNr = true
		}
	}
	var label string
	switch {
	case hasLte && hasNr:
		label = "EN-DC active"
	case hasLte && n > 1:
		label = "LTE-A active"
	case hasNr && n > 1:
		label = "NR-CA active"
	default:
		label = "Single carrier"
	}
	if n == 1 {
		return fmt.Sprintf("%s%s %s • %s %s MHz", stalePrefix, emoji.Ok, label, emoji.SCC, bw)
	}
	return fmt.Sprintf("%s%s %s • %s %s MHz total • %s %d carriers",
		stalePrefix, emoji.Ok, label, emoji.SCC, bw, emoji.SCC, n)
}

func ccField(cc CarrierComponent) *discordgo.MessageEmbedField {
	arfcnLabel := "EARFCN"
	if cc.Technology == "NR" {
		arfcnLabel = "ARFCN"
	}
	name := fmt.Sprintf("%s %s · %s %s", ccEmoji(cc.Type, cc.Technology), cc.Type, cc.Technology, cc.Band)
	value := fmt.Sprintf("%s PCI %s\n%s %s %s\n%s %s MHz\n%s RSRP %s / SINR %s",
		emoji.PCI, ifEmpty(cc.PCI, "—"),
		emoji.EARFCN, arfcnLabel, ifEmpty(cc.EARFCN, "—"),
		emoji.Bandwidth, ifEmpty(cc.BandwidthMHz, "—"),
		emoji.Signal, ifEmpty(cc.RSRP, "—"), ifEmpty(cc.SINR, "—"),
	)
	return &discordgo.MessageEmbedField{Name: name, Value: value, Inline: true}
}

func servingCellField(s *ModemStatus) *discordgo.MessageEmbedField {
	parts := []string{}
	if s.LteCellID != "" {
		parts = append(parts, "LTE: "+s.LteCellID)
	}
	if s.NrCellID != "" {
		parts = append(parts, "NR: "+s.NrCellID)
	}
	return &discordgo.MessageEmbedField{
		Name:   emoji.Cell + " Serving cell",
		Value:  strings.Join(parts, " · "),
		Inline: false,
	}
}

func tacField(s *ModemStatus) *discordgo.MessageEmbedField {
	parts := []string{}
	if s.LteTAC != "" || s.LteCellID != "" {
		parts = append(parts, fmt.Sprintf("LTE: %s (cell %s)", ifEmpty(s.LteTAC, "—"), ifEmpty(s.LteCellID, "—")))
	}
	if s.NrTAC != "" || s.NrCellID != "" {
		parts = append(parts, fmt.Sprintf("NR: %s (cell %s)", ifEmpty(s.NrTAC, "—"), ifEmpty(s.NrCellID, "—")))
	}
	return &discordgo.MessageEmbedField{
		Name:   emoji.TAC + " TAC / Cell ID",
		Value:  strings.Join(parts, " · "),
		Inline: false,
	}
}
```

Add `"strings"` to the import block at the top of `handlers.go` if not already present.

Also **delete** the now-unused constants `colorGreen`, `colorYellow`, `colorRed`, `colorBlue`, `colorGray` from `handlers.go` only if they were duplicated — they're still used by `embedColor` in `embeds.go`. Actually they need to stay defined somewhere. Move the const block from the top of `handlers.go` into `embeds.go`. Replace the `const (...)` block at the top of `handlers.go` (currently containing `colorGreen` through `colorGray` plus the cache paths) with **just** the cache paths:

```go
const (
	statusCachePath = "/tmp/qmanager_status.json"
	eventsCachePath = "/tmp/qmanager_events.json"
)
```

And add to the const block at the top of `embeds.go`:

```go
const (
	colorGreen  = 0x22c55e
	colorYellow = 0xf59e0b
	colorRed    = 0xef4444
	colorBlue   = 0x3b82f6
	colorGray   = 0x6b7280
	colorAmber  = 0xf59e0b
)
```

(Delete the standalone `const colorAmber = 0xf59e0b` declared in Task 3 since it's now in this consolidated block. `colorYellow` and `colorAmber` have the same value — keeping both names since `colorYellow` may be used elsewhere; both are aliased intentionally.)

Also delete the now-unused `embedColorForInternet` function and `staleWarning` function from `handlers.go` — `embedColor` and the description-builder pill rows have replaced them.

- [ ] **Step 4: Run the bands tests**

Run: `cd discord-bot && go test -run TestBuildBandsEmbed ./...`
Expected: PASS for all 7 cases.

- [ ] **Step 5: Run full suite — expect some old assertions to fail**

Run: `cd discord-bot && go test ./...`
Expected: Existing `TestBuildStatusEmbed_InternetDown` likely fails (asserts on old `Internet` field name and old color logic). That's OK — Tasks 7-9 will rewrite those tests. Document failing test names; don't fix yet.

- [ ] **Step 6: Commit**

```bash
git add discord-bot/handlers.go discord-bot/embeds.go discord-bot/handlers_test.go
git commit -m "feat(discord-bot): rewrite /bands with hybrid CC layout

Header pill row summarizes EN-DC/LTE-A/NR-CA + total bandwidth +
carrier count. Per-CC inline cards show PCI, EARFCN/ARFCN (label
switches by tech), bandwidth, RSRP+SINR. Caps at 6 visible CCs with
overflow note. Falls back to single-band display when carrier_components
empty. Serving cell + TAC fields appended when data present.
Modem-unreachable / stale states have explicit description messages.

Color constants consolidated into embeds.go; embedColorForInternet and
staleWarning removed (replaced by embedColor + description pill rows)."
```

---

## Task 7: Rewrite `buildSignalEmbed`

**Files:**
- Modify: `discord-bot/handlers.go`
- Modify: `discord-bot/handlers_test.go`

- [ ] **Step 1: Write the failing tests**

Replace the existing `TestBuildSignalEmbed_HasTitle` and `TestBuildSignalEmbed_TitleIsCorrect` in `discord-bot/handlers_test.go` with this set:

```go
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
		"main":      {RSRP: "-85", SINR: "18", RSRQ: "-10"}, // good → 🟢
		"diversity": {RSRP: "-100", SINR: "8", RSRQ: "-13"}, // fair → 🟡
		"mimo3":     {RSRP: "-115", SINR: "-2", RSRQ: "-18"}, // poor → 🔴
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
```

- [ ] **Step 2: Run the tests**

Run: `cd discord-bot && go test -run TestBuildSignalEmbed ./...`
Expected: FAIL — current builder doesn't emit pill row, color emoji, or provenance.

- [ ] **Step 3: Rewrite `buildSignalEmbed`**

Replace the entire `buildSignalEmbed` function in `discord-bot/handlers.go` with:

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
	for _, port := range ports {
		ant, ok := s.SignalPerAntenna[port]
		if !ok {
			continue
		}
		portEmoji := perPortEmoji(ant.RSRP)
		fields = append(fields, &discordgo.MessageEmbedField{
			Name: fmt.Sprintf("%s %s", portEmoji, labels[port]),
			Value: fmt.Sprintf("RSRP %s dBm  SINR %s dB\nRSRQ %s dB",
				ifEmpty(ant.RSRP, "—"), ifEmpty(ant.SINR, "—"), ifEmpty(ant.RSRQ, "—"),
			),
			Inline: true,
		})
	}

	// Provenance footnote
	if note := provenanceNote(s); note != "" {
		fields = append(fields, &discordgo.MessageEmbedField{
			Name: "ℹ️ Source", Value: note, Inline: false,
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

func qualityEmojiForBucket(b string) string {
	switch b {
	case "excellent", "good":
		return emoji.Ok
	case "fair":
		return emoji.Warn
	case "poor":
		return emoji.Down
	default:
		return emoji.Unknown
	}
}

func perPortEmoji(rsrpStr string) string {
	if rsrpStr == "" {
		return emoji.Unknown
	}
	v, err := strconv.ParseFloat(rsrpStr, 64)
	if err != nil {
		return emoji.Unknown
	}
	switch {
	case v >= -90:
		return emoji.Ok
	case v >= -110:
		return emoji.Warn
	default:
		return emoji.Down
	}
}

func provenanceNote(s *ModemStatus) string {
	switch {
	case s.NrState == "connected" && s.LteState == "connected":
		return "Showing NR values (EN-DC active — LTE leg also connected)"
	case s.NrState == "connected":
		return "Showing NR values"
	case s.LteState == "connected":
		return "Showing LTE values"
	default:
		return ""
	}
}
```

Add `"strconv"` to the imports at the top of `handlers.go` if not already present.

- [ ] **Step 4: Run the signal tests**

Run: `cd discord-bot && go test -run TestBuildSignalEmbed ./...`
Expected: PASS for all 5 cases.

- [ ] **Step 5: Commit**

```bash
git add discord-bot/handlers.go discord-bot/handlers_test.go
git commit -m "feat(discord-bot): rewrite /signal with quality bars + provenance

Pill row shows quality bucket + primary radio + ▰▱ bar visualization.
Per-port field names get a color emoji (🟢/🟡/🔴) reflecting that
port's RSRP bucket so weak antennas pop visually. Adds an explicit
provenance footnote so users know whether they're seeing NR or LTE
values (the silent NR-over-LTE picking was confusing)."
```

---

## Task 8: Rewrite `buildStatusEmbed`

**Files:**
- Modify: `discord-bot/handlers.go`
- Modify: `discord-bot/handlers_test.go`

- [ ] **Step 1: Write the failing tests**

Replace the existing `TestBuildStatusEmbed_InternetDown` in `discord-bot/handlers_test.go` with:

```go
func TestBuildStatusEmbed_Title(t *testing.T) {
	s := makeStatus("true", "true", "LTE")
	if buildStatusEmbed(s).Title != "Modem Status" {
		t.Errorf("wrong title")
	}
}

func TestBuildStatusEmbed_PillRow_Up(t *testing.T) {
	s := makeStatus("true", "true", "LTE")
	s.ConnLatency = "23"
	s.RxRate = "1500000"
	s.TxRate = "250000"
	embed := buildStatusEmbed(s)
	if !strings.Contains(embed.Description, "Internet up") {
		t.Errorf("description=%q", embed.Description)
	}
	if !strings.Contains(embed.Description, "23 ms") {
		t.Errorf("description missing latency: %q", embed.Description)
	}
	if !strings.Contains(embed.Description, "MB/s") {
		t.Errorf("description missing throughput: %q", embed.Description)
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
```

- [ ] **Step 2: Run the tests**

Run: `cd discord-bot && go test -run TestBuildStatusEmbed ./...`
Expected: FAIL.

- [ ] **Step 3: Rewrite `buildStatusEmbed`**

Replace the entire `buildStatusEmbed` function in `discord-bot/handlers.go` with:

```go
func buildStatusEmbed(s *ModemStatus) *discordgo.MessageEmbed {
	descr := buildStatusDescription(s)
	color := embedColor(s)

	fields := []*discordgo.MessageEmbedField{
		connectionField(s),
		networkField(s),
		uptimeField(s),
		watchcatField(s),
		deviceMetricsField(s),
	}
	if scc := sccHandoffsField(s); scc != nil {
		fields = append(fields, scc)
	}

	return &discordgo.MessageEmbed{
		Author:      authorBlock(s),
		Title:       "Modem Status",
		Description: descr,
		Color:       color,
		Fields:      fields,
		Footer:      footerBlock(s),
		Timestamp:   time.Unix(s.CacheTime, 0).Format(time.RFC3339),
	}
}

func buildStatusDescription(s *ModemStatus) string {
	if s.ModemReachable != "true" {
		return emoji.Down + " Modem unreachable"
	}
	if s.ConnInternetAvailable == "false" {
		return emoji.Down + " Internet down · modem reachable"
	}
	if s.ConnInternetAvailable != "true" {
		return emoji.Unknown + " Connectivity unknown"
	}
	parts := []string{emoji.Ok + " Internet up"}
	if s.ConnLatency != "" {
		parts = append(parts, s.ConnLatency+" ms")
	}
	if s.RxRate != "" {
		if rx, err := strconv.ParseInt(s.RxRate, 10, 64); err == nil {
			parts = append(parts, "↓ "+formatBytes(rx))
		}
	}
	if s.TxRate != "" {
		if tx, err := strconv.ParseInt(s.TxRate, 10, 64); err == nil {
			parts = append(parts, "↑ "+formatBytes(tx))
		}
	}
	return strings.Join(parts, " · ")
}

func connectionField(s *ModemStatus) *discordgo.MessageEmbedField {
	state := "Up"
	if s.ConnInternetAvailable != "true" {
		state = "Down"
	}
	line1Parts := []string{state}
	if s.ConnLatency != "" {
		line1Parts = append(line1Parts, "· "+s.ConnLatency+" ms")
	}
	if s.ConnAvgLatency != "" || s.ConnJitter != "" {
		extra := []string{}
		if s.ConnAvgLatency != "" {
			extra = append(extra, "avg "+s.ConnAvgLatency)
		}
		if s.ConnJitter != "" {
			extra = append(extra, "jitter "+s.ConnJitter)
		}
		line1Parts = append(line1Parts, "("+strings.Join(extra, ", ")+")")
	}
	line2Parts := []string{}
	if s.ConnPacketLoss != "" {
		line2Parts = append(line2Parts, s.ConnPacketLoss+"% loss")
	}
	if s.PingTarget != "" {
		line2Parts = append(line2Parts, "ping "+s.PingTarget)
	}
	value := strings.Join(line1Parts, " ")
	if len(line2Parts) > 0 {
		value += "\n" + strings.Join(line2Parts, " · ")
	}
	return &discordgo.MessageEmbedField{
		Name: emoji.Connection + " Connection", Value: value, Inline: true,
	}
}

func networkField(s *ModemStatus) *discordgo.MessageEmbedField {
	line1 := []string{}
	if s.Operator != "" {
		line1 = append(line1, s.Operator)
	}
	if s.NetworkType != "" {
		line1 = append(line1, s.NetworkType)
	}
	if s.SimSlot != "" {
		line1 = append(line1, "SIM "+s.SimSlot)
	}
	value := strings.Join(line1, " · ")
	if s.WanIP != "" {
		value += "\nWAN " + s.WanIP
	}
	return &discordgo.MessageEmbedField{
		Name: emoji.Network + " Network", Value: ifEmpty(value, "—"), Inline: true,
	}
}

func uptimeField(s *ModemStatus) *discordgo.MessageEmbedField {
	value := fmt.Sprintf("Connection: %s\nDevice: %s",
		ifEmpty(s.ConnUptime, "—"), ifEmpty(s.Uptime, "—"))
	return &discordgo.MessageEmbedField{
		Name: emoji.Uptime + " Uptime", Value: value, Inline: true,
	}
}

func watchcatField(s *ModemStatus) *discordgo.MessageEmbedField {
	state := s.WatchcatState
	if state == "" {
		state = "Unknown"
	}
	failures := ifEmpty(s.WatchcatFailures, "0")
	last := "never"
	if s.WatchcatLastTime != "" && s.WatchcatLastTime != "0" {
		if ts, err := strconv.ParseInt(s.WatchcatLastTime, 10, 64); err == nil && ts > 0 {
			last = relativeTime(ts)
		}
	}
	value := fmt.Sprintf("%s · %s failures\nLast recovery: %s", state, failures, last)
	return &discordgo.MessageEmbedField{
		Name: emoji.Watchcat + " Watchcat", Value: value, Inline: true,
	}
}

func deviceMetricsField(s *ModemStatus) *discordgo.MessageEmbedField {
	parts := []string{}
	if s.CpuUsage != "" {
		parts = append(parts, "CPU "+s.CpuUsage+"%")
	}
	if s.CpuTemp != "" {
		parts = append(parts, s.CpuTemp)
	}
	if s.MemUsedMB != "" && s.MemTotalMB != "" {
		parts = append(parts, "Mem "+s.MemUsedMB+"/"+s.MemTotalMB+" MB")
	}
	return &discordgo.MessageEmbedField{
		Name: emoji.Device + " Device", Value: ifEmpty(strings.Join(parts, " · "), "—"), Inline: true,
	}
}

// sccHandoffsField returns a field summarizing scc_pci_change events in the
// last 24h, or nil if events log unreadable / no events.
func sccHandoffsField(s *ModemStatus) *discordgo.MessageEmbedField {
	count, err := countSccHandoffs24h(eventsCachePath)
	if err != nil || count == 0 {
		return nil
	}
	return &discordgo.MessageEmbedField{
		Name:   emoji.Cells24h + " SCC handoffs (24h)",
		Value:  fmt.Sprintf("%d PCI changes detected", count),
		Inline: true,
	}
}

func countSccHandoffs24h(path string) (int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	cutoff := time.Now().Unix() - 86400
	count := 0
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		var ev Event
		if json.Unmarshal(line, &ev) != nil {
			continue
		}
		if ev.Type == "scc_pci_change" && ev.Timestamp >= cutoff {
			count++
		}
	}
	return count, sc.Err()
}
```

Add `"bufio"`, `"encoding/json"`, `"os"` to the imports of `handlers.go` (some may already be present).

- [ ] **Step 4: Run the status tests**

Run: `cd discord-bot && go test -run TestBuildStatusEmbed ./...`
Expected: PASS for all 6 cases.

- [ ] **Step 5: Run full suite**

Run: `cd discord-bot && go test ./...`
Expected: All PASS (signal/bands already done; events still uses old impl but test asserts pass).

- [ ] **Step 6: Commit**

```bash
git add discord-bot/handlers.go discord-bot/handlers_test.go
git commit -m "feat(discord-bot): rewrite /status with connectivity-first layout

Pill row surfaces internet state + latency + live throughput. Five
inline fields cover Connection (with avg/jitter/loss/ping target),
Network (carrier+type+SIM+WAN), Uptime (split connection vs device),
Watchcat (state + failures + last recovery relative-time), and Device
metrics (CPU/temp/RAM). Optional SCC handoffs field counts
scc_pci_change events from the last 24h."
```

---

## Task 9: Rewrite `buildEventsEmbed`

**Files:**
- Modify: `discord-bot/handlers.go`
- Modify: `discord-bot/handlers_test.go`

- [ ] **Step 1: Write the failing tests**

Replace `TestBuildEventsEmbed_Empty` and `TestBuildEventsEmbed_WithEvents` in `discord-bot/handlers_test.go` with:

```go
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
	if !strings.Contains(embed.Description, "last 5 of 47") {
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
```

Note that `buildEventsEmbed`'s signature is changing — it now takes severity counts and total. The handler will call `readEventCounts` and pass them in.

- [ ] **Step 2: Run the tests**

Run: `cd discord-bot && go test -run TestBuildEventsEmbed ./...`
Expected: FAIL — signature changed; old impl returns wrong description.

- [ ] **Step 3: Rewrite `buildEventsEmbed` and update `handleEvents`**

Replace the entire `buildEventsEmbed` function in `discord-bot/handlers.go` with:

```go
func buildEventsEmbed(events []Event, crit, warn, info, total int) *discordgo.MessageEmbed {
	if len(events) == 0 {
		return &discordgo.MessageEmbed{
			Title:       "Recent Events",
			Description: "No events recorded yet.",
			Color:       colorGray,
		}
	}
	descr := fmt.Sprintf("%s %d critical · %s %d warnings · ℹ️ %d info — last %d of %d",
		emoji.Down, crit, emoji.Warn, warn, info, len(events), total,
	)

	severityIcon := map[string]string{
		"info": "ℹ️", "warning": emoji.Warn, "critical": emoji.Down,
	}
	color := colorBlue
	worst := ""
	for _, ev := range events {
		switch ev.Severity {
		case "critical":
			worst = "critical"
		case "warning":
			if worst != "critical" {
				worst = "warning"
			}
		}
	}
	switch worst {
	case "critical":
		color = colorRed
	case "warning":
		color = colorAmber
	}

	var lines []string
	for i := len(events) - 1; i >= 0; i-- {
		ev := events[i]
		icon := severityIcon[ev.Severity]
		if icon == "" {
			icon = "•"
		}
		ts := time.Unix(ev.Timestamp, 0).Format("Jan 02 15:04")
		lines = append(lines, fmt.Sprintf("%s **%s** — %s", icon, ts, ev.Message))
	}
	return &discordgo.MessageEmbed{
		Title:       "Recent Events",
		Description: descr + "\n\n" + strings.Join(lines, "\n"),
		Color:       color,
		Footer:      &discordgo.MessageEmbedFooter{Text: "QManager"},
	}
}
```

Replace the `handleEvents` function to fetch counts:

```go
func handleEvents(s *discordgo.Session, i *discordgo.InteractionCreate) {
	events, err := readEvents(eventsCachePath)
	if err != nil {
		log.Printf("readEvents error: %v", err)
		events = []Event{}
	}
	crit, warn, info, total, _ := readEventCounts(eventsCachePath)
	embed := buildEventsEmbed(events, crit, warn, info, total)
	respondEmbedWithButtons(s, i, embed, "events")
}
```

(Note: `respondEmbedWithButtons` is added in Task 10. For now, keep `respondEmbed(s, i, embed)` and update in Task 10. Or implement the wrapper now. To keep this task self-contained, leave `respondEmbed(s, i, embed)` and Task 10 will swap it.)

- [ ] **Step 4: Run the events tests**

Run: `cd discord-bot && go test -run TestBuildEventsEmbed ./...`
Expected: PASS for all 3 cases.

- [ ] **Step 5: Run full suite**

Run: `cd discord-bot && go test ./...`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add discord-bot/handlers.go discord-bot/handlers_test.go
git commit -m "feat(discord-bot): rewrite /events with severity badge + worst-color

Description now opens with a count badge (N critical / N warnings /
N info) and a 'last 5 of N' total. Sidebar color overrides the default
based on the worst severity in the visible window: red if any
critical, amber if any warning, blue otherwise. handleEvents reads
counts via the new readEventCounts helper."
```

---

## Task 10: Component handler dispatcher (Refresh / nav / raw)

**Files:**
- Modify: `discord-bot/handlers.go`
- Modify: `discord-bot/handlers_test.go`

- [ ] **Step 1: Write the failing tests**

Append to `discord-bot/handlers_test.go`:

```go
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
	rawJSON := []byte(`{"network":{"type":"5G"},"lte":{"band":"B3"},"nr":{"band":"n78"},"connectivity":{"latency_ms":15},"device":{"model":"RM520"},"watchcat":{"state":"idle"},"signal_per_antenna":{"nr_rsrp":[1]},"traffic":{"rx_bytes_per_sec":100}}`)
	cases := []struct {
		source string
		mustHave []string
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
```

- [ ] **Step 2: Run the tests**

Run: `cd discord-bot && go test -run "TestEmbedForSource|TestRawSliceFor" ./...`
Expected: FAIL — `embedForSource` and `rawSliceFor` undefined.

- [ ] **Step 3: Add the dispatcher helpers + extend `handleComponent`**

Append to `discord-bot/handlers.go`:

```go
// embedForSource is the router: given a source string from a custom ID,
// returns a freshly-built embed of that type. Unknown sources return nil.
// /sim, /device, /watchcat builders come from later tasks.
func embedForSource(source string, s *ModemStatus) *discordgo.MessageEmbed {
	switch source {
	case "signal":
		return buildSignalEmbed(s)
	case "bands":
		return buildBandsEmbed(s)
	case "status":
		return buildStatusEmbed(s)
	case "device":
		return buildDeviceEmbed(s)
	case "sim":
		return buildSimEmbed(s)
	case "watchcat":
		return buildWatchcatEmbed(s)
	}
	return nil
}

// rawSliceFor returns the JSON subset relevant to a given source, used by
// the Copy raw button. raw is the bytes from /tmp/qmanager_status.json.
func rawSliceFor(source string, raw []byte) ([]byte, error) {
	var full map[string]json.RawMessage
	if err := json.Unmarshal(raw, &full); err != nil {
		return nil, err
	}
	keys := map[string][]string{
		"signal":   {"signal_per_antenna", "lte", "nr"},
		"bands":    {"network", "lte", "nr"},
		"status":   {"connectivity", "device", "network", "watchcat"},
		"device":   {"device"},
		"sim":      {"network", "device"},
		"watchcat": {"watchcat"},
		"events":   {},
	}
	wanted, ok := keys[source]
	if !ok {
		return raw, nil
	}
	out := make(map[string]json.RawMessage, len(wanted))
	for _, k := range wanted {
		if v, ok := full[k]; ok {
			out[k] = v
		}
	}
	return json.MarshalIndent(out, "", "  ")
}

const maxRawLen = 3900 // leave room for ```json fences (Discord cap is 4000)

// respondEmbedWithButtons sends an initial embed response with the action row
// for `source`, then schedules the auto-disable timer. Replaces respondEmbed
// for query commands.
func respondEmbedWithButtons(s *discordgo.Session, i *discordgo.InteractionCreate, embed *discordgo.MessageEmbed, source string) {
	row := buildActionRow(source)
	if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Embeds:     []*discordgo.MessageEmbed{embed},
			Components: []discordgo.MessageComponent{row},
		},
	}); err != nil {
		log.Printf("InteractionRespond error (%s): %v", source, err)
		return
	}
	scheduleButtonExpiry(s, i.Interaction, source, embed)
}

// respondEmbedEphemeral is like respondEmbedWithButtons but sets the
// ephemeral flag. Used by /sim.
func respondEmbedEphemeral(s *discordgo.Session, i *discordgo.InteractionCreate, embed *discordgo.MessageEmbed, source string) {
	row := buildActionRow(source)
	if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Embeds:     []*discordgo.MessageEmbed{embed},
			Components: []discordgo.MessageComponent{row},
			Flags:      discordgo.MessageFlagsEphemeral,
		},
	}); err != nil {
		log.Printf("InteractionRespond error (ephemeral %s): %v", source, err)
		return
	}
	scheduleButtonExpiry(s, i.Interaction, source, embed)
}

// dispatchQmComponent handles "qm:<action>:<source>" component clicks.
// Returns true if the click was a qm: ID (handled), false if not.
func dispatchQmComponent(s *discordgo.Session, i *discordgo.InteractionCreate) bool {
	action, source, ok := parseCustomID(i.MessageComponentData().CustomID)
	if !ok {
		return false
	}
	switch action {
	case "refresh", "nav":
		handleRefreshOrNav(s, i, source)
	case "raw":
		handleCopyRaw(s, i, source)
	}
	return true
}

func handleRefreshOrNav(s *discordgo.Session, i *discordgo.InteractionCreate, source string) {
	if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseDeferredMessageUpdate,
	}); err != nil {
		log.Printf("defer error: %v", err)
		return
	}
	ms, err := readStatus(statusCachePath)
	if err != nil {
		// Inject failure field on top of the existing embed — best effort.
		failEmbed := &discordgo.MessageEmbed{
			Title:       "Modem Status",
			Description: emoji.Down + " Refresh failed — cache unreadable",
			Color:       colorRed,
		}
		row := buildActionRow(source)
		_, _ = s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
			Embeds:     &[]*discordgo.MessageEmbed{failEmbed},
			Components: &[]discordgo.MessageComponent{row},
		})
		return
	}
	embed := embedForSource(source, ms)
	if embed == nil {
		return
	}
	row := buildActionRow(source)
	if _, err := s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
		Embeds:     &[]*discordgo.MessageEmbed{embed},
		Components: &[]discordgo.MessageComponent{row},
	}); err != nil {
		log.Printf("InteractionResponseEdit error (%s/%s): %v", "refresh-or-nav", source, err)
	}
}

func handleCopyRaw(s *discordgo.Session, i *discordgo.InteractionCreate, source string) {
	raw, err := os.ReadFile(statusCachePath)
	if err != nil {
		_ = s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseChannelMessageWithSource,
			Data: &discordgo.InteractionResponseData{
				Content: "❌ Could not read cache file.",
				Flags:   discordgo.MessageFlagsEphemeral,
			},
		})
		return
	}
	slice, err := rawSliceFor(source, raw)
	if err != nil {
		slice = raw
	}
	body := string(slice)
	truncated := ""
	if len(body) > maxRawLen {
		body = body[:maxRawLen]
		truncated = "\n… (truncated)"
	}
	content := "```json\n" + body + "\n```" + truncated
	if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Content: content,
			Flags:   discordgo.MessageFlagsEphemeral,
		},
	}); err != nil {
		log.Printf("InteractionRespond error (raw %s): %v", source, err)
	}
}
```

Then update the existing `handleComponent` function to consult the new dispatcher first, falling through to the existing reboot handling:

```go
func handleComponent(s *discordgo.Session, i *discordgo.InteractionCreate) {
	if dispatchQmComponent(s, i) {
		return
	}
	switch i.MessageComponentData().CustomID {
	case "reboot_confirm":
		// existing reboot_confirm body unchanged
		if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseDeferredMessageUpdate,
		}); err != nil {
			log.Printf("InteractionRespond error (reboot_confirm defer): %v", err)
		}
		_, ok := runQcmd(`AT+QPOWD=1`)
		content := "✅ Reboot command sent. Reconnecting in ~30s..."
		if !ok {
			content = "❌ Reboot command failed. Check modem status."
		}
		disabledRow := discordgo.ActionsRow{
			Components: []discordgo.MessageComponent{
				discordgo.Button{Label: "Confirm Reboot", Style: discordgo.DangerButton, CustomID: "reboot_confirm", Disabled: true},
				discordgo.Button{Label: "Cancel", Style: discordgo.SecondaryButton, CustomID: "reboot_cancel", Disabled: true},
			},
		}
		_, errEdit := s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
			Content:    &content,
			Components: &[]discordgo.MessageComponent{disabledRow},
		})
		if errEdit != nil {
			log.Printf("InteractionResponseEdit error (reboot_confirm): %v", errEdit)
		}
	case "reboot_cancel":
		// existing reboot_cancel body unchanged
		content := "Reboot cancelled."
		disabledRow := discordgo.ActionsRow{
			Components: []discordgo.MessageComponent{
				discordgo.Button{Label: "Confirm Reboot", Style: discordgo.DangerButton, CustomID: "reboot_confirm", Disabled: true},
				discordgo.Button{Label: "Cancel", Style: discordgo.SecondaryButton, CustomID: "reboot_cancel", Disabled: true},
			},
		}
		if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseUpdateMessage,
			Data: &discordgo.InteractionResponseData{
				Content:    content,
				Components: []discordgo.MessageComponent{disabledRow},
			},
		}); err != nil {
			log.Printf("InteractionRespond error (reboot_cancel): %v", err)
		}
	}
}
```

Update the existing query handlers (`handleSignal`, `handleBands`, `handleStatus`, `handleEvents`) to call `respondEmbedWithButtons` instead of `respondEmbed`. Replace each handler body:

```go
func handleSignal(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ms, err := readStatus(statusCachePath)
	if err != nil {
		respondError(s, i, "Could not read modem status cache.")
		return
	}
	respondEmbedWithButtons(s, i, buildSignalEmbed(ms), "signal")
}

func handleBands(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ms, err := readStatus(statusCachePath)
	if err != nil {
		respondError(s, i, "Could not read modem status cache.")
		return
	}
	respondEmbedWithButtons(s, i, buildBandsEmbed(ms), "bands")
}

func handleStatus(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ms, err := readStatus(statusCachePath)
	if err != nil {
		respondError(s, i, "Could not read modem status cache.")
		return
	}
	respondEmbedWithButtons(s, i, buildStatusEmbed(ms), "status")
}

func handleEvents(s *discordgo.Session, i *discordgo.InteractionCreate) {
	events, err := readEvents(eventsCachePath)
	if err != nil {
		log.Printf("readEvents error: %v", err)
		events = []Event{}
	}
	crit, warn, info, total, _ := readEventCounts(eventsCachePath)
	respondEmbedWithButtons(s, i, buildEventsEmbed(events, crit, warn, info, total), "events")
}
```

The old `respondEmbed` function can stay (used by `respondError` paths and not in the way) — leave it for now.

**Important:** This task references `buildDeviceEmbed`, `buildSimEmbed`, `buildWatchcatEmbed` from `embedForSource`. Those don't exist yet. Add temporary stubs at the bottom of `handlers.go` to keep the build green:

```go
// Stub implementations — replaced in Tasks 11/12/13.
func buildDeviceEmbed(s *ModemStatus) *discordgo.MessageEmbed {
	return &discordgo.MessageEmbed{Title: "Device Info", Description: "stub"}
}
func buildSimEmbed(s *ModemStatus) *discordgo.MessageEmbed {
	return &discordgo.MessageEmbed{Title: "SIM Details", Description: "stub"}
}
func buildWatchcatEmbed(s *ModemStatus) *discordgo.MessageEmbed {
	return &discordgo.MessageEmbed{Title: "Watchcat Status", Description: "stub"}
}
```

- [ ] **Step 4: Run the dispatcher tests**

Run: `cd discord-bot && go test -run "TestEmbedForSource|TestRawSliceFor" ./...`
Expected: PASS for all cases.

- [ ] **Step 5: Run full suite**

Run: `cd discord-bot && go test ./...`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add discord-bot/handlers.go discord-bot/handlers_test.go
git commit -m "feat(discord-bot): qm: component dispatcher + button-row wire-up

dispatchQmComponent parses qm:<action>:<source> custom IDs and routes
Refresh, cross-jump nav (handled identically — both rebuild from
fresh cache), and Copy raw clicks. handleCopyRaw sends an ephemeral
follow-up containing a JSON slice scoped to the source command.
respondEmbedWithButtons attaches the action row and schedules the
14-min auto-disable timer. Existing handlers updated to use it.
Stubs added for /device, /sim, /watchcat (filled in Tasks 11-13)."
```

---

## Task 11: `/device` command

**Files:**
- Modify: `discord-bot/handlers.go`
- Modify: `discord-bot/commands.go`
- Modify: `discord-bot/handlers_test.go`

- [ ] **Step 1: Write the failing test**

Append to `discord-bot/handlers_test.go`:

```go
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
```

- [ ] **Step 2: Run the test**

Run: `cd discord-bot && go test -run TestBuildDeviceEmbed ./...`
Expected: FAIL — current `buildDeviceEmbed` is a stub.

- [ ] **Step 3: Replace the stub with a real `buildDeviceEmbed` and add `handleDevice`**

Replace the `buildDeviceEmbed` stub in `discord-bot/handlers.go` with:

```go
func buildDeviceEmbed(s *ModemStatus) *discordgo.MessageEmbed {
	descr := strings.TrimSpace(strings.Join([]string{s.Model, s.Firmware, "Cat " + s.LteCategory}, " · "))
	if s.LteCategory == "" {
		descr = strings.TrimSpace(strings.Join([]string{s.Model, s.Firmware}, " · "))
	}
	fields := []*discordgo.MessageEmbedField{
		{Name: "📦 Model", Value: ifEmpty(s.Model, "—"), Inline: true},
		{Name: "🏭 Manufacturer", Value: ifEmpty(s.Manufacturer, "—"), Inline: true},
		{Name: "🔢 IMEI", Value: ifEmpty(s.IMEI, "—"), Inline: true},
		{Name: "💾 Firmware", Value: ifEmpty(s.Firmware, "—"), Inline: true},
		{Name: "📅 Build date", Value: ifEmpty(s.BuildDate, "—"), Inline: true},
		{Name: "🛜 MIMO config", Value: ifEmpty(s.MIMO, "—"), Inline: true},
		{Name: "📡 Supported LTE bands", Value: ifEmpty(s.SupportedLteBands, "—"), Inline: false},
		{Name: "📡 Supported NR (NSA)", Value: ifEmpty(s.SupportedNsaBands, "—"), Inline: false},
		{Name: "📡 Supported NR (SA)", Value: ifEmpty(s.SupportedSaBands, "—"), Inline: false},
	}
	return &discordgo.MessageEmbed{
		Author:      authorBlock(s),
		Title:       "Device Info",
		Description: descr,
		Color:       embedColor(s),
		Fields:      fields,
		Footer:      footerBlock(s),
		Timestamp:   time.Unix(s.CacheTime, 0).Format(time.RFC3339),
	}
}

func handleDevice(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ms, err := readStatus(statusCachePath)
	if err != nil {
		respondError(s, i, "Could not read modem status cache.")
		return
	}
	respondEmbedWithButtons(s, i, buildDeviceEmbed(ms), "device")
}
```

Add `"device"` routing to `handleCommand`:

```go
func handleCommand(s *discordgo.Session, i *discordgo.InteractionCreate) {
	name := i.ApplicationCommandData().Name
	switch name {
	case "signal":
		handleSignal(s, i)
	case "bands":
		handleBands(s, i)
	case "status":
		handleStatus(s, i)
	case "events":
		handleEvents(s, i)
	case "device":
		handleDevice(s, i)
	case "sim":
		handleSim(s, i)
	case "watchcat":
		handleWatchcat(s, i)
	case "reboot":
		handleReboot(s, i)
	case "lock-band":
		handleLockBand(s, i)
	case "network-mode":
		handleNetworkMode(s, i)
	}
}
```

(`handleSim` and `handleWatchcat` are added in Tasks 12-13. Add forward stubs at the bottom of `handlers.go` if the build fails:

```go
func handleSim(s *discordgo.Session, i *discordgo.InteractionCreate)      { respondError(s, i, "stub") }
func handleWatchcat(s *discordgo.Session, i *discordgo.InteractionCreate) { respondError(s, i, "stub") }
```

These will be replaced in Tasks 12-13.)

Register the `/device` slash command in `discord-bot/commands.go` by adding to the slice returned by `slashCommands`:

```go
{Name: "device", Description: "Modem hardware info — model, firmware, IMEI, supported bands"},
```

- [ ] **Step 4: Run tests**

Run: `cd discord-bot && go test -run TestBuildDeviceEmbed ./...`
Expected: PASS.

Run: `cd discord-bot && go test ./...`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add discord-bot/handlers.go discord-bot/commands.go discord-bot/handlers_test.go
git commit -m "feat(discord-bot): /device command for hardware info

Surfaces device.{model, mfr, imei, firmware, build_date, mimo,
lte_category, supported_*_bands} which were previously invisible
from Discord. Pure read embed — no AT command execution."
```

---

## Task 12: `/sim` command (ephemeral)

**Files:**
- Modify: `discord-bot/handlers.go`
- Modify: `discord-bot/commands.go`
- Modify: `discord-bot/handlers_test.go`

- [ ] **Step 1: Write the failing test**

Append to `discord-bot/handlers_test.go`:

```go
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
```

- [ ] **Step 2: Run the test**

Run: `cd discord-bot && go test -run TestBuildSimEmbed ./...`
Expected: FAIL.

- [ ] **Step 3: Replace the stub `buildSimEmbed` and `handleSim`**

Replace the `buildSimEmbed` stub in `discord-bot/handlers.go`:

```go
func buildSimEmbed(s *ModemStatus) *discordgo.MessageEmbed {
	descr := fmt.Sprintf("SIM %s · %s · APN %s",
		ifEmpty(s.SimSlot, "?"), ifEmpty(s.Operator, "?"), ifEmpty(s.APN, "?"))
	fields := []*discordgo.MessageEmbedField{
		{Name: "🎯 Slot", Value: ifEmpty(s.SimSlot, "—"), Inline: true},
		{Name: "📶 Carrier", Value: ifEmpty(s.Operator, "—"), Inline: true},
		{Name: "🌐 APN", Value: ifEmpty(s.APN, "—"), Inline: true},
		{Name: "🔢 ICCID", Value: ifEmpty(s.ICCID, "—"), Inline: true},
		{Name: "🆔 IMSI", Value: ifEmpty(s.IMSI, "—"), Inline: true},
		{Name: "📞 Phone", Value: ifEmpty(s.PhoneNumber, "—"), Inline: true},
	}
	return &discordgo.MessageEmbed{
		Author:      authorBlock(s),
		Title:       "SIM Details",
		Description: descr,
		Color:       embedColor(s),
		Fields:      fields,
		Footer:      footerBlock(s),
		Timestamp:   time.Unix(s.CacheTime, 0).Format(time.RFC3339),
	}
}
```

Replace the stub `handleSim` with the ephemeral handler:

```go
func handleSim(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ms, err := readStatus(statusCachePath)
	if err != nil {
		respondError(s, i, "Could not read modem status cache.")
		return
	}
	respondEmbedEphemeral(s, i, buildSimEmbed(ms), "sim")
}
```

Register the `/sim` slash command in `discord-bot/commands.go`:

```go
{Name: "sim", Description: "SIM details — slot, ICCID, IMSI, phone, APN (private response)"},
```

- [ ] **Step 4: Run tests**

Run: `cd discord-bot && go test -run TestBuildSimEmbed ./...`
Expected: PASS.

Run: `cd discord-bot && go test ./...`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add discord-bot/handlers.go discord-bot/commands.go discord-bot/handlers_test.go
git commit -m "feat(discord-bot): /sim command (ephemeral)

Returns SIM identifiers (ICCID, IMSI, phone) + slot + carrier + APN.
Default response is ephemeral so the data never sits in shared
channel/DM history. Refresh button preserves ephemeral via
discordgo's edit-respects-flag behavior."
```

---

## Task 13: `/watchcat` command

**Files:**
- Modify: `discord-bot/handlers.go`
- Modify: `discord-bot/commands.go`
- Modify: `discord-bot/handlers_test.go`

- [ ] **Step 1: Write the failing test**

Append to `discord-bot/handlers_test.go`:

```go
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
```

- [ ] **Step 2: Run the test**

Run: `cd discord-bot && go test -run TestBuildWatchcatEmbed ./...`
Expected: FAIL.

- [ ] **Step 3: Replace the stub `buildWatchcatEmbed` and `handleWatchcat`**

Replace the `buildWatchcatEmbed` stub in `discord-bot/handlers.go`:

```go
func buildWatchcatEmbed(s *ModemStatus) *discordgo.MessageEmbed {
	state := ifEmpty(s.WatchcatState, "unknown")
	tier := ifEmpty(s.WatchcatTier, "?")
	failures := ifEmpty(s.WatchcatFailures, "0")
	stateEmoji := emoji.Ok
	switch s.WatchcatState {
	case "escalated":
		stateEmoji = emoji.Down
	case "monitoring":
		stateEmoji = emoji.Warn
	}
	descr := fmt.Sprintf("%s Watchcat %s · Tier %s · %s failures",
		stateEmoji, state, tier, failures)

	last := "Never"
	if s.WatchcatLastTime != "" && s.WatchcatLastTime != "0" {
		if ts, err := strconv.ParseInt(s.WatchcatLastTime, 10, 64); err == nil && ts > 0 {
			last = relativeTime(ts)
		}
	}

	fields := []*discordgo.MessageEmbedField{
		{Name: "🛡 Enabled", Value: yesNo(s.WatchcatEnabled), Inline: true},
		{Name: "📊 State", Value: state, Inline: true},
		{Name: "🪜 Current tier", Value: tier, Inline: true},
		{Name: "❌ Failure count", Value: failures, Inline: true},
		{Name: "🔄 Total recoveries", Value: ifEmpty(s.WatchcatTotal, "0"), Inline: true},
		{Name: "⏰ Last recovery", Value: last, Inline: true},
	}
	if s.WatchcatLastTime != "" && s.WatchcatLastTime != "0" && s.WatchcatLastTier != "" {
		fields = append(fields, &discordgo.MessageEmbedField{
			Name: "🪜 Last recovery tier", Value: s.WatchcatLastTier, Inline: false,
		})
	}

	return &discordgo.MessageEmbed{
		Author:      authorBlock(s),
		Title:       "Watchcat Status",
		Description: descr,
		Color:       embedColor(s),
		Fields:      fields,
		Footer:      footerBlock(s),
		Timestamp:   time.Unix(s.CacheTime, 0).Format(time.RFC3339),
	}
}

func yesNo(b string) string {
	if b == "true" {
		return "Yes"
	}
	return "No"
}

func handleWatchcat(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ms, err := readStatus(statusCachePath)
	if err != nil {
		respondError(s, i, "Could not read modem status cache.")
		return
	}
	respondEmbedWithButtons(s, i, buildWatchcatEmbed(ms), "watchcat")
}
```

Register the `/watchcat` slash command in `discord-bot/commands.go`:

```go
{Name: "watchcat", Description: "Watchcat recovery system status — current tier, failures, last recovery"},
```

- [ ] **Step 4: Run tests**

Run: `cd discord-bot && go test -run TestBuildWatchcatEmbed ./...`
Expected: PASS for both cases.

Run: `cd discord-bot && go test ./...`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add discord-bot/handlers.go discord-bot/commands.go discord-bot/handlers_test.go
git commit -m "feat(discord-bot): /watchcat command for recovery system status

Surfaces watchcat.{enabled, state, current_tier, failure_count,
total_recoveries, last_recovery_time, last_recovery_tier}. State emoji
in pill row reflects severity (idle=green, monitoring=yellow,
escalated=red). Last recovery rendered as relative time, or 'Never'
when unset."
```

---

## Task 14: Final wiring + manual smoke test

**Files:**
- Modify: `discord-bot/main.go` (only if command registration needs explicit re-register hook — likely no change)

- [ ] **Step 1: Verify command registration path**

Read `discord-bot/main.go` and `discord-bot/session.go` to confirm `registerCommands` is called at startup and will pick up the new entries automatically.

Run: `grep -n registerCommands discord-bot/*.go`
Expected: One call site in `session.go` or `main.go` that iterates `slashCommands()`. No code change needed if so.

- [ ] **Step 2: Build the binary**

Run: `cd discord-bot && GOOS=linux GOARCH=arm GOARM=7 go build -o ../scripts/usr/bin/qmanager_discord .`
Expected: Build succeeds with no errors. Binary lands in the install path.

- [ ] **Step 3: Run the full test suite one more time**

Run: `cd discord-bot && go test -v ./...`
Expected: All tests PASS.

- [ ] **Step 4: Commit the binary (if the project tracks it)**

Check whether `scripts/usr/bin/qmanager_discord` is in `.gitignore`:

```bash
git check-ignore scripts/usr/bin/qmanager_discord
```

If gitignored: skip. If tracked: commit it:

```bash
git add scripts/usr/bin/qmanager_discord
git commit -m "build(discord-bot): rebuild ARMv7 binary with rich embeds + new commands"
```

- [ ] **Step 5: Manual smoke test on device (deferred — separate validation step)**

Out of scope for the plan execution itself. After plan completion, the user will:
1. Deploy the new binary to a test RM520N-GL.
2. Restart `qmanager-discord.service`.
3. In Discord, run each command: `/signal`, `/bands`, `/status`, `/events`, `/device`, `/sim`, `/watchcat`.
4. Click each button on each embed to verify Refresh / cross-jump / Copy raw work.
5. Wait 14 minutes and confirm a previous embed's buttons disable themselves with the "expired" notice.

If any step fails, record the issue and add a follow-up task or fix in place — do not silently leave failures.

---

## Self-Review

**Spec coverage check:**

| Spec section | Implemented in |
|---|---|
| §1 Shared chrome (author, pill row, sidebar, emoji, footer, timestamp) | Tasks 3, 4, 5 |
| §2 /bands hybrid layout (description + per-CC cards + serving cell + TAC + edge cases) | Task 6 |
| §3 /signal pill row + per-port emoji + provenance | Task 7 |
| §4 /status connectivity-first + watchcat + SCC handoffs + traffic | Task 8 |
| §5 /events severity badge + worst-color | Task 9 |
| §6 Action button mechanics (Refresh / nav / raw + auto-disable + 5-button constraint) | Tasks 4, 5, 10 |
| §7 /device | Task 11 |
| §7 /sim (ephemeral) | Task 12 |
| §7 /watchcat | Task 13 |
| Data model: pollerCache extensions + CarrierComponent | Task 1 |
| readEventCounts | Task 2 |
| Test coverage requirements | Tests embedded in every task |

**Placeholder scan:** All steps contain concrete code or commands. No "TBD", "implement later", "similar to Task N", or vague "add error handling" steps.

**Type consistency:**
- `ModemStatus` field names used in tests match those defined in Task 1 (`TotalBandwidthMHz`, `CarrierComponents`, `LteCellID`, `NrCellID`, `LteTAC`, `NrTAC`, `ConnJitter`, `PingTarget`, `Model`, `Firmware`, `IMEI`, `MIMO`, `RxRate`, `TxRate`, `WatchcatState`, `WatchcatTier`, `WatchcatTotal`, `ConnUptime`, `WatchcatEnabled`, `WatchcatFailures`, `WatchcatLastTime`, `WatchcatLastTier`, `APN`, `ICCID`, `IMSI`, `PhoneNumber`, `LteCategory`, `SupportedLteBands`, `SupportedNsaBands`, `SupportedSaBands`, `Manufacturer`, `BuildDate`, `CpuUsage`, `MemUsedMB`, `MemTotalMB`).
- `CarrierComponent` field names consistent (Type, Technology, Band, EARFCN, BandwidthMHz, PCI, RSRP, RSRQ, RSSI, SINR).
- Function signatures stable: `buildEventsEmbed(events []Event, crit, warn, info, total int)` — declared in Task 9, called in Tasks 9 + 10's updated `handleEvents`.
- Custom IDs follow `qm:<action>:<source>` everywhere.
- Source string vocabulary fixed: `signal`, `bands`, `status`, `events`, `device`, `sim`, `watchcat`.

No issues found.

