package main

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

func writeTempJSON(t *testing.T, v any) string {
	t.Helper()
	f, err := os.CreateTemp("", "cache*.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.NewEncoder(f).Encode(v); err != nil {
		t.Fatal(err)
	}
	f.Close()
	return f.Name()
}

func TestReadStatus_AllFields(t *testing.T) {
	path := writeTempJSON(t, map[string]any{
		"timestamp":       time.Now().Unix(),
		"modem_reachable": true,
		"network": map[string]any{
			"type":         "5G-NSA",
			"carrier":      "SMART",
			"sim_slot":     1,
			"ca_active":    true,
			"ca_count":     2,
			"nr_ca_active": false,
			"wan_ipv4":     "10.0.0.1",
		},
		"lte": map[string]any{"state": "connected", "band": "B3"},
		"nr":  map[string]any{"state": "connected", "band": "n78"},
		"connectivity": map[string]any{
			"internet_available": true,
			"latency_ms":         15.4,
		},
		"signal_per_antenna": map[string]any{
			"nr_rsrp": []any{-95, -97, -99, -101},
			"nr_rsrq": []any{-10, -10, -11, -11},
			"nr_sinr": []any{15.5, 14.0, 12.0, 10.0},
		},
	})
	defer os.Remove(path)

	s, err := readStatus(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if s.ConnInternetAvailable != "true" {
		t.Errorf("ConnInternetAvailable=%q, want true", s.ConnInternetAvailable)
	}
	if s.NetworkType != "5G-NSA" {
		t.Errorf("NetworkType=%q, want 5G-NSA", s.NetworkType)
	}
	if s.Operator != "SMART" {
		t.Errorf("Operator=%q, want SMART", s.Operator)
	}
	if s.LteBand != "B3" {
		t.Errorf("LteBand=%q, want B3", s.LteBand)
	}
	if s.NrBand != "n78" {
		t.Errorf("NrBand=%q, want n78", s.NrBand)
	}
	if s.WanIP != "10.0.0.1" {
		t.Errorf("WanIP=%q, want 10.0.0.1", s.WanIP)
	}
	if s.CaActive != "true" {
		t.Errorf("CaActive=%q, want true", s.CaActive)
	}
	if s.CaCount != "2" {
		t.Errorf("CaCount=%q, want 2", s.CaCount)
	}
	if s.ConnLatency != "15" {
		t.Errorf("ConnLatency=%q, want 15", s.ConnLatency)
	}
	main, ok := s.SignalPerAntenna["main"]
	if !ok {
		t.Fatal("expected main antenna in signal map")
	}
	if main.RSRP != "-95" {
		t.Errorf("main.RSRP=%q, want -95", main.RSRP)
	}
}

func TestReadStatus_Stale(t *testing.T) {
	path := writeTempJSON(t, map[string]any{
		"timestamp": time.Now().Unix() - 60,
	})
	defer os.Remove(path)

	s, _ := readStatus(path)
	if !s.IsStale() {
		t.Error("expected cache to be stale")
	}
}

func TestReadStatus_MissingFile(t *testing.T) {
	_, err := readStatus("/nonexistent/qmanager_status.json")
	if err == nil {
		t.Fatal("expected error for missing file, got nil")
	}
}

func TestReadStatus_NewPollerFields(t *testing.T) {
	path := writeTempJSON(t, map[string]any{
		"timestamp":       time.Now().Unix(),
		"modem_reachable": true,
		"network": map[string]any{
			"type":                "5G-NSA",
			"carrier":             "VZW",
			"sim_slot":            1,
			"ca_active":           true,
			"ca_count":            2,
			"nr_ca_active":        true,
			"nr_ca_count":         1,
			"total_bandwidth_mhz": 100,
			"bandwidth_details":   "B3: 20 MHz + B7: 20 MHz + n78: 60 MHz",
			"apn":                 "internet",
			"wan_ipv4":            "10.0.0.1",
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
			"temperature":              47.3,
			"cpu_usage":                41,
			"memory_used_mb":           312,
			"memory_total_mb":          512,
			"uptime_seconds":           200000,
			"conn_uptime_seconds":      15000,
			"firmware":                 "RM520NGLAAR03A05M4G",
			"build_date":               "20240115",
			"manufacturer":             "Quectel",
			"model":                    "RM520N-GL",
			"imei":                     "861234567890123",
			"imsi":                     "311480123456789",
			"iccid":                    "8914800000123456789",
			"phone_number":             "+15551234567",
			"lte_category":             "20",
			"mimo":                     "4x4",
			"supported_lte_bands":      "1,2,3,4,5,7,8,12,13,14,17,18,19,20,25,26,28,29,30,32,34,38,39,40,41,42,43,46,48,66,71",
			"supported_nsa_nr5g_bands": "1,2,3,5,7,8,12,20,25,28,38,40,41,48,66,71,77,78",
			"supported_sa_nr5g_bands":  "1,2,3,5,7,8,12,20,25,28,38,40,41,48,66,71,77,78,79",
		},
		"watchcat": map[string]any{
			"enabled":            true,
			"state":              "monitoring",
			"current_tier":       2,
			"failure_count":      3,
			"last_recovery_time": 1714000000,
			"last_recovery_tier": 3,
			"total_recoveries":   5,
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

func TestReadEvents_ReturnsLast5(t *testing.T) {
	f, _ := os.CreateTemp("", "events*.json")
	defer os.Remove(f.Name())
	for i := 0; i < 8; i++ {
		json.NewEncoder(f).Encode(Event{
			Timestamp: int64(1000 + i),
			Type:      "test",
			Message:   "msg",
			Severity:  "info",
		})
	}
	f.Close()

	events, err := readEvents(f.Name())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(events) != 5 {
		t.Errorf("got %d events, want 5", len(events))
	}
	if events[0].Timestamp != 1003 {
		t.Errorf("first event timestamp=%d, want 1003", events[0].Timestamp)
	}
}
