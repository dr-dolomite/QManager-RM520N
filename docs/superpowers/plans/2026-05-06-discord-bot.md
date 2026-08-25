# Discord Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a personal Discord bot that runs on the RM520N-GL as a static Go binary, giving users slash commands for modem queries and set operations via DMs, plus automated connectivity notifications.

**Architecture:** A static ARMv7l Go binary (`qmanager_discord`) connects to Discord's WebSocket gateway using `discordgo`. It reads the poller's existing `/tmp/qmanager_status.json` cache for all query commands, calls `/usr/bin/qcmd` as a subprocess for set operations, and runs a background goroutine for connectivity notifications. A shell CGI layer handles configuration from the web UI.

**Tech Stack:** Go + `github.com/bwmarrin/discordgo`, cross-compiled `GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0`. Frontend: React hooks + TypeScript matching existing `use-email-alerts.ts` pattern.

---

## File Map

**New — Go source (`discord-bot/`):**
- `discord-bot/go.mod` — module `qmanager-discord`, requires `discordgo`
- `discord-bot/config.go` — `Config` struct, `loadConfig()`, `writeStatus()`
- `discord-bot/cache.go` — `ModemStatus` + `Event` structs, `readStatus()`, `readEvents()`
- `discord-bot/session.go` — Discord session init, DM channel bootstrap, app ID extraction
- `discord-bot/commands.go` — slash command definitions + `registerCommands()`
- `discord-bot/handlers.go` — all interaction handlers (read + set + button)
- `discord-bot/notify.go` — connectivity notification goroutine
- `discord-bot/main.go` — entry point, goroutine orchestration, reload loop, graceful shutdown

**New — Shell:**
- `scripts/etc/systemd/system/qmanager-discord.service`
- `scripts/usr/lib/qmanager/discord_alerts.sh` — CGI helper: send test DM, read log
- `scripts/www/cgi-bin/quecmanager/monitoring/discord_bot/configure.sh` — GET/POST config
- `scripts/www/cgi-bin/quecmanager/monitoring/discord_bot/status.sh` — GET runtime status
- `scripts/www/cgi-bin/quecmanager/monitoring/discord_bot/test.sh` — POST send test DM
- `scripts/www/cgi-bin/quecmanager/monitoring/discord_bot/alert_log.sh` — GET notification log

**New — Frontend:**
- `types/discord-bot.ts` — TypeScript types
- `hooks/use-discord-bot.ts` — settings + status hook (matches `use-email-alerts.ts` pattern)
- `components/monitoring/discord-bot-card.tsx` — setup wizard + status card

**Modified:**
- `qmanager-installer.sh` — deploy binary to `/usr/bin/qmanager_discord`, enable service
- `scripts/usr/bin/qmanager_update` — add `qmanager_discord` to binary cleanup list

---

## Task 1: Go module + config + status writer

**Files:**
- Create: `discord-bot/go.mod`
- Create: `discord-bot/config.go`
- Create: `discord-bot/config_test.go`

- [ ] **Step 1: Create Go module**

```
mkdir discord-bot
```

`discord-bot/go.mod`:
```
module qmanager-discord

go 1.21

require github.com/bwmarrin/discordgo v0.28.1

require (
	github.com/gorilla/websocket v1.4.2 // indirect
	golang.org/x/crypto v0.17.0 // indirect
	golang.org/x/sys v0.15.0 // indirect
)
```

Run from `discord-bot/`:
```bash
go mod tidy
```

- [ ] **Step 2: Write failing tests for config loading and status writing**

`discord-bot/config_test.go`:
```go
package main

import (
	"encoding/json"
	"os"
	"testing"
)

func TestLoadConfig_ValidFile(t *testing.T) {
	f, _ := os.CreateTemp("", "discord_cfg*.json")
	defer os.Remove(f.Name())
	json.NewEncoder(f).Encode(Config{
		Enabled:          true,
		BotToken:         "tok",
		OwnerDiscordID:   "123",
		ThresholdMinutes: 10,
	})
	f.Close()

	cfg, err := loadConfig(f.Name())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.BotToken != "tok" {
		t.Errorf("got BotToken %q, want %q", cfg.BotToken, "tok")
	}
	if cfg.ThresholdMinutes != 10 {
		t.Errorf("got ThresholdMinutes %d, want 10", cfg.ThresholdMinutes)
	}
}

func TestLoadConfig_DefaultThreshold(t *testing.T) {
	f, _ := os.CreateTemp("", "discord_cfg*.json")
	defer os.Remove(f.Name())
	f.WriteString(`{"enabled":true,"bot_token":"x","owner_discord_id":"1"}`)
	f.Close()

	cfg, err := loadConfig(f.Name())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.ThresholdMinutes != 5 {
		t.Errorf("got ThresholdMinutes %d, want 5 (default)", cfg.ThresholdMinutes)
	}
}

func TestLoadConfig_MissingFile(t *testing.T) {
	_, err := loadConfig("/nonexistent/path.json")
	if err == nil {
		t.Fatal("expected error for missing file, got nil")
	}
}

func TestWriteStatus(t *testing.T) {
	f, _ := os.CreateTemp("", "discord_status*.json")
	path := f.Name()
	f.Close()
	defer os.Remove(path)

	writeStatus(path, BotStatus{Connected: true, LatencyMs: 42, Error: ""})

	data, _ := os.ReadFile(path)
	var got BotStatus
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if !got.Connected {
		t.Error("expected Connected=true")
	}
	if got.LatencyMs != 42 {
		t.Errorf("got LatencyMs %d, want 42", got.LatencyMs)
	}
}
```

- [ ] **Step 3: Run tests — expect compile failure**

```bash
cd discord-bot && go test ./... 2>&1 | head -20
```
Expected: `undefined: Config`, `undefined: loadConfig`, `undefined: BotStatus`, `undefined: writeStatus`

- [ ] **Step 4: Implement config.go**

`discord-bot/config.go`:
```go
package main

import (
	"encoding/json"
	"os"
	"time"
)

const (
	configPath     = "/etc/qmanager/discord_bot.json"
	statusPath     = "/tmp/qmanager_discord_status.json"
	reloadFlagPath = "/tmp/qmanager_discord_reload"
	logPath        = "/tmp/qmanager_discord_log.json"
	maxLogEntries  = 100
)

type Config struct {
	Enabled          bool   `json:"enabled"`
	BotToken         string `json:"bot_token"`
	OwnerDiscordID   string `json:"owner_discord_id"`
	ThresholdMinutes int    `json:"threshold_minutes"`
}

type BotStatus struct {
	Connected bool   `json:"connected"`
	LastSeen  int64  `json:"last_seen"`
	LatencyMs int    `json:"latency_ms"`
	Error     string `json:"error,omitempty"`
}

func loadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	if cfg.ThresholdMinutes <= 0 {
		cfg.ThresholdMinutes = 5
	}
	return &cfg, nil
}

func writeStatus(path string, s BotStatus) {
	s.LastSeen = time.Now().Unix()
	tmp := path + ".tmp"
	data, err := json.Marshal(s)
	if err != nil {
		return
	}
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return
	}
	os.Rename(tmp, path)
}

func checkReloadFlag() bool {
	if _, err := os.Stat(reloadFlagPath); err != nil {
		return false
	}
	os.Remove(reloadFlagPath)
	return true
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd discord-bot && go test ./... -run TestLoadConfig -run TestWriteStatus -v
```
Expected: `PASS`

- [ ] **Step 6: Commit**

```bash
git add discord-bot/go.mod discord-bot/go.sum discord-bot/config.go discord-bot/config_test.go
git commit -m "feat(discord-bot): Go module + config loading + status writer"
```

---

## Task 2: Cache reader

**Files:**
- Create: `discord-bot/cache.go`
- Create: `discord-bot/cache_test.go`

- [ ] **Step 1: Write failing tests**

`discord-bot/cache_test.go`:
```go
package main

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

func writeTempJSON(t *testing.T, v any) string {
	t.Helper()
	f, _ := os.CreateTemp("", "cache*.json")
	json.NewEncoder(f).Encode(v)
	f.Close()
	return f.Name()
}

func TestReadStatus_AllFields(t *testing.T) {
	path := writeTempJSON(t, map[string]any{
		"conn_internet_available": "true",
		"conn_latency":            "15",
		"modem_reachable":         "true",
		"network_type":            "NR5G-NSA",
		"cache_time":              time.Now().Unix(),
	})
	defer os.Remove(path)

	s, err := readStatus(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if s.ConnInternetAvailable != "true" {
		t.Errorf("ConnInternetAvailable=%q", s.ConnInternetAvailable)
	}
	if s.NetworkType != "NR5G-NSA" {
		t.Errorf("NetworkType=%q", s.NetworkType)
	}
}

func TestReadStatus_Stale(t *testing.T) {
	path := writeTempJSON(t, map[string]any{
		"cache_time": time.Now().Unix() - 60,
	})
	defer os.Remove(path)

	s, _ := readStatus(path)
	if !s.IsStale() {
		t.Error("expected cache to be stale")
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
	// Should be the last 5 (most recent)
	if events[0].Timestamp != 1003 {
		t.Errorf("first event timestamp=%d, want 1003", events[0].Timestamp)
	}
}
```

- [ ] **Step 2: Run tests — expect compile failure**

```bash
cd discord-bot && go test ./... -run TestReadStatus -run TestReadEvents 2>&1 | head -10
```
Expected: `undefined: readStatus`, `undefined: readEvents`, `undefined: Event`

- [ ] **Step 3: Implement cache.go**

`discord-bot/cache.go`:
```go
package main

import (
	"bufio"
	"encoding/json"
	"os"
	"time"
)

const staleSecs = 30

// ModemStatus mirrors the fields from /tmp/qmanager_status.json written by qmanager_poller.
// Add fields here as needed — verify names against: cat /tmp/qmanager_status.json | jq keys
type ModemStatus struct {
	ConnInternetAvailable string `json:"conn_internet_available"`
	ConnLatency           string `json:"conn_latency"`
	ConnAvgLatency        string `json:"conn_avg_latency"`
	ModemReachable        string `json:"modem_reachable"`
	NetworkType           string `json:"network_type"`
	Operator              string `json:"operator"`
	// Signal per antenna — nested object keyed by port name
	SignalPerAntenna map[string]AntennaSignal `json:"signal_per_antenna"`
	// Band / CA
	LteBand           string `json:"lte_band"`
	NrBand            string `json:"nr_band"`
	NrState           string `json:"nr_state"`
	CaActive          string `json:"t2_ca_active"`
	CaCount           string `json:"t2_ca_count"`
	NrCaActive        string `json:"t2_nr_ca_active"`
	NrCaCount         string `json:"t2_nr_ca_count"`
	CarrierComponents string `json:"t2_carrier_components"`
	// System
	WanIP       string `json:"wan_ip"`
	SimSlot     string `json:"sim_slot"`
	Uptime      string `json:"uptime"`
	CpuTemp     string `json:"cpu_temp"`
	ServiceStatus string `json:"service_status"`
	// Cache metadata
	CacheTime int64 `json:"cache_time"`
}

type AntennaSignal struct {
	RSRP string `json:"rsrp"`
	RSRQ string `json:"rsrq"`
	SINR string `json:"sinr"`
	RSSI string `json:"rssi"`
}

func (s *ModemStatus) IsStale() bool {
	return time.Now().Unix()-s.CacheTime > staleSecs
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
	var s ModemStatus
	if err := json.Unmarshal(data, &s); err != nil {
		return nil, err
	}
	return &s, nil
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
	if len(all) <= 5 {
		return all, nil
	}
	return all[len(all)-5:], nil
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd discord-bot && go test ./... -run TestReadStatus -run TestReadEvents -v
```
Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add discord-bot/cache.go discord-bot/cache_test.go
git commit -m "feat(discord-bot): cache reader for poller status + events"
```

---

## Task 3: Slash command definitions + Discord session bootstrap

**Files:**
- Create: `discord-bot/commands.go`
- Create: `discord-bot/session.go`

- [ ] **Step 1: Write failing test for command definitions**

Add to `discord-bot/config_test.go`:
```go
func TestCommandDefinitions_AllPresent(t *testing.T) {
	names := map[string]bool{}
	for _, cmd := range slashCommands() {
		names[cmd.Name] = true
	}
	required := []string{"signal", "bands", "status", "events", "reboot", "lock-band", "network-mode"}
	for _, r := range required {
		if !names[r] {
			t.Errorf("missing slash command: %s", r)
		}
	}
}
```

- [ ] **Step 2: Run — expect compile failure**

```bash
cd discord-bot && go test ./... -run TestCommandDefinitions 2>&1 | head -5
```
Expected: `undefined: slashCommands`

- [ ] **Step 3: Implement commands.go**

`discord-bot/commands.go`:
```go
package main

import "github.com/bwmarrin/discordgo"

func slashCommands() []*discordgo.ApplicationCommand {
	nr := false // not required
	return []*discordgo.ApplicationCommand{
		{Name: "signal", Description: "RF signal metrics per antenna port (RSRP, RSRQ, SINR, RSSI)"},
		{Name: "bands", Description: "Active technology, band lock state, and carrier aggregation details"},
		{Name: "status", Description: "Connectivity, WAN IP, operator, uptime, and CPU temperature"},
		{Name: "events", Description: "Last 5 network events"},
		{Name: "reboot", Description: "Reboot the modem (requires confirmation)"},
		{
			Name:        "lock-band",
			Description: "Lock LTE and/or NR bands, or unlock all",
			Options: []*discordgo.ApplicationCommandOption{
				{
					Type:        discordgo.ApplicationCommandOptionString,
					Name:        "lte_bands",
					Description: "LTE bands to lock, colon-separated (e.g. B3:B28), or 'auto' to unlock",
					Required:    nr,
				},
				{
					Type:        discordgo.ApplicationCommandOptionString,
					Name:        "nr_bands",
					Description: "NR bands to lock, colon-separated (e.g. n78), or 'auto' to unlock",
					Required:    nr,
				},
			},
		},
		{
			Name:        "network-mode",
			Description: "Set network mode preference",
			Options: []*discordgo.ApplicationCommandOption{
				{
					Type:        discordgo.ApplicationCommandOptionString,
					Name:        "mode",
					Description: "Preferred network mode",
					Required:    true,
					Choices: []*discordgo.ApplicationCommandOptionChoice{
						{Name: "Auto (LTE + NR)", Value: "AUTO"},
						{Name: "LTE only", Value: "LTE"},
						{Name: "NR only", Value: "NR5G"},
						{Name: "NR preferred", Value: "NR5G:LTE"},
					},
				},
			},
		},
	}
}

func registerCommands(s *discordgo.Session, appID string) ([]*discordgo.ApplicationCommand, error) {
	var registered []*discordgo.ApplicationCommand
	for _, cmd := range slashCommands() {
		c, err := s.ApplicationCommandCreate(appID, "", cmd)
		if err != nil {
			return registered, err
		}
		registered = append(registered, c)
	}
	return registered, nil
}
```

- [ ] **Step 4: Implement session.go**

`discord-bot/session.go`:
```go
package main

import (
	"encoding/base64"
	"strings"

	"github.com/bwmarrin/discordgo"
)

// appIDFromToken extracts the Discord application ID from the bot token.
// Discord bot tokens are: base64(app_id) + "." + timestamp + "." + hmac
func appIDFromToken(token string) string {
	parts := strings.SplitN(token, ".", 3)
	if len(parts) == 0 {
		return ""
	}
	// Add padding if needed
	b64 := parts[0]
	for len(b64)%4 != 0 {
		b64 += "="
	}
	decoded, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return ""
	}
	return string(decoded)
}

// openDMChannel creates (or retrieves existing) DM channel with the owner.
// Returns the channel ID for sending notification messages.
func openDMChannel(s *discordgo.Session, ownerID string) (string, error) {
	ch, err := s.UserChannelCreate(ownerID)
	if err != nil {
		return "", err
	}
	return ch.ID, nil
}

func newSession(token string) (*discordgo.Session, error) {
	s, err := discordgo.New("Bot " + token)
	if err != nil {
		return nil, err
	}
	s.Identify.Intents = discordgo.IntentsDirectMessages
	return s, nil
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd discord-bot && go test ./... -run TestCommandDefinitions -v
```
Expected: `PASS`

- [ ] **Step 6: Commit**

```bash
git add discord-bot/commands.go discord-bot/session.go
git commit -m "feat(discord-bot): slash command definitions + session bootstrap"
```

---

## Task 4: Read command handlers (/signal, /bands, /status, /events)

**Files:**
- Create: `discord-bot/handlers.go`
- Create: `discord-bot/handlers_test.go`

- [ ] **Step 1: Write failing tests**

`discord-bot/handlers_test.go`:
```go
package main

import (
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

func TestBuildSignalEmbed_HasTitle(t *testing.T) {
	s := makeStatus("true", "true", "NR5G-NSA")
	embed := buildSignalEmbed(s)
	if embed.Title == "" {
		t.Error("expected non-empty embed title")
	}
}

func TestBuildStatusEmbed_InternetDown(t *testing.T) {
	s := makeStatus("false", "true", "LTE")
	embed := buildStatusEmbed(s)
	found := false
	for _, f := range embed.Fields {
		if f.Name == "Internet" && f.Value != "" {
			found = true
		}
	}
	if !found {
		t.Error("expected Internet field in status embed")
	}
}

func TestBuildEventsEmbed_Empty(t *testing.T) {
	embed := buildEventsEmbed([]Event{})
	if embed.Description == "" {
		t.Error("expected description for empty events")
	}
}

func TestEmbedColorForInternet(t *testing.T) {
	if embedColorForInternet("true") != colorGreen {
		t.Error("expected green for internet=true")
	}
	if embedColorForInternet("false") != colorRed {
		t.Error("expected red for internet=false")
	}
}
```

- [ ] **Step 2: Run — expect compile failure**

```bash
cd discord-bot && go test ./... -run TestBuild -run TestEmbed 2>&1 | head -10
```
Expected: `undefined: buildSignalEmbed`, `undefined: colorGreen`

- [ ] **Step 3: Implement handlers.go (read commands)**

`discord-bot/handlers.go`:
```go
package main

import (
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/bwmarrin/discordgo"
)

const (
	colorGreen  = 0x22c55e
	colorYellow = 0xf59e0b
	colorRed    = 0xef4444
	colorBlue   = 0x3b82f6
	colorGray   = 0x6b7280

	statusCachePath = "/tmp/qmanager_status.json"
	eventsCachePath = "/tmp/qmanager_events.json"
)

func embedColorForInternet(internet string) int {
	switch internet {
	case "true":
		return colorGreen
	case "false":
		return colorRed
	default:
		return colorGray
	}
}

func staleWarning(s *ModemStatus) string {
	if s.IsStale() {
		return "\n⚠ Data may be stale"
	}
	return ""
}

// ─── Embed builders ───────────────────────────────────────────────────────────

func buildSignalEmbed(s *ModemStatus) *discordgo.MessageEmbed {
	var fields []*discordgo.MessageEmbedField
	ports := []string{"main", "diversity", "mimo3", "mimo4"}
	labels := map[string]string{
		"main": "Main (PRX)", "diversity": "Diversity (DRX)",
		"mimo3": "MIMO 3 (RX2)", "mimo4": "MIMO 4 (RX3)",
	}
	for _, port := range ports {
		ant, ok := s.SignalPerAntenna[port]
		if !ok {
			continue
		}
		fields = append(fields, &discordgo.MessageEmbedField{
			Name:   labels[port],
			Value:  fmt.Sprintf("RSRP: %s dBm\nRSRQ: %s dB\nSINR: %s dB\nRSSI: %s dBm", ant.RSRP, ant.RSRQ, ant.SINR, ant.RSSI),
			Inline: true,
		})
	}
	return &discordgo.MessageEmbed{
		Title:  "Signal Metrics",
		Color:  embedColorForInternet(s.ConnInternetAvailable),
		Fields: fields,
		Footer: &discordgo.MessageEmbedFooter{Text: "QManager" + staleWarning(s)},
	}
}

func buildBandsEmbed(s *ModemStatus) *discordgo.MessageEmbed {
	caInfo := "None"
	if s.CaActive == "true" {
		caInfo = fmt.Sprintf("%s component(s)", s.CaCount)
		if s.NrCaActive == "true" {
			caInfo += fmt.Sprintf(" + NR CA (%s)", s.NrCaCount)
		}
	}
	fields := []*discordgo.MessageEmbedField{
		{Name: "Technology", Value: ifEmpty(s.NetworkType, "Unknown"), Inline: true},
		{Name: "LTE Band", Value: ifEmpty(s.LteBand, "—"), Inline: true},
		{Name: "NR Band", Value: ifEmpty(s.NrBand, "—"), Inline: true},
		{Name: "Carrier Aggregation", Value: caInfo, Inline: false},
	}
	return &discordgo.MessageEmbed{
		Title:  "Band Details",
		Color:  colorBlue,
		Fields: fields,
		Footer: &discordgo.MessageEmbedFooter{Text: "QManager" + staleWarning(s)},
	}
}

func buildStatusEmbed(s *ModemStatus) *discordgo.MessageEmbed {
	internet := "Down"
	color := colorRed
	if s.ConnInternetAvailable == "true" {
		internet = fmt.Sprintf("Up (%s ms)", ifEmpty(s.ConnLatency, "?"))
		color = colorGreen
	}
	modem := "Unreachable"
	if s.ModemReachable == "true" {
		modem = "OK"
	}
	fields := []*discordgo.MessageEmbedField{
		{Name: "Internet", Value: internet, Inline: true},
		{Name: "Modem", Value: modem, Inline: true},
		{Name: "Operator", Value: ifEmpty(s.Operator, "Unknown"), Inline: true},
		{Name: "WAN IP", Value: ifEmpty(s.WanIP, "—"), Inline: true},
		{Name: "SIM Slot", Value: ifEmpty(s.SimSlot, "—"), Inline: true},
		{Name: "CPU Temp", Value: ifEmpty(s.CpuTemp, "—"), Inline: true},
		{Name: "Uptime", Value: ifEmpty(s.Uptime, "—"), Inline: false},
	}
	return &discordgo.MessageEmbed{
		Title:  "Modem Status",
		Color:  color,
		Fields: fields,
		Footer: &discordgo.MessageEmbedFooter{Text: "QManager" + staleWarning(s)},
	}
}

func buildEventsEmbed(events []Event) *discordgo.MessageEmbed {
	if len(events) == 0 {
		return &discordgo.MessageEmbed{
			Title:       "Recent Events",
			Description: "No events recorded yet.",
			Color:       colorGray,
		}
	}
	severityIcon := map[string]string{
		"info": "ℹ️", "warning": "⚠️", "critical": "🔴",
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
		Description: strings.Join(lines, "\n"),
		Color:       colorBlue,
		Footer:      &discordgo.MessageEmbedFooter{Text: "QManager"},
	}
}

func ifEmpty(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

// ─── qcmd helper ──────────────────────────────────────────────────────────────

func runQcmd(atCmd string) (string, bool) {
	out, _ := exec.Command("/usr/bin/qcmd", atCmd).CombinedOutput()
	response := strings.TrimSpace(string(out))
	return response, strings.Contains(response, "OK")
}

// ─── Interaction router ────────────────────────────────────────────────────────

func handleInteraction(s *discordgo.Session, i *discordgo.InteractionCreate) {
	switch i.Type {
	case discordgo.InteractionApplicationCommand:
		handleCommand(s, i)
	case discordgo.InteractionMessageComponent:
		handleComponent(s, i)
	}
}

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
	case "reboot":
		handleReboot(s, i)
	case "lock-band":
		handleLockBand(s, i)
	case "network-mode":
		handleNetworkMode(s, i)
	}
}

func respondEmbed(s *discordgo.Session, i *discordgo.InteractionCreate, embed *discordgo.MessageEmbed) {
	s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{Embeds: []*discordgo.MessageEmbed{embed}},
	})
}

func respondError(s *discordgo.Session, i *discordgo.InteractionCreate, msg string) {
	s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{Content: "❌ " + msg},
	})
}

func handleSignal(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ms, err := readStatus(statusCachePath)
	if err != nil {
		respondError(s, i, "Could not read modem status cache.")
		return
	}
	respondEmbed(s, i, buildSignalEmbed(ms))
}

func handleBands(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ms, err := readStatus(statusCachePath)
	if err != nil {
		respondError(s, i, "Could not read modem status cache.")
		return
	}
	respondEmbed(s, i, buildBandsEmbed(ms))
}

func handleStatus(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ms, err := readStatus(statusCachePath)
	if err != nil {
		respondError(s, i, "Could not read modem status cache.")
		return
	}
	respondEmbed(s, i, buildStatusEmbed(ms))
}

func handleEvents(s *discordgo.Session, i *discordgo.InteractionCreate) {
	events, err := readEvents(eventsCachePath)
	if err != nil {
		events = []Event{}
	}
	respondEmbed(s, i, buildEventsEmbed(events))
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd discord-bot && go test ./... -run TestBuild -run TestEmbed -run TestEmbedColor -v
```
Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add discord-bot/handlers.go discord-bot/handlers_test.go
git commit -m "feat(discord-bot): read command handlers and embed builders"
```

---

## Task 5: Set command handlers (/reboot, /lock-band, /network-mode)

**Files:**
- Modify: `discord-bot/handlers.go`

- [ ] **Step 1: Write failing tests**

Add to `discord-bot/handlers_test.go`:
```go
func TestParseBandOption_Strips(t *testing.T) {
	// "B3:B28" -> "3:28" (strip B prefix for AT command)
	got := parseBandOption("B3:B28")
	if got != "3:28" {
		t.Errorf("got %q, want %q", got, "3:28")
	}
}

func TestParseBandOption_Auto(t *testing.T) {
	got := parseBandOption("auto")
	if got != "" {
		t.Errorf("got %q, want empty string for auto", got)
	}
}
```

- [ ] **Step 2: Run — expect compile failure**

```bash
cd discord-bot && go test ./... -run TestParseBand 2>&1 | head -5
```
Expected: `undefined: parseBandOption`

- [ ] **Step 3: Add set command handlers to handlers.go**

Append to `discord-bot/handlers.go`:
```go
// parseBandOption converts user input like "B3:B28" to AT format "3:28".
// Returns empty string for "auto".
func parseBandOption(input string) string {
	if strings.ToLower(strings.TrimSpace(input)) == "auto" {
		return ""
	}
	// Strip B/b prefix from each colon-separated component
	parts := strings.Split(input, ":")
	clean := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		p = strings.TrimPrefix(strings.ToUpper(p), "B")
		if p != "" {
			clean = append(clean, p)
		}
	}
	return strings.Join(clean, ":")
}

func handleReboot(s *discordgo.Session, i *discordgo.InteractionCreate) {
	s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Content: "⚠️ **Reboot the modem?** This will disconnect all clients for ~30 seconds.",
			Components: []discordgo.MessageComponent{
				discordgo.ActionsRow{
					Components: []discordgo.MessageComponent{
						discordgo.Button{
							Label:    "Confirm Reboot",
							Style:    discordgo.DangerButton,
							CustomID: "reboot_confirm",
						},
						discordgo.Button{
							Label:    "Cancel",
							Style:    discordgo.SecondaryButton,
							CustomID: "reboot_cancel",
						},
					},
				},
			},
		},
	})
	// Disable buttons after 30s regardless of outcome
	go func() {
		time.Sleep(30 * time.Second)
		disabledRow := discordgo.ActionsRow{
			Components: []discordgo.MessageComponent{
				discordgo.Button{Label: "Confirm Reboot", Style: discordgo.DangerButton, CustomID: "reboot_confirm", Disabled: true},
				discordgo.Button{Label: "Cancel", Style: discordgo.SecondaryButton, CustomID: "reboot_cancel", Disabled: true},
			},
		}
		content := "⚠️ **Reboot the modem?** *(expired)*"
		s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
			Content:    &content,
			Components: &[]discordgo.MessageComponent{disabledRow},
		})
	}()
}

func handleComponent(s *discordgo.Session, i *discordgo.InteractionCreate) {
	switch i.MessageComponentData().CustomID {
	case "reboot_confirm":
		// Acknowledge immediately — reboot takes time
		s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseDeferredMessageUpdate,
		})
		_, ok := runQcmd(`AT+QPOWD=1`)
		content := "✅ Reboot command sent. Reconnecting in ~30s..."
		if !ok {
			content = "❌ Reboot command failed. Check modem status."
		}
		// Edit original reboot message
		disabledRow := discordgo.ActionsRow{
			Components: []discordgo.MessageComponent{
				discordgo.Button{Label: "Confirm Reboot", Style: discordgo.DangerButton, CustomID: "reboot_confirm", Disabled: true},
				discordgo.Button{Label: "Cancel", Style: discordgo.SecondaryButton, CustomID: "reboot_cancel", Disabled: true},
			},
		}
		s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
			Content:    &content,
			Components: &[]discordgo.MessageComponent{disabledRow},
		})
	case "reboot_cancel":
		content := "Reboot cancelled."
		disabledRow := discordgo.ActionsRow{
			Components: []discordgo.MessageComponent{
				discordgo.Button{Label: "Confirm Reboot", Style: discordgo.DangerButton, CustomID: "reboot_confirm", Disabled: true},
				discordgo.Button{Label: "Cancel", Style: discordgo.SecondaryButton, CustomID: "reboot_cancel", Disabled: true},
			},
		}
		s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseUpdateMessage,
			Data: &discordgo.InteractionResponseData{
				Content:    content,
				Components: []discordgo.MessageComponent{disabledRow},
			},
		})
	}
}

func handleLockBand(s *discordgo.Session, i *discordgo.InteractionCreate) {
	// Defer immediately — AT commands may take a moment
	s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseDeferredChannelMessageWithSource,
	})

	opts := i.ApplicationCommandData().Options
	optMap := map[string]string{}
	for _, o := range opts {
		optMap[o.Name] = o.StringValue()
	}

	lteBands := parseBandOption(optMap["lte_bands"])
	nrBands := parseBandOption(optMap["nr_bands"])

	var results []string

	if lteBand, ok := optMap["lte_bands"]; ok {
		parsed := parseBandOption(lteBand)
		atVal := parsed
		if atVal == "" {
			atVal = "0" // 0 = all bands (unlock)
		}
		_, cmdOK := runQcmd(fmt.Sprintf(`AT+QNWPREFCFG="lte_band",%s`, atVal))
		if cmdOK {
			if parsed == "" {
				results = append(results, "LTE: unlocked (auto)")
			} else {
				results = append(results, fmt.Sprintf("LTE: locked to B%s", strings.ReplaceAll(lteBands, ":", "/B")))
			}
		} else {
			results = append(results, "LTE: command failed")
		}
	}

	if nrBand, ok := optMap["nr_bands"]; ok {
		parsed := parseBandOption(nrBand)
		atVal := parsed
		if atVal == "" {
			atVal = "0"
		}
		_, cmdOK := runQcmd(fmt.Sprintf(`AT+QNWPREFCFG="nr5g_band",%s`, atVal))
		if cmdOK {
			if parsed == "" {
				results = append(results, "NR: unlocked (auto)")
			} else {
				results = append(results, fmt.Sprintf("NR: locked to n%s", strings.ReplaceAll(nrBands, ":", "/n")))
			}
		} else {
			results = append(results, "NR: command failed")
		}
	}

	if len(results) == 0 {
		results = append(results, "No bands specified. Use lte_bands and/or nr_bands options.")
	}

	content := "🔒 Band lock result:\n" + strings.Join(results, "\n")
	s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{Content: &content})
}

func handleNetworkMode(s *discordgo.Session, i *discordgo.InteractionCreate) {
	s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseDeferredChannelMessageWithSource,
	})

	mode := i.ApplicationCommandData().Options[0].StringValue()
	_, ok := runQcmd(fmt.Sprintf(`AT+QNWPREFCFG="mode_pref",%s`, mode))

	modeLabel := map[string]string{
		"AUTO": "Auto (LTE + NR)", "LTE": "LTE only",
		"NR5G": "NR only", "NR5G:LTE": "NR preferred",
	}
	label := modeLabel[mode]
	if label == "" {
		label = mode
	}

	content := fmt.Sprintf("✅ Network mode set to: **%s**", label)
	if !ok {
		content = fmt.Sprintf("❌ Failed to set network mode to %s. Check modem status.", label)
	}
	s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{Content: &content})
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd discord-bot && go test ./... -run TestParseBand -v
```
Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add discord-bot/handlers.go discord-bot/handlers_test.go
git commit -m "feat(discord-bot): set command handlers (reboot/lock-band/network-mode)"
```

---

## Task 6: Connectivity notification goroutine

**Files:**
- Create: `discord-bot/notify.go`
- Create: `discord-bot/notify_test.go`

- [ ] **Step 1: Write failing tests**

`discord-bot/notify_test.go`:
```go
package main

import "testing"

func TestNotifyState_DownThenUp(t *testing.T) {
	ns := &notifyState{}

	// First call: internet down, threshold not yet exceeded
	action := ns.update("false", 1, 10)
	if action != notifyNone {
		t.Errorf("got %v, want notifyNone (threshold not exceeded)", action)
	}

	// Simulate threshold exceeded
	ns.downtimeStart -= 600 // 10 minutes in the past
	action = ns.update("false", 1, 1)
	if action != notifyDown {
		t.Errorf("got %v, want notifyDown", action)
	}

	// Internet comes back
	action = ns.update("true", 1, 1)
	if action != notifyUp {
		t.Errorf("got %v, want notifyUp", action)
	}

	// Next call: stays up, no notification
	action = ns.update("true", 1, 1)
	if action != notifyNone {
		t.Errorf("got %v, want notifyNone", action)
	}
}

func TestNotifyState_AlreadySentDown(t *testing.T) {
	ns := &notifyState{wasDown: true, downSent: true, downtimeStart: 1000}
	// Still down: don't resend
	action := ns.update("false", 1, 1)
	if action != notifyNone {
		t.Errorf("got %v, want notifyNone (already sent)", action)
	}
}
```

- [ ] **Step 2: Run — expect compile failure**

```bash
cd discord-bot && go test ./... -run TestNotify 2>&1 | head -5
```
Expected: `undefined: notifyState`

- [ ] **Step 3: Implement notify.go**

`discord-bot/notify.go`:
```go
package main

import (
	"fmt"
	"log"
	"time"

	"github.com/bwmarrin/discordgo"
)

type notifyAction int

const (
	notifyNone notifyAction = iota
	notifyDown
	notifyUp
)

type notifyState struct {
	wasDown       bool
	downSent      bool
	downtimeStart int64
}

// update checks the current internet state against the threshold and returns
// what notification action (if any) should be taken.
// thresholdMinutes: configured threshold; pollIntervalSecs: poll interval for timing.
func (ns *notifyState) update(internet string, thresholdMinutes, _ int) notifyAction {
	now := time.Now().Unix()
	threshSecs := int64(thresholdMinutes * 60)

	isDown := internet == "false"

	if isDown {
		if !ns.wasDown {
			ns.wasDown = true
			ns.downtimeStart = now
			ns.downSent = false
		}
		if !ns.downSent && now-ns.downtimeStart >= threshSecs {
			ns.downSent = true
			return notifyDown
		}
		return notifyNone
	}

	// Internet is up
	if ns.wasDown {
		ns.wasDown = false
		ns.downSent = false
		return notifyUp
	}
	return notifyNone
}

func (ns *notifyState) downtimeDuration() string {
	secs := time.Now().Unix() - ns.downtimeStart
	if secs < 60 {
		return fmt.Sprintf("%ds", secs)
	}
	return fmt.Sprintf("%dm %ds", secs/60, secs%60)
}

// RunNotifier polls the poller cache and sends DM notifications on connectivity changes.
// Blocks until ctx is cancelled (via stopCh close).
func RunNotifier(s *discordgo.Session, dmChannelID string, cfg *Config, stopCh <-chan struct{}) {
	ns := &notifyState{}
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-stopCh:
			return
		case <-ticker.C:
			status, err := readStatus(statusCachePath)
			if err != nil {
				continue
			}

			// Check reload flag — signal main loop to reload config
			if checkReloadFlag() {
				newCfg, err := loadConfig(configPath)
				if err == nil {
					cfg = newCfg
				}
			}

			action := ns.update(status.ConnInternetAvailable, cfg.ThresholdMinutes, 10)
			switch action {
			case notifyDown:
				ts := time.Unix(ns.downtimeStart, 0).Format("15:04")
				msg := fmt.Sprintf("🔴 **Connection lost** — internet down (threshold exceeded).\nStarted at %s", ts)
				if _, err := s.ChannelMessageSend(dmChannelID, msg); err != nil {
					log.Printf("notify: failed to send down DM: %v", err)
				}
			case notifyUp:
				dur := ns.downtimeDuration()
				msg := fmt.Sprintf("🟢 **Connection restored** after %s.", dur)
				if _, err := s.ChannelMessageSend(dmChannelID, msg); err != nil {
					log.Printf("notify: failed to send up DM: %v", err)
				}
			}
		}
	}
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd discord-bot && go test ./... -run TestNotify -v
```
Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add discord-bot/notify.go discord-bot/notify_test.go
git commit -m "feat(discord-bot): connectivity notification goroutine"
```

---

## Task 7: Main entry point + build script

**Files:**
- Create: `discord-bot/main.go`
- Create: `build-discord-bot.sh`

- [ ] **Step 1: Implement main.go**

`discord-bot/main.go`:
```go
package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/bwmarrin/discordgo"
)

func main() {
	cfg, err := loadConfig(configPath)
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}
	if !cfg.Enabled {
		log.Println("Discord bot is disabled in config. Exiting.")
		os.Exit(0)
	}
	if cfg.BotToken == "" || cfg.OwnerDiscordID == "" {
		log.Fatal("bot_token and owner_discord_id must be set in config")
	}

	writeStatus(statusPath, BotStatus{Connected: false, Error: "starting"})

	s, err := newSession(cfg.BotToken)
	if err != nil {
		writeStatus(statusPath, BotStatus{Connected: false, Error: "session_error"})
		log.Fatalf("failed to create Discord session: %v", err)
	}

	s.AddHandler(handleInteraction)

	s.AddHandler(func(s *discordgo.Session, r *discordgo.Ready) {
		log.Printf("Discord bot ready: %s#%s", r.User.Username, r.User.Discriminator)
		writeStatus(statusPath, BotStatus{Connected: true, LatencyMs: int(s.HeartbeatLatency().Milliseconds())})
	})

	if err := s.Open(); err != nil {
		writeStatus(statusPath, BotStatus{Connected: false, Error: "invalid_token"})
		log.Fatalf("failed to open Discord session: %v", err)
	}
	defer s.Close()

	appID := appIDFromToken(cfg.BotToken)
	if _, err := registerCommands(s, appID); err != nil {
		log.Printf("warning: failed to register slash commands: %v", err)
	}

	dmChannelID, err := openDMChannel(s, cfg.OwnerDiscordID)
	if err != nil {
		log.Printf("warning: failed to open DM channel with owner: %v", err)
	}

	stopNotifier := make(chan struct{})
	if dmChannelID != "" {
		go RunNotifier(s, dmChannelID, cfg, stopNotifier)
	}

	// Periodic status update
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			writeStatus(statusPath, BotStatus{
				Connected: s.DataReady,
				LatencyMs: int(s.HeartbeatLatency().Milliseconds()),
			})
		}
	}()

	log.Println("Discord bot running. Press Ctrl+C to stop.")
	sc := make(chan os.Signal, 1)
	signal.Notify(sc, syscall.SIGINT, syscall.SIGTERM)
	<-sc

	close(stopNotifier)
	writeStatus(statusPath, BotStatus{Connected: false, Error: ""})
	log.Println("Discord bot stopped.")
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd discord-bot && go build ./...
```
Expected: no errors, produces no binary yet (just compile check)

- [ ] **Step 3: Create cross-compile build script**

`build-discord-bot.sh`:
```sh
#!/bin/sh
# Cross-compile qmanager_discord for RM520N-GL (ARMv7l, Linux)
set -eu

OUT="qmanager-build/bin/qmanager_discord"
mkdir -p qmanager-build/bin

echo "Building qmanager_discord for linux/arm7..."
cd discord-bot
GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0 \
    go build -ldflags="-s -w" -o "../${OUT}" .
cd ..

SIZE=$(du -sh "$OUT" | cut -f1)
echo "Built: ${OUT} (${SIZE})"
```

- [ ] **Step 4: Run build**

```bash
chmod +x build-discord-bot.sh && ./build-discord-bot.sh
```
Expected: `Built: qmanager-build/bin/qmanager_discord (~6-8MB)`

- [ ] **Step 5: Run all tests**

```bash
cd discord-bot && go test ./... -v
```
Expected: all `PASS`

- [ ] **Step 6: Commit**

```bash
git add discord-bot/main.go build-discord-bot.sh
git commit -m "feat(discord-bot): main entry point + ARMv7 cross-compile script"
```

---

## Task 8: systemd unit

**Files:**
- Create: `scripts/etc/systemd/system/qmanager-discord.service`

- [ ] **Step 1: Create service unit**

`scripts/etc/systemd/system/qmanager-discord.service`:
```ini
# /lib/systemd/system/qmanager-discord.service
[Unit]
Description=QManager Discord Bot
After=network-online.target qmanager-poller.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/qmanager_discord
EnvironmentFile=-/etc/qmanager/environment
TimeoutStartSec=30
TimeoutStopSec=10
Restart=on-failure
RestartSec=10s
StartLimitIntervalSec=3600
StartLimitBurst=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=qmanager-discord

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Verify syntax check passes in run-all.sh test suite**

```bash
bash scripts/test/run-all.sh 2>&1 | grep -E "PASS|FAIL|discord"
```
Expected: No FAIL lines related to the new service file.

- [ ] **Step 3: Commit**

```bash
git add scripts/etc/systemd/system/qmanager-discord.service
git commit -m "feat(discord-bot): systemd service unit"
```

---

## Task 9: CGI endpoints + shell lib

**Files:**
- Create: `scripts/usr/lib/qmanager/discord_alerts.sh`
- Create: `scripts/www/cgi-bin/quecmanager/monitoring/discord_bot/configure.sh`
- Create: `scripts/www/cgi-bin/quecmanager/monitoring/discord_bot/status.sh`
- Create: `scripts/www/cgi-bin/quecmanager/monitoring/discord_bot/test.sh`
- Create: `scripts/www/cgi-bin/quecmanager/monitoring/discord_bot/alert_log.sh`

- [ ] **Step 1: Create discord_alerts.sh**

`scripts/usr/lib/qmanager/discord_alerts.sh`:
```sh
#!/bin/sh
# discord_alerts.sh — Discord Bot shell helper
# Sourced by CGI scripts for sending test DMs via the bot status file.
# Install location: /usr/lib/qmanager/discord_alerts.sh

[ -n "$_DISCORD_ALERTS_LOADED" ] && return 0
_DISCORD_ALERTS_LOADED=1

_DA_CONFIG="/etc/qmanager/discord_bot.json"
_DA_STATUS="/tmp/qmanager_discord_status.json"
_DA_LOG="/tmp/qmanager_discord_log.json"
_DA_RELOAD_FLAG="/tmp/qmanager_discord_reload"

da_is_installed() {
    [ -x /usr/bin/qmanager_discord ]
}

da_is_running() {
    [ -f /run/qmanager-discord.pid ] || systemctl is-active qmanager-discord.service >/dev/null 2>&1
}

da_is_connected() {
    [ -f "$_DA_STATUS" ] || return 1
    jq -r '.connected // false' "$_DA_STATUS" 2>/dev/null | grep -q "^true$"
}

da_touch_reload() {
    touch "$_DA_RELOAD_FLAG" 2>/dev/null
}

da_bot_status_json() {
    if [ -f "$_DA_STATUS" ]; then
        cat "$_DA_STATUS"
    else
        printf '{"connected":false,"error":"not_started"}'
    fi
}
```

- [ ] **Step 2: Create configure.sh**

`scripts/www/cgi-bin/quecmanager/monitoring/discord_bot/configure.sh`:
```sh
#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/discord_alerts.sh
# =============================================================================
# configure.sh — Discord Bot configuration CGI (GET + POST)
# GET:  Returns current config (token masked) + bot status.
# POST: action=save_settings | action=install | action=uninstall | action=enable | action=disable
# =============================================================================

qlog_init "cgi_discord_configure"
cgi_headers
cgi_handle_options

CONFIG="/etc/qmanager/discord_bot.json"
RELOAD_FLAG="/tmp/qmanager_discord_reload"
BOT_BIN="/usr/bin/qmanager_discord"

if [ "$REQUEST_METHOD" = "GET" ]; then
    installed="false"
    da_is_installed && installed="true"

    connected="false"
    da_is_connected && connected="true"

    enabled="false"
    owner_discord_id=""
    threshold_minutes=5
    token_set="false"

    if [ -f "$CONFIG" ]; then
        token=$(jq -r '.bot_token // ""' "$CONFIG" 2>/dev/null)
        [ -n "$token" ] && token_set="true"
        owner_discord_id=$(jq -r '.owner_discord_id // ""' "$CONFIG" 2>/dev/null)
        enabled=$(jq -r '(.enabled) | if . == null then "false" else tostring end' "$CONFIG" 2>/dev/null)
        threshold_minutes=$(jq -r '.threshold_minutes // 5' "$CONFIG" 2>/dev/null)
    fi

    jq -n \
        --argjson success true \
        --argjson installed "$installed" \
        --argjson connected "$connected" \
        --argjson enabled "$enabled" \
        --argjson token_set "$token_set" \
        --arg owner_discord_id "$owner_discord_id" \
        --argjson threshold_minutes "$threshold_minutes" \
        '{success:$success, installed:$installed, connected:$connected,
          settings:{enabled:$enabled, token_set:$token_set,
                    owner_discord_id:$owner_discord_id, threshold_minutes:$threshold_minutes}}'
    exit 0
fi

if [ "$REQUEST_METHOD" = "POST" ]; then
    body=$(cat)
    action=$(printf '%s' "$body" | jq -r '.action // "save_settings"' 2>/dev/null)

    case "$action" in
    save_settings)
        enabled=$(printf '%s' "$body" | jq -r '.enabled // false' 2>/dev/null)
        owner=$(printf '%s' "$body" | jq -r '.owner_discord_id // ""' 2>/dev/null)
        threshold=$(printf '%s' "$body" | jq -r '.threshold_minutes // 5' 2>/dev/null)
        token=$(printf '%s' "$body" | jq -r '.bot_token // ""' 2>/dev/null)

        # Preserve existing token if not provided
        existing_token=""
        [ -f "$CONFIG" ] && existing_token=$(jq -r '.bot_token // ""' "$CONFIG" 2>/dev/null)
        [ -z "$token" ] && token="$existing_token"

        tmp="${CONFIG}.tmp"
        jq -n \
            --argjson enabled "$enabled" \
            --arg bot_token "$token" \
            --arg owner_discord_id "$owner" \
            --argjson threshold_minutes "$threshold" \
            '{enabled:$enabled, bot_token:$bot_token,
              owner_discord_id:$owner_discord_id, threshold_minutes:$threshold_minutes}' > "$tmp" \
            && mv "$tmp" "$CONFIG"

        touch "$RELOAD_FLAG"
        jq -n '{success:true}'
        ;;
    install)
        if da_is_installed; then
            jq -n '{success:true, detail:"already installed"}'
        else
            jq -n '{success:false, detail:"Binary not found. Re-run the QManager installer to deploy qmanager_discord."}'
        fi
        ;;
    uninstall)
        systemctl stop qmanager-discord.service 2>/dev/null
        systemctl disable qmanager-discord.service 2>/dev/null
        rm -f "$BOT_BIN" "$CONFIG"
        jq -n '{success:true}'
        ;;
    enable)
        systemctl enable qmanager-discord.service 2>/dev/null
        systemctl start qmanager-discord.service 2>/dev/null
        jq -n '{success:true}'
        ;;
    disable)
        systemctl stop qmanager-discord.service 2>/dev/null
        jq -n '{success:true}'
        ;;
    *)
        jq -n --arg e "unknown action: $action" '{success:false, error:$e}'
        ;;
    esac
    exit 0
fi
```

- [ ] **Step 3: Create status.sh**

`scripts/www/cgi-bin/quecmanager/monitoring/discord_bot/status.sh`:
```sh
#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/discord_alerts.sh

qlog_init "cgi_discord_status"
cgi_headers
cgi_handle_options

if [ "$REQUEST_METHOD" = "GET" ]; then
    status_json=$(da_bot_status_json)
    installed="false"
    da_is_installed && installed="true"
    printf '%s' "$status_json" | jq --argjson installed "$installed" '. + {success:true, installed:$installed}'
fi
```

- [ ] **Step 4: Create test.sh**

`scripts/www/cgi-bin/quecmanager/monitoring/discord_bot/test.sh`:
```sh
#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/discord_alerts.sh

qlog_init "cgi_discord_test"
cgi_headers
cgi_handle_options

if [ "$REQUEST_METHOD" = "POST" ]; then
    if ! da_is_installed; then
        jq -n '{success:false, error:"Bot binary not installed"}'
        exit 0
    fi
    if ! da_is_connected; then
        jq -n '{success:false, error:"Bot is not connected to Discord"}'
        exit 0
    fi
    # Signal the bot to send a test DM by writing a trigger file
    printf '{"action":"test_dm","ts":%s}' "$(date +%s)" > /tmp/qmanager_discord_test
    jq -n '{success:true, detail:"Test DM requested. Check your Discord DMs."}'
fi
```

- [ ] **Step 5: Create alert_log.sh**

`scripts/www/cgi-bin/quecmanager/monitoring/discord_bot/alert_log.sh`:
```sh
#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh

qlog_init "cgi_discord_log"
cgi_headers
cgi_handle_options

LOG="/tmp/qmanager_discord_log.json"

if [ "$REQUEST_METHOD" = "GET" ]; then
    if [ -f "$LOG" ]; then
        entries=$(tail -n 20 "$LOG" | jq -s '.' 2>/dev/null || printf '[]')
    else
        entries="[]"
    fi
    jq -n --argjson entries "$entries" '{success:true, entries:$entries}'
fi
```

- [ ] **Step 6: Verify syntax**

```bash
bash scripts/test/run-all.sh 2>&1 | grep -E "PASS|FAIL"
```
Expected: all PASS, no new FAILs.

- [ ] **Step 7: Commit**

```bash
git add scripts/usr/lib/qmanager/discord_alerts.sh \
        scripts/www/cgi-bin/quecmanager/monitoring/discord_bot/
git commit -m "feat(discord-bot): CGI endpoints and shell alert lib"
```

---

## Task 10: Frontend types + hook

**Files:**
- Create: `types/discord-bot.ts`
- Create: `hooks/use-discord-bot.ts`

- [ ] **Step 1: Create types**

`types/discord-bot.ts`:
```typescript
// Types for the Discord bot feature.
// Backend: /cgi-bin/quecmanager/monitoring/discord_bot/configure.sh

export interface DiscordBotSettings {
  enabled: boolean;
  token_set: boolean;
  owner_discord_id: string;
  threshold_minutes: number;
}

export interface DiscordBotStatus {
  connected: boolean;
  last_seen: number;
  latency_ms: number;
  error?: string;
  installed: boolean;
}

export interface DiscordBotSavePayload {
  action: "save_settings";
  enabled: boolean;
  owner_discord_id: string;
  threshold_minutes: number;
  bot_token?: string;
}
```

- [ ] **Step 2: Create hook**

`hooks/use-discord-bot.ts`:
```typescript
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { authFetch } from "@/lib/auth-fetch";
import type {
  DiscordBotSettings,
  DiscordBotStatus,
  DiscordBotSavePayload,
} from "@/types/discord-bot";

const CGI_CONFIGURE = "/cgi-bin/quecmanager/monitoring/discord_bot/configure.sh";
const CGI_STATUS = "/cgi-bin/quecmanager/monitoring/discord_bot/status.sh";
const CGI_TEST = "/cgi-bin/quecmanager/monitoring/discord_bot/test.sh";

export interface UseDiscordBotReturn {
  settings: DiscordBotSettings | null;
  status: DiscordBotStatus | null;
  isLoading: boolean;
  isSaving: boolean;
  isSendingTest: boolean;
  error: string | null;
  saveSettings: (payload: DiscordBotSavePayload) => Promise<boolean>;
  sendTestDm: () => Promise<boolean>;
  enable: () => Promise<boolean>;
  disable: () => Promise<boolean>;
  refresh: () => void;
}

export function useDiscordBot(): UseDiscordBotReturn {
  const [settings, setSettings] = useState<DiscordBotSettings | null>(null);
  const [status, setStatus] = useState<DiscordBotStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const [confResp, statResp] = await Promise.all([
        authFetch(CGI_CONFIGURE),
        authFetch(CGI_STATUS),
      ]);
      if (!confResp.ok || !statResp.ok) throw new Error("Fetch failed");
      const [conf, stat] = await Promise.all([confResp.json(), statResp.json()]);
      if (!mountedRef.current) return;
      if (conf.success) setSettings(conf.settings);
      if (stat.success) setStatus(stat);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to fetch Discord bot settings");
    } finally {
      if (mountedRef.current && !silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const saveSettings = useCallback(async (payload: DiscordBotSavePayload): Promise<boolean> => {
    setIsSaving(true);
    setError(null);
    try {
      const resp = await authFetch(CGI_CONFIGURE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await resp.json();
      if (!mountedRef.current) return false;
      if (!json.success) { setError(json.error ?? "Failed to save"); return false; }
      await fetchAll(true);
      return true;
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : "Failed to save");
      return false;
    } finally {
      if (mountedRef.current) setIsSaving(false);
    }
  }, [fetchAll]);

  const sendTestDm = useCallback(async (): Promise<boolean> => {
    setIsSendingTest(true);
    try {
      const resp = await authFetch(CGI_TEST, { method: "POST" });
      const json = await resp.json();
      return json.success;
    } catch { return false; }
    finally { if (mountedRef.current) setIsSendingTest(false); }
  }, []);

  const enable = useCallback(async (): Promise<boolean> => {
    const resp = await authFetch(CGI_CONFIGURE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "enable" }),
    });
    const json = await resp.json();
    if (json.success) await fetchAll(true);
    return json.success;
  }, [fetchAll]);

  const disable = useCallback(async (): Promise<boolean> => {
    const resp = await authFetch(CGI_CONFIGURE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "disable" }),
    });
    const json = await resp.json();
    if (json.success) await fetchAll(true);
    return json.success;
  }, [fetchAll]);

  return { settings, status, isLoading, isSaving, isSendingTest, error,
           saveSettings, sendTestDm, enable, disable, refresh: fetchAll };
}
```

- [ ] **Step 3: Verify type-check passes**

```bash
bunx tsc --noEmit 2>&1 | head -20
```
Expected: no errors relating to `discord-bot.ts` or `use-discord-bot.ts`

- [ ] **Step 4: Commit**

```bash
git add types/discord-bot.ts hooks/use-discord-bot.ts
git commit -m "feat(discord-bot): TypeScript types and hook"
```

---

## Task 11: Frontend Discord Bot card

**Files:**
- Create: `components/monitoring/discord-bot-card.tsx`

- [ ] **Step 1: Create the card**

`components/monitoring/discord-bot-card.tsx`:
```tsx
"use client";

import { useState } from "react";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2Icon, XCircleIcon, MinusCircleIcon,
  SendIcon, Loader2Icon,
} from "lucide-react";
import { SaveButton } from "@/components/ui/save-button";
import { useDiscordBot } from "@/hooks/use-discord-bot";
import type { DiscordBotSavePayload } from "@/types/discord-bot";

export function DiscordBotCard() {
  const {
    settings, status, isLoading, isSaving, isSendingTest,
    error, saveSettings, sendTestDm, enable, disable, refresh,
  } = useDiscordBot();

  const [token, setToken] = useState("");
  const [ownerID, setOwnerID] = useState("");
  const [threshold, setThreshold] = useState(5);
  const [enabled, setEnabled] = useState(false);

  // Sync local state when settings load
  if (settings && ownerID === "" && settings.owner_discord_id) {
    setOwnerID(settings.owner_discord_id);
    setThreshold(settings.threshold_minutes);
    setEnabled(settings.enabled);
  }

  const handleSave = async () => {
    const payload: DiscordBotSavePayload = {
      action: "save_settings",
      enabled,
      owner_discord_id: ownerID,
      threshold_minutes: threshold,
    };
    if (token.trim()) payload.bot_token = token.trim();
    const ok = await saveSettings(payload);
    if (ok) setToken("");
  };

  const statusBadge = () => {
    if (!status?.installed) {
      return (
        <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-muted-foreground/30">
          <MinusCircleIcon className="size-3" /> Not installed
        </Badge>
      );
    }
    if (status.connected) {
      return (
        <Badge variant="outline" className="bg-success/15 text-success border-success/30">
          <CheckCircle2Icon className="size-3" /> Connected
          {status.latency_ms > 0 && <span className="ml-1 opacity-60">{status.latency_ms}ms</span>}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-destructive/15 text-destructive border-destructive/30">
        <XCircleIcon className="size-3" />
        {status.error === "invalid_token" ? "Invalid token" : "Disconnected"}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Discord Bot</CardTitle>
          <CardDescription>Personal Discord bot for modem queries and alerts</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" /> Loading...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Discord Bot</CardTitle>
            <CardDescription>Personal Discord bot for modem queries and alerts via DMs</CardDescription>
          </div>
          {statusBadge()}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {/* Setup guide — shown when not installed or token not set */}
        {(!status?.installed || !settings?.token_set) && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
            <p className="font-medium">Setup steps:</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Go to <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer" className="underline text-foreground">discord.com/developers</a> → New Application → Bot → copy token</li>
              <li>Paste your bot token below</li>
              <li>Enable Developer Mode in Discord (Settings → Advanced), right-click your avatar → Copy User ID</li>
              <li>Paste your User ID below, save settings</li>
              <li>Use this OAuth2 URL to add the bot to your account (no server needed):<br/>
                <code className="text-xs bg-muted px-1 rounded">
                  https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=applications.commands
                </code>
              </li>
            </ol>
          </div>
        )}

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              id="discord-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
            <Label htmlFor="discord-enabled">Enable Discord Bot</Label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="discord-token">
              Bot Token {settings?.token_set && <span className="text-xs text-muted-foreground">(set — leave blank to keep)</span>}
            </Label>
            <Input
              id="discord-token"
              type="password"
              placeholder={settings?.token_set ? "••••••••" : "Paste your bot token"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="discord-owner-id">Your Discord User ID</Label>
            <Input
              id="discord-owner-id"
              placeholder="e.g. 123456789012345678"
              value={ownerID}
              onChange={(e) => setOwnerID(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="discord-threshold">Alert threshold (minutes)</Label>
            <Input
              id="discord-threshold"
              type="number"
              min={1}
              max={60}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground">
              Sends a DM if internet is down for longer than this duration.
            </p>
          </div>
        </div>

        <Separator />

        <div className="flex items-center gap-3 flex-wrap">
          <SaveButton onClick={handleSave} isSaving={isSaving} />
          <Button
            variant="outline"
            size="sm"
            disabled={!status?.connected || isSendingTest}
            onClick={sendTestDm}
          >
            {isSendingTest ? (
              <><Loader2Icon className="size-4 animate-spin mr-2" /> Sending...</>
            ) : (
              <><SendIcon className="size-4 mr-2" /> Send Test DM</>
            )}
          </Button>
          {status?.connected && (
            <Button variant="outline" size="sm" onClick={() => (enabled ? disable() : enable())}>
              {enabled ? "Stop Bot" : "Start Bot"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
bunx tsc --noEmit 2>&1 | head -20
```
Expected: no errors from `discord-bot-card.tsx`

- [ ] **Step 3: Commit**

```bash
git add components/monitoring/discord-bot-card.tsx
git commit -m "feat(discord-bot): Discord Bot settings card with setup wizard"
```

---

## Task 12: Installer integration

**Files:**
- Modify: `qmanager-installer.sh`
- Modify: `scripts/usr/bin/qmanager_update`

- [ ] **Step 1: Add binary deployment to installer**

In `qmanager-installer.sh`, find the section that copies binaries (near where `atcli_smd11` or `sms_tool` is deployed). Add after it:

```sh
# --- Discord bot binary ---
if [ -f "$SCRIPT_DIR/bin/qmanager_discord" ]; then
    log_step "Installing Discord bot binary"
    cp "$SCRIPT_DIR/bin/qmanager_discord" /usr/bin/qmanager_discord
    chmod 755 /usr/bin/qmanager_discord
else
    log_warn "qmanager_discord binary not found in tarball — Discord bot unavailable"
fi
```

Find the section that enables/starts services and add (gated on binary existing):

```sh
if [ -x /usr/bin/qmanager_discord ] && [ -f /etc/qmanager/discord_bot.json ]; then
    enabled=$(jq -r '.enabled // "false"' /etc/qmanager/discord_bot.json 2>/dev/null)
    if [ "$enabled" = "true" ]; then
        log_step "Enabling Discord bot service"
        svc_enable qmanager-discord.service
        systemctl start qmanager-discord.service 2>/dev/null || true
    fi
fi
```

- [ ] **Step 2: Add to qmanager_update cleanup list**

In `scripts/usr/bin/qmanager_update`, find where binaries are cleaned up (look for `atcli_smd11` or similar). Add `qmanager_discord` to the same list so OTA updates replace the binary correctly.

Search for the pattern and add:
```sh
# In the binary cleanup/replace section:
copy_bin "bin/qmanager_discord" "/usr/bin/qmanager_discord" 755 || true
```

- [ ] **Step 3: Add binary to build.sh tarball packaging**

In `build.sh`, find where binaries are included in the tarball and add:
```sh
if [ -f "qmanager-build/bin/qmanager_discord" ]; then
    cp qmanager-build/bin/qmanager_discord "$PKG_DIR/bin/"
fi
```

- [ ] **Step 4: Verify build.sh produces tarball with binary**

```bash
./build-discord-bot.sh && bun run package 2>&1 | tail -10
```
Expected: tarball includes `bin/qmanager_discord`

- [ ] **Step 5: Commit**

```bash
git add qmanager-installer.sh scripts/usr/bin/qmanager_update build.sh
git commit -m "feat(discord-bot): installer + OTA update integration"
```

---

## Task 13: Wire up the card in the UI + end-to-end test

**Files:**
- Modify: the monitoring settings page (find via `grep -r "email.*card\|EmailAlerts" app/ --include="*.tsx" -l`)

- [ ] **Step 1: Find the monitoring settings page**

```bash
grep -r "EmailAlerts\|email-alerts\|sms-alerts" app/ --include="*.tsx" -l
```

- [ ] **Step 2: Import and add the Discord bot card**

In the monitoring settings page, add alongside the existing email/SMS cards:

```tsx
import { DiscordBotCard } from "@/components/monitoring/discord-bot-card";

// Inside the page JSX, after the SMS alerts card:
<DiscordBotCard />
```

- [ ] **Step 3: Type-check and build**

```bash
bunx tsc --noEmit && bun run build 2>&1 | tail -10
```
Expected: no TypeScript errors, build succeeds.

- [ ] **Step 4: Manual E2E checklist**

Deploy to device and verify:

```
[ ] Discord bot card appears on monitoring settings page
[ ] GET configure.sh returns correct JSON (installed=false when binary not deployed)
[ ] After deploying binary: installed=true
[ ] Save settings writes /etc/qmanager/discord_bot.json correctly
[ ] Service starts: systemctl status qmanager-discord shows "active (running)"
[ ] Status card updates to "Connected" within 10s of bot connecting
[ ] /signal slash command returns embed with antenna data
[ ] /bands slash command returns band/CA embed
[ ] /status slash command returns connectivity + system embed
[ ] /events slash command returns last 5 events
[ ] /reboot shows confirmation buttons; Cancel dismisses; Confirm runs qcmd
[ ] Buttons disabled after 30s if no interaction
[ ] /lock-band B3:B28 sends AT command and reports result
[ ] /network-mode lte-only changes mode and reports
[ ] Kill internet for 5+ min; bot sends "Connection lost" DM
[ ] Restore internet; bot sends "Connection restored after X" DM
[ ] Send test DM button works from web UI
[ ] Reload flag: save settings → bot picks up new config within 10s without restart
[ ] journalctl -u qmanager-discord shows no errors
```

- [ ] **Step 5: Final commit**

```bash
git add app/ # or whichever page file was modified
git commit -m "feat(discord-bot): wire card into monitoring page; feature complete"
```
