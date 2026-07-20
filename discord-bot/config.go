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
	// cmdPath is the command file the shell alert engine (alert_engine.sh) writes
	// to tell the daemon to deliver a DM. The daemon watches it via runCmdWatcher.
	cmdPath = "/tmp/qmanager_discord_cmd"
)

type Config struct {
	Enabled          bool   `json:"enabled"`
	BotToken         string `json:"bot_token"`
	OwnerDiscordID   string `json:"owner_discord_id"`
	ThresholdMinutes int    `json:"threshold_minutes"`
	// AutonomousNotify gates the daemon's own downtime timer (RunNotifier).
	// Absent key => false (Go zero value) => the shell alert engine is the sole
	// alert driver via cmdPath, so an OTA-upgraded device with an old config
	// has NO double-send window. Flip true only as a debug escape hatch.
	AutonomousNotify bool `json:"autonomous_notify"`
}

type BotStatus struct {
	Connected bool   `json:"connected"`
	LastSeen  int64  `json:"last_seen"`
	LatencyMs int    `json:"latency_ms"`
	Error     string `json:"error,omitempty"`
	AppID     string `json:"app_id,omitempty"`
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
