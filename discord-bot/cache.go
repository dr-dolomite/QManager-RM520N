package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"time"
)

const staleSecs = 30

// ModemStatus is the flat shape consumed by the embed builders.
// It is populated from the nested pollerCache returned by readStatus.
// Numeric fields from the poller are converted to strings so the embed
// builders can use ifEmpty/format directly without per-field nil handling.
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
	Uptime            string
	ConnUptime        string
	CpuTemp           string
	CpuUsage          string
	MemUsedMB         string
	MemTotalMB        string
	Model             string
	Manufacturer      string
	Firmware          string
	BuildDate         string
	IMEI              string
	IMSI              string
	ICCID             string
	PhoneNumber       string
	LteCategory       string
	MIMO              string
	SupportedLteBands string
	SupportedNsaBands string
	SupportedSaBands  string

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

type AntennaSignal struct {
	RSRP string
	RSRQ string
	SINR string
	RSSI string
}

func (s *ModemStatus) IsStale() bool {
	return time.Now().Unix()-s.CacheTime > staleSecs
}

// pollerCache mirrors the actual /tmp/qmanager_status.json schema written
// by qmanager_poller. Pointer types let us distinguish unset (null) from zero.
type pollerCache struct {
	Timestamp          int64          `json:"timestamp"`
	ModemReachable     bool           `json:"modem_reachable"`
	LastSuccessfulPoll int64          `json:"last_successful_poll"`
	Network            pollerNetwork  `json:"network"`
	LTE                pollerRadio    `json:"lte"`
	NR                 pollerRadio    `json:"nr"`
	SignalPerAntenna   pollerAntennas `json:"signal_per_antenna"`
	Device             pollerDevice   `json:"device"`
	Connectivity       pollerConn     `json:"connectivity"`
	Watchcat           pollerWatchcat `json:"watchcat"`
}

type pollerNetwork struct {
	Type              string                   `json:"type"`
	Carrier           string                   `json:"carrier"`
	SimSlot           *int                     `json:"sim_slot"`
	ServiceStatus     string                   `json:"service_status"`
	CaActive          bool                     `json:"ca_active"`
	CaCount           *int                     `json:"ca_count"`
	NrCaActive        bool                     `json:"nr_ca_active"`
	NrCaCount         *int                     `json:"nr_ca_count"`
	TotalBandwidthMHz *int                     `json:"total_bandwidth_mhz"`
	BandwidthDetails  string                   `json:"bandwidth_details"`
	CarrierComponents []pollerCarrierComponent `json:"carrier_components"`
	APN               string                   `json:"apn"`
	WanIPv4           string                   `json:"wan_ipv4"`
}

type pollerRadio struct {
	State     string      `json:"state"`
	Band      string      `json:"band"`
	EARFCN    *int        `json:"earfcn"`
	ARFCN     *int        `json:"arfcn"`
	PCI       *int        `json:"pci"`
	CellID    stringOrNum `json:"cell_id"`
	TAC       stringOrNum `json:"tac"`
	Bandwidth *int        `json:"bandwidth"`
}

// stringOrNum decodes a JSON value that the poller may emit as either a quoted
// string or a bare number (e.g. cell_id, tac). JSON null decodes to "".
type stringOrNum string

func (s *stringOrNum) UnmarshalJSON(data []byte) error {
	if len(data) == 0 || string(data) == "null" {
		*s = ""
		return nil
	}
	if data[0] == '"' {
		var str string
		if err := json.Unmarshal(data, &str); err != nil {
			return err
		}
		*s = stringOrNum(str)
		return nil
	}
	*s = stringOrNum(string(data))
	return nil
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

type pollerAntennas struct {
	LteRSRP []*float64 `json:"lte_rsrp"`
	LteRSRQ []*float64 `json:"lte_rsrq"`
	LteSINR []*float64 `json:"lte_sinr"`
	NrRSRP  []*float64 `json:"nr_rsrp"`
	NrRSRQ  []*float64 `json:"nr_rsrq"`
	NrSINR  []*float64 `json:"nr_sinr"`
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

type pollerWatchcat struct {
	Enabled          bool   `json:"enabled"`
	State            string `json:"state"`
	CurrentTier      *int   `json:"current_tier"`
	FailureCount     *int   `json:"failure_count"`
	LastRecoveryTime *int64 `json:"last_recovery_time"`
	LastRecoveryTier *int   `json:"last_recovery_tier"`
	TotalRecoveries  *int   `json:"total_recoveries"`
}

type Event struct {
	Timestamp int64  `json:"timestamp"`
	Type      string `json:"type"`
	Message   string `json:"message"`
	Severity  string `json:"severity"`
}

func readStatus(path string) (*ModemStatus, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var p pollerCache
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, err
	}
	return mapPollerToStatus(&p), nil
}

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
		LteCellID:             string(p.LTE.CellID),
		LteTAC:                string(p.LTE.TAC),
		NrBand:                p.NR.Band,
		NrState:               p.NR.State,
		NrCellID:              string(p.NR.CellID),
		NrTAC:                 string(p.NR.TAC),
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

// buildAntennaMap converts the poller's parallel arrays
// (lte_rsrp[4], nr_rsrp[4], etc.) into a per-port map.
// Prefers NR values when an NR connection is active, falls back to LTE.
// RSSI is not exposed by the poller, so it stays empty.
func buildAntennaMap(a *pollerAntennas, preferNR bool) map[string]AntennaSignal {
	ports := []string{"main", "diversity", "mimo3", "mimo4"}
	m := make(map[string]AntennaSignal, 4)
	for i, port := range ports {
		var rsrp, rsrq, sinr *float64
		if preferNR {
			rsrp = atIdx(a.NrRSRP, i)
			rsrq = atIdx(a.NrRSRQ, i)
			sinr = atIdx(a.NrSINR, i)
		}
		if rsrp == nil {
			rsrp = atIdx(a.LteRSRP, i)
		}
		if rsrq == nil {
			rsrq = atIdx(a.LteRSRQ, i)
		}
		if sinr == nil {
			sinr = atIdx(a.LteSINR, i)
		}
		if rsrp == nil && rsrq == nil && sinr == nil {
			continue
		}
		m[port] = AntennaSignal{
			RSRP: floatPtrFmt(rsrp, "%.0f"),
			RSRQ: floatPtrFmt(rsrq, "%.0f"),
			SINR: floatPtrFmt(sinr, "%.1f"),
			RSSI: "",
		}
	}
	return m
}

func atIdx(arr []*float64, i int) *float64 {
	if i < 0 || i >= len(arr) {
		return nil
	}
	return arr[i]
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

func boolPtrStr(b *bool) string {
	if b == nil {
		return ""
	}
	return boolStr(*b)
}

func intPtrStr(i *int) string {
	if i == nil {
		return ""
	}
	return fmt.Sprintf("%d", *i)
}

func floatPtrFmt(f *float64, format string) string {
	if f == nil {
		return ""
	}
	return fmt.Sprintf(format, *f)
}

// uptimeStr renders seconds as "Xd Yh Zm" or shorter for sub-day uptimes.
func uptimeStr(secs *int64) string {
	if secs == nil || *secs <= 0 {
		return ""
	}
	s := *secs
	d := s / 86400
	h := (s % 86400) / 3600
	m := (s % 3600) / 60
	if d > 0 {
		return fmt.Sprintf("%dd %dh %dm", d, h, m)
	}
	if h > 0 {
		return fmt.Sprintf("%dh %dm", h, m)
	}
	return fmt.Sprintf("%dm", m)
}

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

// readEvents returns the last 5 events from the NDJSON events file.
func readEvents(path string) ([]Event, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var all []Event
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		var ev Event
		if json.Unmarshal(line, &ev) == nil {
			all = append(all, ev)
		}
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	if len(all) <= 5 {
		return all, nil
	}
	return all[len(all)-5:], nil
}
