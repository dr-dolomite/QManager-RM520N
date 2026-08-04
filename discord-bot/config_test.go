package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadConfig_ValidFile(t *testing.T) {
	f, _ := os.CreateTemp("", "discord_cfg*.json")
	defer os.Remove(f.Name())
	json.NewEncoder(f).Encode(Config{
		Enabled:          true,
		TokenSet:         true,
		OwnerDiscordID:   "123",
		ThresholdMinutes: 10,
	})
	f.Close()

	cfg, err := loadConfig(f.Name())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !cfg.TokenSet {
		t.Error("expected TokenSet=true")
	}
	if cfg.OwnerDiscordID != "123" {
		t.Errorf("got OwnerDiscordID %q, want %q", cfg.OwnerDiscordID, "123")
	}
	if cfg.ThresholdMinutes != 10 {
		t.Errorf("got ThresholdMinutes %d, want 10", cfg.ThresholdMinutes)
	}
}

func TestLoadConfig_DefaultThreshold(t *testing.T) {
	f, _ := os.CreateTemp("", "discord_cfg*.json")
	defer os.Remove(f.Name())
	f.WriteString(`{"enabled":true,"token_set":true,"owner_discord_id":"1"}`)
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

// A legacy config that still carries the plaintext bot_token must not be able
// to surface it — the struct has no field for it, so it decodes and is dropped.
func TestLoadConfig_LegacyBotTokenIsIgnored(t *testing.T) {
	f, _ := os.CreateTemp("", "discord_cfg*.json")
	defer os.Remove(f.Name())
	f.WriteString(`{"enabled":true,"bot_token":"leaked","owner_discord_id":"1"}`)
	f.Close()

	cfg, err := loadConfig(f.Name())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	round, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(round), "leaked") {
		t.Errorf("legacy bot_token survived into the Config struct: %s", round)
	}
}

func TestLoadBotToken_ReadsSecretFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "discord_bot_token")
	if err := os.WriteFile(path, []byte("MTIz.abc.def"), 0600); err != nil {
		t.Fatalf("write: %v", err)
	}

	tok, err := loadBotToken(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if tok != "MTIz.abc.def" {
		t.Errorf("got token %q, want %q", tok, "MTIz.abc.def")
	}
}

func TestLoadBotToken_TrimsTrailingNewline(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "discord_bot_token")
	if err := os.WriteFile(path, []byte("MTIz.abc.def\n"), 0600); err != nil {
		t.Fatalf("write: %v", err)
	}

	tok, err := loadBotToken(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if tok != "MTIz.abc.def" {
		t.Errorf("got token %q, want the trailing newline trimmed", tok)
	}
}

func TestLoadBotToken_MissingFile(t *testing.T) {
	_, err := loadBotToken(filepath.Join(t.TempDir(), "absent"))
	if err == nil {
		t.Fatal("expected an error for a missing token file, got nil")
	}
	// The message has to be actionable — the daemon runs as root, so this is
	// always "nobody saved a token", never a permission problem.
	if !strings.Contains(err.Error(), "no bot token stored") {
		t.Errorf("error is not actionable: %v", err)
	}
}

func TestLoadBotToken_EmptyFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "discord_bot_token")
	if err := os.WriteFile(path, []byte("   \n"), 0600); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := loadBotToken(path); err == nil {
		t.Fatal("expected an error for a whitespace-only token file, got nil")
	}
}

func TestWriteStatus(t *testing.T) {
	f, _ := os.CreateTemp("", "discord_status*.json")
	path := f.Name()
	f.Close()
	defer os.Remove(path)
	defer os.Remove(path + ".tmp")

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
	if got.LastSeen == 0 {
		t.Error("expected LastSeen to be set by writeStatus")
	}
}

func TestCommandDefinitions_AllPresent(t *testing.T) {
	names := map[string]bool{}
	for _, cmd := range slashCommands() {
		names[cmd.Name] = true
	}
	required := []string{"signal", "bands", "status", "events", "device", "sim", "watchcat", "reboot", "lock-band", "network-mode"}
	for _, r := range required {
		if !names[r] {
			t.Errorf("missing slash command: %s", r)
		}
	}
}
