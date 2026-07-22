package main

import (
	"encoding/json"
	"testing"
)

func TestDiscordCmd_ValidPayload(t *testing.T) {
	var c discordCmd
	if err := json.Unmarshal([]byte(`{"message":"hello world"}`), &c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if c.Message != "hello world" {
		t.Errorf("got Message %q, want %q", c.Message, "hello world")
	}
}

func TestDiscordCmd_EmptyMessage(t *testing.T) {
	var c discordCmd
	if err := json.Unmarshal([]byte(`{}`), &c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if c.Message != "" {
		t.Errorf("expected empty Message, got %q", c.Message)
	}
}

func TestDiscordCmd_Malformed(t *testing.T) {
	var c discordCmd
	if err := json.Unmarshal([]byte(`{not json`), &c); err == nil {
		t.Fatal("expected error for malformed payload, got nil")
	}
}

func TestConfig_AutonomousNotifyDefaultsFalse(t *testing.T) {
	// Missing key must decode to false — this is the OTA-safe default that
	// keeps the shell engine the sole alert driver.
	var cfg Config
	if err := json.Unmarshal([]byte(`{"enabled":true,"bot_token":"x","owner_discord_id":"1"}`), &cfg); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.AutonomousNotify {
		t.Error("expected AutonomousNotify=false when key absent")
	}
}
