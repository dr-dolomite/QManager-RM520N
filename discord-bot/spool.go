package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/bwmarrin/discordgo"
)

// maxSpoolEntryBytes caps one spool file read; a real entry is a few hundred bytes.
const maxSpoolEntryBytes = 16 * 1024

// discordCmd is one spool entry written by discord_dispatch_message
// (discord_alerts.sh). Trigger and Recipient feed the daemon's log row.
type discordCmd struct {
	Message   string `json:"message"`
	Trigger   string `json:"trigger"`
	Recipient string `json:"recipient"`
}

// appendDiscordLog appends one NDJSON result line to logPath, matching the
// timestamp format the shell logs use ("YYYY-MM-DD HH:MM:SS"). O_APPEND is used
// deliberately: a single sub-4KB line is written atomically on POSIX, so the
// daemon and any shell-side writer interleave cleanly without a lock.
func appendDiscordLog(trigger, status, recipient string) {
	if trigger == "" {
		trigger = "alert"
	}
	if recipient == "" {
		recipient = "discord"
	}
	row := struct {
		Timestamp string `json:"timestamp"`
		Trigger   string `json:"trigger"`
		Status    string `json:"status"`
		Recipient string `json:"recipient"`
	}{time.Now().Format("2006-01-02 15:04:05"), trigger, status, recipient}
	line, err := json.Marshal(row)
	if err != nil {
		log.Printf("cmd watcher: failed to encode log row: %v", err)
		return
	}
	f, err := openLogAppend(logPath)
	if err != nil {
		log.Printf("cmd watcher: failed to open log %s: %v", logPath, err)
		return
	}
	defer f.Close()
	if _, err := f.WriteString(string(line) + "\n"); err != nil {
		log.Printf("cmd watcher: failed to append log: %v", err)
	}
}

// ensureSpoolDir makes spoolDir a real root-owned sticky 1777 directory (root and
// www-data both enqueue). Anything else at that /tmp path (symlink, file, foreign dir) is removed first.
func ensureSpoolDir() bool {
	if spoolDirTrusted() {
		return true
	}
	if err := os.RemoveAll(spoolDir); err != nil { // RemoveAll unlinks a symlink, never its target
		log.Printf("cmd watcher: failed to clear untrusted spool path %s: %v", spoolDir, err)
		return false
	}
	if err := os.Mkdir(spoolDir, 0o700); err != nil && !os.IsExist(err) {
		log.Printf("cmd watcher: failed to create spool dir %s: %v", spoolDir, err)
		return false
	}
	if err := chmodSpoolDir(); err != nil {
		log.Printf("cmd watcher: failed to secure spool dir: %v", err)
		return false
	}
	return spoolDirTrusted()
}

// runCmdWatcher drains spoolDir on a 1s ticker. The shell alert engine owns
// alert timing; the daemon is the DM transport and records each result to the
// NDJSON log.
func runCmdWatcher(s *discordgo.Session, dmCh *dmChannelHolder, cfg *Config, stopCh <-chan struct{}) {
	os.Remove(legacyCmdPath)
	ensureSpoolDir()
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-stopCh:
			return
		case <-ticker.C:
			drainSpool(s, dmCh, cfg, stopCh)
		}
	}
}

// drainSpool delivers every pending entry oldest-first (os.ReadDir sorts by name).
func drainSpool(s *discordgo.Session, dmCh *dmChannelHolder, cfg *Config, stopCh <-chan struct{}) {
	// Re-checked every tick: a swapped-in symlink would make the Removes below delete files elsewhere as root.
	if !ensureSpoolDir() {
		return
	}
	entries, err := os.ReadDir(spoolDir)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("cmd watcher: failed to list spool: %v", err)
		}
		return
	}
	for _, e := range entries {
		select {
		case <-stopCh:
			return
		default:
		}
		name := e.Name()
		if strings.HasPrefix(name, ".") || !strings.HasSuffix(name, ".json") {
			continue
		}
		path := filepath.Join(spoolDir, name)
		// A symlink or other non-regular entry is never read; just drop it.
		if !e.Type().IsRegular() {
			os.Remove(path)
			continue
		}
		data, readErr := readSpoolFile(path)
		os.Remove(path)
		if readErr != nil {
			log.Printf("cmd watcher: failed to read spool entry %s: %v", name, readErr)
			continue
		}
		deliverCmd(s, dmCh, cfg, data)
	}
}

func readSpoolFile(path string) ([]byte, error) {
	f, err := openSpoolEntry(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	// The entry can be swapped after ReadDir; only a regular file is read.
	if fi, err := f.Stat(); err != nil || !fi.Mode().IsRegular() {
		return nil, fmt.Errorf("not a regular file")
	}
	return io.ReadAll(io.LimitReader(f, maxSpoolEntryBytes))
}

func deliverCmd(s *discordgo.Session, dmCh *dmChannelHolder, cfg *Config, data []byte) {
	var cmd discordCmd
	if err := json.Unmarshal(data, &cmd); err != nil {
		log.Printf("cmd watcher: malformed spool entry, skipping: %v", err)
		return
	}
	if cmd.Message == "" {
		log.Printf("cmd watcher: empty message, skipping")
		return
	}

	ch := dmCh.get()
	if ch == "" {
		// Fallback: resolve the channel — may succeed if the owner has
		// since authorized the bot after startup.
		id, err := openDMChannel(s, cfg.OwnerDiscordID)
		if err != nil {
			log.Printf("cmd watcher: no DM channel available, dropping alert: %v", err)
			appendDiscordLog(cmd.Trigger, "failed", cmd.Recipient)
			return
		}
		dmCh.set(id)
		if err := saveDMChannelID(dmChannelPath, id); err != nil {
			log.Printf("warning: failed to persist DM channel: %v", err)
		}
		ch = id
	}

	if _, err := s.ChannelMessageSend(ch, cmd.Message); err != nil {
		log.Printf("cmd watcher: failed to send alert DM: %v", err)
		appendDiscordLog(cmd.Trigger, "failed", cmd.Recipient)
		return
	}
	appendDiscordLog(cmd.Trigger, "sent", cmd.Recipient)
}
