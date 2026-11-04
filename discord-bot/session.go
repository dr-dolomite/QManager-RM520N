package main

import (
	"encoding/base64"
	"errors"
	"log"
	"os"
	"strings"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/gorilla/websocket"
)

const (
	connectBackoffMin = 10 * time.Second
	connectBackoffMax = 300 * time.Second
	// wsCloseAuthFailed is the gateway close code for a rejected token.
	wsCloseAuthFailed = 4004
)

// isAuthFailure reports a gateway close 4004 ("Authentication failed"), the
// only Open error that retrying cannot fix.
func isAuthFailure(err error) bool {
	var ce *websocket.CloseError
	return errors.As(err, &ce) && ce.Code == wsCloseAuthFailed
}

// connectWithRetry opens a gateway session, retrying with 10 s doubling to 300 s
// until it connects. A rejected token exits non-zero; a signal on sig returns nil.
func connectWithRetry(token, appID string, sig <-chan os.Signal) *discordgo.Session {
	delay := connectBackoffMin
	for {
		// Fresh session per attempt: a failed Open can leave session state behind.
		s, err := newSession(token)
		if err != nil {
			writeStatus(statusPath, BotStatus{Connected: false, Error: "session_error", AppID: appID})
			log.Fatalf("failed to create Discord session: %v", err)
		}
		s.AddHandler(func(s *discordgo.Session, r *discordgo.Ready) {
			log.Printf("Discord bot ready: %s#%s", r.User.Username, r.User.Discriminator)
			writeStatus(statusPath, BotStatus{Connected: true, LatencyMs: int(s.HeartbeatLatency().Milliseconds()), AppID: appID})
		})

		// Open runs in a goroutine so a signal is not held up by the dial timeout.
		opened := make(chan error, 1)
		go func() { opened <- s.Open() }()
		select {
		case err = <-opened:
		case <-sig:
			return nil
		}
		if err == nil {
			return s
		}
		if isAuthFailure(err) {
			writeStatus(statusPath, BotStatus{Connected: false, Error: "invalid_token", AppID: appID})
			log.Fatalf("Discord rejected the bot token: %v", err)
		}

		log.Printf("failed to open Discord session, retrying in %s: %v", delay, err)
		writeStatus(statusPath, BotStatus{Connected: false, Error: "connecting", AppID: appID})
		select {
		case <-time.After(delay):
		case <-sig:
			return nil
		}
		if delay *= 2; delay > connectBackoffMax {
			delay = connectBackoffMax
		}
	}
}

// appIDFromToken extracts the Discord application ID from the bot token.
// Discord bot tokens are: base64(app_id) + "." + timestamp + "." + hmac
func appIDFromToken(token string) string {
	parts := strings.SplitN(token, ".", 3)
	if len(parts) < 3 {
		return ""
	}
	decoded, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return ""
	}
	return string(decoded)
}

// openDMChannel creates (or retrieves existing) DM channel with the owner.
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
