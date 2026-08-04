package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
)

const (
	configPath = "/etc/qmanager/discord_bot.json"
	// secretTokenPath holds the raw bot token, 0600 root:root inside a 0700
	// root:root directory. It is deliberately NOT in discord_bot.json: that
	// file lives in a www-data-owned directory, so keeping the token there
	// exposed it to the whole web stack. The daemon runs as root and reads it
	// directly; only the qmanager_secret_set root helper ever writes it.
	secretTokenPath = "/etc/qmanager-secrets/discord_bot_token"
	statusPath      = "/tmp/qmanager_discord_status.json"
	reloadFlagPath  = "/tmp/qmanager_discord_reload"
	logPath         = "/tmp/qmanager_discord_log.json"
	maxLogEntries   = 100
	// cmdPath is the command file the shell alert engine (alert_engine.sh) writes
	// to tell the daemon to deliver a DM. The daemon watches it via runCmdWatcher.
	cmdPath = "/tmp/qmanager_discord_cmd"
)

type Config struct {
	Enabled bool `json:"enabled"`
	// There is intentionally no BotToken field. The token lives in
	// secretTokenPath and is loaded by loadBotToken; without a struct field
	// the JSON physically cannot carry it again, even if some future writer
	// tries. TokenSet is the non-secret marker the CGI renders from.
	TokenSet         bool   `json:"token_set"`
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

// loadBotToken reads the raw Discord bot token from the root-only secret file.
//
// A missing or empty file is a real misconfiguration, not a transient: the
// daemon runs as root, so it is never a permission problem, and the token is
// only ever written when the operator saves one in the QManager UI. The errors
// therefore say what to do about it rather than just reporting errno.
func loadBotToken(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", fmt.Errorf("no bot token stored at %s — enter the Discord bot token under Monitoring > Alerts in QManager and save", path)
		}
		return "", fmt.Errorf("reading bot token from %s: %w", path, err)
	}
	// TrimSpace, not a raw string: the file is written without a trailing
	// newline, but any writer (or a hand-edit over SSH) may add one, and a
	// token with a stray "\n" fails Discord auth with an opaque 401.
	token := strings.TrimSpace(string(data))
	if token == "" {
		return "", fmt.Errorf("bot token file %s is empty — re-enter the Discord bot token under Monitoring > Alerts in QManager and save", path)
	}
	return token, nil
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
