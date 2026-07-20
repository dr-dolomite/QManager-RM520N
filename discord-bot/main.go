package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/bwmarrin/discordgo"
)

// dmChannelHolder is a thread-safe store for the owner DM channel ID.
// Multiple goroutines (notifier, test watcher, MessageCreate handler) read
// and write it, so accesses are protected by a mutex.
type dmChannelHolder struct {
	mu sync.Mutex
	id string
}

func (h *dmChannelHolder) get() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.id
}

func (h *dmChannelHolder) set(id string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.id = id
}

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

	appID := appIDFromToken(cfg.BotToken)

	writeStatus(statusPath, BotStatus{Connected: false, Error: "starting", AppID: appID})

	s, err := newSession(cfg.BotToken)
	if err != nil {
		writeStatus(statusPath, BotStatus{Connected: false, Error: "session_error", AppID: appID})
		log.Fatalf("failed to create Discord session: %v", err)
	}

	s.AddHandler(func(s *discordgo.Session, r *discordgo.Ready) {
		log.Printf("Discord bot ready: %s#%s", r.User.Username, r.User.Discriminator)
		writeStatus(statusPath, BotStatus{Connected: true, LatencyMs: int(s.HeartbeatLatency().Milliseconds()), AppID: appID})
	})

	if err := s.Open(); err != nil {
		writeStatus(statusPath, BotStatus{Connected: false, Error: "invalid_token", AppID: appID})
		log.Fatalf("failed to open Discord session: %v", err)
	}
	defer s.Close()

	if _, err := registerCommands(s, appID); err != nil {
		log.Printf("warning: failed to register slash commands: %v", err)
	}

	dmCh := &dmChannelHolder{}

	// Try the on-disk cache first. UserChannelCreate is unreliable for user-installed
	// bots without a shared guild (Discord error 50007). ChannelMessageSend against a
	// known channel ID is not subject to that gate, so a previously-captured ID is
	// sufficient — no need to call UserChannelCreate again.
	cachedID, _ := loadDMChannelID(dmChannelPath)
	if cachedID != "" {
		log.Printf("loaded cached DM channel: %s", cachedID)
		dmCh.set(cachedID)
	} else {
		// Cold path — no cache, try to resolve fresh.
		id, err := openDMChannel(s, cfg.OwnerDiscordID)
		if err != nil {
			log.Printf("warning: failed to open DM channel with owner: %v", err)
			// Continue with empty — MessageCreate handler or test watcher will
			// capture the channel ID once the owner sends any DM to the bot.
		} else {
			dmCh.set(id)
			if err := saveDMChannelID(dmChannelPath, id); err != nil {
				log.Printf("warning: failed to persist DM channel: %v", err)
			}
		}
	}

	// Capture DM channel ID from slash-command interactions. Discord does not deliver
	// MESSAGE_CREATE Gateway events to user-installed apps (applications.commands scope
	// only), but InteractionCreate IS delivered and carries the invoking ChannelID.
	s.AddHandler(func(s *discordgo.Session, i *discordgo.InteractionCreate) {
		captureDMFromInteraction(i, dmCh, cfg.OwnerDiscordID)
		handleInteraction(s, i)
	})

	// Capture owner DM channel ID from inbound messages — self-healing path after
	// token rotation. No MESSAGE_CONTENT intent needed; we only read channel ID.
	s.AddHandler(func(s *discordgo.Session, m *discordgo.MessageCreate) {
		if m.GuildID != "" {
			return // guild message, not a DM
		}
		if m.Author == nil || m.Author.ID != cfg.OwnerDiscordID {
			return
		}
		if m.ChannelID != dmCh.get() {
			dmCh.set(m.ChannelID)
			if err := saveDMChannelID(dmChannelPath, m.ChannelID); err != nil {
				log.Printf("warning: failed to persist DM channel: %v", err)
			}
			log.Printf("captured DM channel from inbound message: %s", m.ChannelID)
		}
	})

	// Autonomous downtime notifier — the daemon's own timer. Off by default:
	// the shell alert engine (alert_engine.sh) now owns all alert timing and
	// drives the daemon via cmdPath. Only start it when explicitly opted in,
	// so an OTA-upgraded device with an old config has no double-send window.
	stopNotifier := make(chan struct{})
	if cfg.AutonomousNotify {
		go RunNotifier(s, dmCh, cfg, stopNotifier)
	}

	// Command watcher — shell alert engine writes cmdPath to have the daemon
	// deliver a DM. This makes the daemon a pure DM transport.
	stopCmdWatcher := make(chan struct{})
	go runCmdWatcher(s, dmCh, cfg, stopCmdWatcher)

	// Test DM trigger watcher — CGI test.sh creates /tmp/qmanager_discord_test.
	// Always spawn this, even if the initial openDMChannel failed: the user may
	// authorize the bot via OAuth *after* startup, in which case dmChannelID
	// will resolve cleanly on the first trigger after they're authorized.
	stopTestWatcher := make(chan struct{})
	go runTestDMWatcher(s, cfg.OwnerDiscordID, dmCh, stopTestWatcher)

	// Periodic status update
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			writeStatus(statusPath, BotStatus{
				Connected: s.DataReady,
				LatencyMs: int(s.HeartbeatLatency().Milliseconds()),
				AppID:     appID,
			})
		}
	}()

	log.Println("Discord bot running. Press Ctrl+C to stop.")
	sc := make(chan os.Signal, 1)
	signal.Notify(sc, syscall.SIGINT, syscall.SIGTERM)
	<-sc

	close(stopNotifier)
	close(stopCmdWatcher)
	close(stopTestWatcher)
	writeStatus(statusPath, BotStatus{Connected: false, Error: "", AppID: appID})
	log.Println("Discord bot stopped.")
}

const (
	testDMTriggerPath = "/tmp/qmanager_discord_test"
	testDMResultPath  = "/tmp/qmanager_discord_test_result"
)

// writeTestResult writes a {success, error} JSON to testDMResultPath. The CGI
// polls this file with a timeout and returns its contents to the frontend, so
// the toast reflects actual delivery — not just "trigger file written".
// 0644 is intentional: www-data needs read access; bot writes as its own user.
func writeTestResult(success bool, errMsg string) {
	payload := fmt.Sprintf(`{"success":%t,"error":%q}`, success, errMsg)
	if err := os.WriteFile(testDMResultPath, []byte(payload), 0644); err != nil {
		log.Printf("test DM: failed to write result file: %v", err)
	}
}

// runTestDMWatcher polls for the trigger file written by test.sh. On each
// trigger it uses the cached DM channel if available, falling back to
// openDMChannel, and writes a result file the CGI can wait on.
func runTestDMWatcher(s *discordgo.Session, ownerID string, dmCh *dmChannelHolder, stopCh <-chan struct{}) {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-stopCh:
			return
		case <-ticker.C:
			if _, err := os.Stat(testDMTriggerPath); err != nil {
				continue
			}
			os.Remove(testDMTriggerPath)

			ch := dmCh.get()
			if ch == "" {
				var err error
				ch, err = openDMChannel(s, ownerID)
				if err != nil {
					log.Printf("test DM: openDMChannel failed: %v", err)
					writeTestResult(false, "Bot can't reach you — finish authorizing the bot in your Discord account, then try again.")
					continue
				}
				dmCh.set(ch)
				if err := saveDMChannelID(dmChannelPath, ch); err != nil {
					log.Printf("warning: failed to persist DM channel: %v", err)
				}
			}

			if _, err := s.ChannelMessageSend(ch, "✅ Test DM from QManager — your Discord bot is working."); err != nil {
				log.Printf("test DM send failed: %v", err)
				writeTestResult(false, "Discord rejected the message — make sure you've added the bot via the OAuth link.")
				continue
			}
			writeTestResult(true, "")
		}
	}
}

// discordCmd is the payload the shell alert engine (alert_engine.sh) writes to
// cmdPath: {"message":"..."}. The daemon delivers Message as an owner DM.
type discordCmd struct {
	Message string `json:"message"`
}

// appendDiscordLog appends one NDJSON result line to logPath, matching the
// timestamp format the shell logs use ("YYYY-MM-DD HH:MM:SS"). O_APPEND is used
// deliberately: a single sub-4KB line is written atomically on POSIX, so the
// daemon and any shell-side writer interleave cleanly without a lock.
func appendDiscordLog(trigger, status, recipient string) {
	line := fmt.Sprintf("{\"timestamp\":%q,\"trigger\":%q,\"status\":%q,\"recipient\":%q}\n",
		time.Now().Format("2006-01-02 15:04:05"), trigger, status, recipient)
	f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		log.Printf("cmd watcher: failed to open log %s: %v", logPath, err)
		return
	}
	defer f.Close()
	if _, err := f.WriteString(line); err != nil {
		log.Printf("cmd watcher: failed to append log: %v", err)
	}
}

// runCmdWatcher polls cmdPath for DM-send commands written by the shell alert
// engine. Structurally identical to runTestDMWatcher (1s ticker, stat/read/
// remove), but the payload carries the message to deliver. This is the daemon's
// pure-transport path: the shell state machine owns alert timing, the daemon
// just delivers the DM and records the result to the NDJSON log.
func runCmdWatcher(s *discordgo.Session, dmCh *dmChannelHolder, cfg *Config, stopCh <-chan struct{}) {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-stopCh:
			return
		case <-ticker.C:
			if _, err := os.Stat(cmdPath); err != nil {
				continue
			}
			data, readErr := os.ReadFile(cmdPath)
			os.Remove(cmdPath)
			if readErr != nil {
				log.Printf("cmd watcher: failed to read command file: %v", readErr)
				continue
			}

			var cmd discordCmd
			if err := json.Unmarshal(data, &cmd); err != nil {
				log.Printf("cmd watcher: malformed command payload, skipping: %v", err)
				continue
			}
			if cmd.Message == "" {
				log.Printf("cmd watcher: empty message, skipping")
				continue
			}

			ch := dmCh.get()
			if ch == "" {
				// Fallback: resolve the channel — may succeed if the owner has
				// since authorized the bot after startup.
				id, err := openDMChannel(s, cfg.OwnerDiscordID)
				if err != nil {
					log.Printf("cmd watcher: no DM channel available, dropping alert: %v", err)
					appendDiscordLog("alert", "failed", "discord")
					continue
				}
				dmCh.set(id)
				if err := saveDMChannelID(dmChannelPath, id); err != nil {
					log.Printf("warning: failed to persist DM channel: %v", err)
				}
				ch = id
			}

			if _, err := s.ChannelMessageSend(ch, cmd.Message); err != nil {
				log.Printf("cmd watcher: failed to send alert DM: %v", err)
				appendDiscordLog("alert", "failed", "discord")
				continue
			}
			appendDiscordLog("alert", "sent", "discord")
		}
	}
}
