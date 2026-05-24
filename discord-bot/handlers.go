package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/bwmarrin/discordgo"
)

const (
	statusCachePath = "/tmp/qmanager_status.json"
	eventsCachePath = "/tmp/qmanager_events.json"
)

func buildSignalEmbed(s *ModemStatus) *discordgo.MessageEmbed {
	bucket := signalQualityBucket(s.SignalPerAntenna)
	primary := "LTE primary"
	if s.NrState == "connected" {
		primary = "NR primary"
	}
	descr := fmt.Sprintf("%s %s · %s · %s",
		qualityEmojiForBucket(bucket),
		capitalize(bucket),
		primary,
		signalQualityBars(bucket),
	)

	ports := []string{"main", "diversity", "mimo3", "mimo4"}
	labels := map[string]string{
		"main": "Main (PRX)", "diversity": "Diversity (DRX)",
		"mimo3": "MIMO 3 (RX2)", "mimo4": "MIMO 4 (RX3)",
	}
	var fields []*discordgo.MessageEmbedField
	pairCount := 0
	for _, port := range ports {
		ant, ok := s.SignalPerAntenna[port]
		if !ok {
			continue
		}
		portEmoji := perPortEmoji(ant.RSRP)
		// Trailing "\n​" adds a blank line below for vertical breathing.
		fields = append(fields, &discordgo.MessageEmbedField{
			Name: fmt.Sprintf("%s %s", portEmoji, labels[port]),
			Value: fmt.Sprintf("RSRP %s dBm  SINR %s dB\nRSRQ %s dB\n​",
				ifEmpty(ant.RSRP, "—"), ifEmpty(ant.SINR, "—"), ifEmpty(ant.RSRQ, "—"),
			),
			Inline: true,
		})
		pairCount++
		// After every 2 antennas, insert an invisible inline spacer so Discord
		// renders 2 content columns + 1 empty column per row (wider gutters).
		if pairCount%2 == 0 {
			fields = append(fields, spacerField())
		}
	}

	if note := provenanceNote(s); note != "" {
		fields = append(fields, &discordgo.MessageEmbedField{
			Name: "Source", Value: note, Inline: false,
		})
	}

	return &discordgo.MessageEmbed{
		Author:      authorBlock(s),
		Title:       "Signal Metrics",
		Description: descr,
		Color:       embedColor(s),
		Fields:      fields,
		Footer:      footerBlock(s),
		Timestamp:   time.Unix(s.CacheTime, 0).Format(time.RFC3339),
	}
}


func qualityEmojiForBucket(b string) string {
	switch b {
	case "excellent", "good":
		return emoji.Ok
	case "fair":
		return emoji.Warn
	case "poor":
		return emoji.Down
	default:
		return emoji.Unknown
	}
}

func perPortEmoji(rsrpStr string) string {
	if rsrpStr == "" {
		return emoji.Unknown
	}
	v, err := strconv.ParseFloat(rsrpStr, 64)
	if err != nil {
		return emoji.Unknown
	}
	switch {
	case v >= -90:
		return emoji.Ok
	case v >= -110:
		return emoji.Warn
	default:
		return emoji.Down
	}
}

func provenanceNote(s *ModemStatus) string {
	switch {
	case s.NrState == "connected" && s.LteState == "connected":
		return "Showing NR values (EN-DC active — LTE leg also connected)"
	case s.NrState == "connected":
		return "Showing NR values"
	case s.LteState == "connected":
		return "Showing LTE values"
	default:
		return ""
	}
}

const maxVisibleCCs = 6

func buildBandsEmbed(s *ModemStatus) *discordgo.MessageEmbed {
	descr := buildBandsDescription(s)
	color := embedColor(s)

	var fields []*discordgo.MessageEmbedField

	if len(s.CarrierComponents) == 0 {
		// Fallback — show whatever single-band data we have.
		if s.LteBand != "" {
			fields = append(fields, &discordgo.MessageEmbedField{
				Name: "LTE Band", Value: s.LteBand, Inline: true,
			})
		}
		if s.NrBand != "" {
			fields = append(fields, &discordgo.MessageEmbedField{
				Name: "NR Band", Value: s.NrBand, Inline: true,
			})
		}
	} else {
		visible := s.CarrierComponents
		if len(visible) > maxVisibleCCs {
			visible = visible[:maxVisibleCCs]
		}
		for _, cc := range visible {
			fields = append(fields, ccField(cc))
		}
		if len(s.CarrierComponents) > maxVisibleCCs {
			fields = append(fields, &discordgo.MessageEmbedField{
				Name:   "More carriers",
				Value:  fmt.Sprintf("+%d more — use Copy raw to view", len(s.CarrierComponents)-maxVisibleCCs),
				Inline: false,
			})
		}
	}

	if s.LteCellID != "" || s.NrCellID != "" {
		fields = append(fields, servingCellField(s), tacField(s))
	}

	return &discordgo.MessageEmbed{
		Author:      authorBlock(s),
		Title:       "Band Details",
		Description: descr,
		Color:       color,
		Fields:      fields,
		Footer:      footerBlock(s),
		Timestamp:   time.Unix(s.CacheTime, 0).Format(time.RFC3339),
	}
}

func buildBandsDescription(s *ModemStatus) string {
	if s.ModemReachable != "true" {
		return emoji.Down + " Modem unreachable"
	}
	stalePrefix := ""
	if s.CacheTime > 0 && time.Now().Unix()-s.CacheTime > embedStaleSecs {
		stalePrefix = emoji.Stale + " Stale · "
	}
	bw := s.TotalBandwidthMHz
	if bw == "" {
		bw = "?"
	}
	n := len(s.CarrierComponents)
	if n == 0 {
		return stalePrefix + emoji.Warn + " No CA data — single-carrier or modem report unavailable"
	}
	hasLte, hasNr := false, false
	for _, cc := range s.CarrierComponents {
		if cc.Technology == "LTE" {
			hasLte = true
		}
		if cc.Technology == "NR" {
			hasNr = true
		}
	}
	var label string
	switch {
	case hasLte && hasNr:
		label = "EN-DC active"
	case hasLte && n > 1:
		label = "LTE-A active"
	case hasNr && n > 1:
		label = "NR-CA active"
	default:
		label = "Single carrier"
	}
	if n == 1 {
		return fmt.Sprintf("%s%s %s • %s %s MHz", stalePrefix, emoji.Ok, label, emoji.NavBands, bw)
	}
	return fmt.Sprintf("%s%s %s • %s %s MHz total • %s %d carriers",
		stalePrefix, emoji.Ok, label, emoji.NavBands, bw, emoji.SCC, n)
}

func ccField(cc CarrierComponent) *discordgo.MessageEmbedField {
	arfcnLabel := "EARFCN"
	if cc.Technology == "NR" {
		arfcnLabel = "ARFCN"
	}
	name := fmt.Sprintf("%s %s · %s %s", ccEmoji(cc.Type, cc.Technology), cc.Type, cc.Technology, cc.Band)
	// Trailing "\n​" adds a blank line below for vertical breathing between rows.
	value := fmt.Sprintf("PCI %s\n%s %s\n%s MHz\nRSRP %s / SINR %s\n​",
		ifEmpty(cc.PCI, "—"),
		arfcnLabel, ifEmpty(cc.EARFCN, "—"),
		ifEmpty(cc.BandwidthMHz, "—"),
		ifEmpty(cc.RSRP, "—"), ifEmpty(cc.SINR, "—"),
	)
	return &discordgo.MessageEmbedField{Name: name, Value: value, Inline: true}
}

func servingCellField(s *ModemStatus) *discordgo.MessageEmbedField {
	parts := []string{}
	if s.LteCellID != "" {
		parts = append(parts, "LTE: "+s.LteCellID)
	}
	if s.NrCellID != "" {
		parts = append(parts, "NR: "+s.NrCellID)
	}
	return &discordgo.MessageEmbedField{
		Name:   "Serving cell",
		Value:  strings.Join(parts, " · "),
		Inline: false,
	}
}

func tacField(s *ModemStatus) *discordgo.MessageEmbedField {
	parts := []string{}
	if s.LteTAC != "" || s.LteCellID != "" {
		parts = append(parts, fmt.Sprintf("LTE: %s (cell %s)", ifEmpty(s.LteTAC, "—"), ifEmpty(s.LteCellID, "—")))
	}
	if s.NrTAC != "" || s.NrCellID != "" {
		parts = append(parts, fmt.Sprintf("NR: %s (cell %s)", ifEmpty(s.NrTAC, "—"), ifEmpty(s.NrCellID, "—")))
	}
	return &discordgo.MessageEmbedField{
		Name:   "TAC / Cell ID",
		Value:  strings.Join(parts, " · "),
		Inline: false,
	}
}

func buildStatusEmbed(s *ModemStatus) *discordgo.MessageEmbed {
	descr := buildStatusDescription(s)
	color := embedColor(s)

	fields := []*discordgo.MessageEmbedField{
		connectionField(s),
		networkField(s),
		uptimeField(s),
		watchcatField(s),
		deviceMetricsField(s),
	}
	if scc := sccHandoffsField(s); scc != nil {
		fields = append(fields, scc)
	}

	return &discordgo.MessageEmbed{
		Author:      authorBlock(s),
		Title:       "Modem Status",
		Description: descr,
		Color:       color,
		Fields:      fields,
		Footer:      footerBlock(s),
		Timestamp:   time.Unix(s.CacheTime, 0).Format(time.RFC3339),
	}
}

func buildStatusDescription(s *ModemStatus) string {
	if s.ModemReachable != "true" {
		return emoji.Down + " Modem unreachable"
	}
	if s.ConnInternetAvailable == "false" {
		return emoji.Down + " Internet down · modem reachable"
	}
	if s.ConnInternetAvailable != "true" {
		return emoji.Unknown + " Connectivity unknown"
	}
	parts := []string{emoji.Ok + " Internet up"}
	if s.ConnLatency != "" {
		parts = append(parts, s.ConnLatency+" ms")
	}
	return strings.Join(parts, " · ")
}

func connectionField(s *ModemStatus) *discordgo.MessageEmbedField {
	state := "Up"
	if s.ConnInternetAvailable != "true" {
		state = "Down"
	}
	line1Parts := []string{state}
	if s.ConnLatency != "" {
		line1Parts = append(line1Parts, "· "+s.ConnLatency+" ms")
	}
	if s.ConnAvgLatency != "" || s.ConnJitter != "" {
		extra := []string{}
		if s.ConnAvgLatency != "" {
			extra = append(extra, "avg "+s.ConnAvgLatency)
		}
		if s.ConnJitter != "" {
			extra = append(extra, "jitter "+s.ConnJitter)
		}
		line1Parts = append(line1Parts, "("+strings.Join(extra, ", ")+")")
	}
	line2Parts := []string{}
	if s.ConnPacketLoss != "" {
		line2Parts = append(line2Parts, s.ConnPacketLoss+"% loss")
	}
	if s.PingTarget != "" {
		line2Parts = append(line2Parts, "ping "+s.PingTarget)
	}
	value := strings.Join(line1Parts, " ")
	if len(line2Parts) > 0 {
		value += "\n" + strings.Join(line2Parts, " · ")
	}
	return &discordgo.MessageEmbedField{
		Name: "Connection", Value: value, Inline: true,
	}
}

func networkField(s *ModemStatus) *discordgo.MessageEmbedField {
	line1 := []string{}
	if s.Operator != "" {
		line1 = append(line1, s.Operator)
	}
	if s.NetworkType != "" {
		line1 = append(line1, s.NetworkType)
	}
	if s.SimSlot != "" {
		line1 = append(line1, "SIM "+s.SimSlot)
	}
	value := strings.Join(line1, " · ")
	if s.WanIP != "" {
		value += "\nWAN " + s.WanIP
	}
	return &discordgo.MessageEmbedField{
		Name: "Network", Value: ifEmpty(value, "—"), Inline: true,
	}
}

func uptimeField(s *ModemStatus) *discordgo.MessageEmbedField {
	value := fmt.Sprintf("Connection: %s\nDevice: %s",
		ifEmpty(s.ConnUptime, "—"), ifEmpty(s.Uptime, "—"))
	return &discordgo.MessageEmbedField{
		Name: "Uptime", Value: value, Inline: true,
	}
}

func watchcatField(s *ModemStatus) *discordgo.MessageEmbedField {
	state := s.WatchcatState
	if state == "" {
		state = "Unknown"
	}
	failures := ifEmpty(s.WatchcatFailures, "0")
	last := "never"
	if s.WatchcatLastTime != "" && s.WatchcatLastTime != "0" {
		if ts, err := strconv.ParseInt(s.WatchcatLastTime, 10, 64); err == nil && ts > 0 {
			last = relativeTime(ts)
		}
	}
	value := fmt.Sprintf("%s · %s failures\nLast recovery: %s", state, failures, last)
	return &discordgo.MessageEmbedField{
		Name: "Watchcat", Value: value, Inline: true,
	}
}

func deviceMetricsField(s *ModemStatus) *discordgo.MessageEmbedField {
	parts := []string{}
	if s.CpuUsage != "" {
		parts = append(parts, "CPU "+s.CpuUsage+"%")
	}
	if s.CpuTemp != "" {
		parts = append(parts, s.CpuTemp)
	}
	if s.MemUsedMB != "" && s.MemTotalMB != "" {
		parts = append(parts, "Mem "+s.MemUsedMB+"/"+s.MemTotalMB+" MB")
	}
	return &discordgo.MessageEmbedField{
		Name: "Device", Value: ifEmpty(strings.Join(parts, " · "), "—"), Inline: true,
	}
}

// sccHandoffsField returns a field summarizing scc_pci_change events in the
// last 24h, or nil if events log unreadable / no events.
func sccHandoffsField(s *ModemStatus) *discordgo.MessageEmbedField {
	count, err := countSccHandoffs24h(eventsCachePath)
	if err != nil || count == 0 {
		return nil
	}
	return &discordgo.MessageEmbedField{
		Name:   "SCC handoffs (24h)",
		Value:  fmt.Sprintf("%d PCI changes detected", count),
		Inline: true,
	}
}

func countSccHandoffs24h(path string) (int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	cutoff := time.Now().Unix() - 86400
	count := 0
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		var ev Event
		if json.Unmarshal(line, &ev) != nil {
			continue
		}
		if ev.Type == "scc_pci_change" && ev.Timestamp >= cutoff {
			count++
		}
	}
	return count, sc.Err()
}

func buildEventsEmbed(events []Event, crit, warn, info, total int) *discordgo.MessageEmbed {
	if len(events) == 0 {
		return &discordgo.MessageEmbed{
			Title:       "Recent Events",
			Description: "No events recorded yet.",
			Color:       colorGray,
		}
	}
	descr := fmt.Sprintf("%s %d critical · %s %d warnings · ℹ️ %d info — last %d of %d",
		emoji.Down, crit, emoji.Warn, warn, info, len(events), total,
	)

	severityIcon := map[string]string{
		"info": "ℹ️", "warning": emoji.Warn, "critical": emoji.Down,
	}
	color := colorBlue
	worst := ""
	for _, ev := range events {
		switch ev.Severity {
		case "critical":
			worst = "critical"
		case "warning":
			if worst != "critical" {
				worst = "warning"
			}
		}
	}
	switch worst {
	case "critical":
		color = colorRed
	case "warning":
		color = colorAmber
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
		Description: descr + "\n\n" + strings.Join(lines, "\n"),
		Color:       color,
		Footer:      &discordgo.MessageEmbedFooter{Text: "QManager"},
	}
}

func ifEmpty(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

func runQcmd(atCmd string) (string, bool) {
	out, err := exec.Command("/usr/bin/qcmd", atCmd).CombinedOutput()
	if err != nil {
		log.Printf("qcmd exec error (%s): %v", atCmd, err)
	}
	response := strings.TrimSpace(string(out))
	return response, strings.Contains(response, "OK")
}

func handleInteraction(s *discordgo.Session, i *discordgo.InteractionCreate) {
	switch i.Type {
	case discordgo.InteractionApplicationCommand:
		handleCommand(s, i)
	case discordgo.InteractionMessageComponent:
		handleComponent(s, i)
	}
}

// captureDMFromInteraction extracts the DM channel ID when the owner invokes a
// slash command in their BotDM context. Discord does not deliver MESSAGE_CREATE
// Gateway events to user-installed apps (applications.commands scope only), but
// InteractionCreate IS delivered and carries the ChannelID of the invoking channel.
//
// Note: discordgo v0.28.1 does not expose discordgo.InteractionContextBotDM, so
// we fall back to GuildID == "" as the BotDM signal. Guild-installed commands
// always have a non-empty GuildID, so this correctly filters out guild invocations.
// Any other DM (e.g. a shared-DM channel that isn't ours) can't be targeted by
// ChannelMessageSend anyway, so the GuildID check is sufficient in practice.
func captureDMFromInteraction(i *discordgo.InteractionCreate, dmCh *dmChannelHolder, ownerID string) {
	// Resolve the invoking user — User is populated in DM context, Member.User in guild context.
	var userID string
	if i.User != nil {
		userID = i.User.ID
	} else if i.Member != nil && i.Member.User != nil {
		userID = i.Member.User.ID
	}
	if userID != ownerID {
		return
	}
	// Only capture when invoked in a DM (no guild). GuildID is empty for both
	// BotDM and PrivateChannel (shared user DM) contexts. We accept both here;
	// PrivateChannel IDs cannot be messaged by the bot, but they're rare and the
	// worst outcome is a failed ChannelMessageSend that triggers the fallback path.
	if i.GuildID != "" {
		return
	}
	chID := i.ChannelID
	if chID == "" || chID == dmCh.get() {
		return
	}
	dmCh.set(chID)
	if err := saveDMChannelID(dmChannelPath, chID); err != nil {
		log.Printf("warning: failed to persist captured DM channel: %v", err)
		return
	}
	log.Printf("captured DM channel from interaction: %s", chID)
}

func handleCommand(s *discordgo.Session, i *discordgo.InteractionCreate) {
	name := i.ApplicationCommandData().Name
	log.Printf("[interaction] cmd=%s id=%s", name, i.ID)
	switch name {
	case "signal":
		handleSignal(s, i)
	case "bands":
		handleBands(s, i)
	case "status":
		handleStatus(s, i)
	case "events":
		handleEvents(s, i)
	case "device":
		handleDevice(s, i)
	case "sim":
		handleSim(s, i)
	case "watchcat":
		handleWatchcat(s, i)
	case "reboot":
		handleReboot(s, i)
	case "lock-band":
		handleLockBand(s, i)
	case "network-mode":
		handleNetworkMode(s, i)
	}
}

func respondEmbed(s *discordgo.Session, i *discordgo.InteractionCreate, embed *discordgo.MessageEmbed) {
	if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{Embeds: []*discordgo.MessageEmbed{embed}},
	}); err != nil {
		log.Printf("InteractionRespond error: %v", err)
	}
}

func respondError(s *discordgo.Session, i *discordgo.InteractionCreate, msg string) {
	if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{Content: "❌ " + msg},
	}); err != nil {
		log.Printf("InteractionRespond error: %v", err)
	}
}

func handleSignal(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ms, err := readStatus(statusCachePath)
	if err != nil {
		respondError(s, i, "Could not read modem status cache.")
		return
	}
	respondEmbedWithButtons(s, i, buildSignalEmbed(ms), "signal")
}

func handleBands(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ms, err := readStatus(statusCachePath)
	if err != nil {
		respondError(s, i, "Could not read modem status cache.")
		return
	}
	respondEmbedWithButtons(s, i, buildBandsEmbed(ms), "bands")
}

func handleStatus(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ms, err := readStatus(statusCachePath)
	if err != nil {
		respondError(s, i, "Could not read modem status cache.")
		return
	}
	respondEmbedWithButtons(s, i, buildStatusEmbed(ms), "status")
}

func handleEvents(s *discordgo.Session, i *discordgo.InteractionCreate) {
	events, err := readEvents(eventsCachePath)
	if err != nil {
		log.Printf("readEvents error: %v", err)
		events = []Event{}
	}
	crit, warn, info, total, _ := readEventCounts(eventsCachePath)
	respondEmbedWithButtons(s, i, buildEventsEmbed(events, crit, warn, info, total), "events")
}

// parseBandOption converts user input (e.g. "B3,B28" or "n78") to AT format
// (e.g. "3:28" or "78"). Accepts commas (preferred) or colons (legacy) as
// separators. Strips B/b (LTE) and n/N (NR) prefixes. Sorts band numbers
// ascending so the modem always sees a canonical order regardless of how the
// user typed them. Duplicate band numbers and non-numeric tokens are dropped.
// Returns "" for "auto" (caller sends "0" = all bands = unlock).
func parseBandOption(input string) string {
	if strings.EqualFold(strings.TrimSpace(input), "auto") {
		return ""
	}
	// Accept either "," (preferred) or ":" (legacy) as separator.
	normalized := strings.ReplaceAll(input, ":", ",")
	parts := strings.Split(normalized, ",")
	nums := make([]int, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		upper := strings.ToUpper(p)
		if strings.HasPrefix(upper, "B") || strings.HasPrefix(upper, "N") {
			p = upper[1:]
		}
		if p == "" {
			continue
		}
		n, err := strconv.Atoi(p)
		if err != nil {
			continue // skip non-numeric tokens defensively
		}
		nums = append(nums, n)
	}
	sort.Ints(nums)
	nums = slices.Compact(nums)
	clean := make([]string, 0, len(nums))
	for _, n := range nums {
		clean = append(clean, strconv.Itoa(n))
	}
	return strings.Join(clean, ":")
}

func handleReboot(s *discordgo.Session, i *discordgo.InteractionCreate) {
	if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
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
	}); err != nil {
		log.Printf("InteractionRespond error (reboot): %v", err)
	}
	go func() {
		time.Sleep(30 * time.Second)
		disabledRow := discordgo.ActionsRow{
			Components: []discordgo.MessageComponent{
				discordgo.Button{Label: "Confirm Reboot", Style: discordgo.DangerButton, CustomID: "reboot_confirm", Disabled: true},
				discordgo.Button{Label: "Cancel", Style: discordgo.SecondaryButton, CustomID: "reboot_cancel", Disabled: true},
			},
		}
		content := "⚠️ **Reboot the modem?** *(expired)*"
		_, err := s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
			Content:    &content,
			Components: &[]discordgo.MessageComponent{disabledRow},
		})
		if err != nil {
			log.Printf("InteractionResponseEdit error (reboot expiry): %v", err)
		}
	}()
}

func handleComponent(s *discordgo.Session, i *discordgo.InteractionCreate) {
	if dispatchQmComponent(s, i) {
		return
	}
	switch i.MessageComponentData().CustomID {
	case "reboot_confirm":
		if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseDeferredMessageUpdate,
		}); err != nil {
			log.Printf("InteractionRespond error (reboot_confirm defer): %v", err)
		}
		_, ok := runQcmd(`AT+QPOWD=1`)
		content := "✅ Reboot command sent. Reconnecting in ~30s..."
		if !ok {
			content = "❌ Reboot command failed. Check modem status."
		}
		disabledRow := discordgo.ActionsRow{
			Components: []discordgo.MessageComponent{
				discordgo.Button{Label: "Confirm Reboot", Style: discordgo.DangerButton, CustomID: "reboot_confirm", Disabled: true},
				discordgo.Button{Label: "Cancel", Style: discordgo.SecondaryButton, CustomID: "reboot_cancel", Disabled: true},
			},
		}
		_, errEdit := s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
			Content:    &content,
			Components: &[]discordgo.MessageComponent{disabledRow},
		})
		if errEdit != nil {
			log.Printf("InteractionResponseEdit error (reboot_confirm): %v", errEdit)
		}
	case "reboot_cancel":
		content := "Reboot cancelled."
		disabledRow := discordgo.ActionsRow{
			Components: []discordgo.MessageComponent{
				discordgo.Button{Label: "Confirm Reboot", Style: discordgo.DangerButton, CustomID: "reboot_confirm", Disabled: true},
				discordgo.Button{Label: "Cancel", Style: discordgo.SecondaryButton, CustomID: "reboot_cancel", Disabled: true},
			},
		}
		if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseUpdateMessage,
			Data: &discordgo.InteractionResponseData{
				Content:    content,
				Components: []discordgo.MessageComponent{disabledRow},
			},
		}); err != nil {
			log.Printf("InteractionRespond error (reboot_cancel): %v", err)
		}
	}
}

func handleLockBand(s *discordgo.Session, i *discordgo.InteractionCreate) {
	if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseDeferredChannelMessageWithSource,
	}); err != nil {
		log.Printf("InteractionRespond error (lock-band defer): %v", err)
	}

	opts := i.ApplicationCommandData().Options
	optMap := map[string]string{}
	for _, o := range opts {
		optMap[o.Name] = o.StringValue()
	}

	var results []string

	if lteBandInput, ok := optMap["lte_bands"]; ok {
		parsed := parseBandOption(lteBandInput)
		atVal := parsed
		if atVal == "" {
			atVal = "0" // 0 = all bands (unlock)
		}
		_, cmdOK := runQcmd(fmt.Sprintf(`AT+QNWPREFCFG="lte_band",%s`, atVal))
		if cmdOK {
			if parsed == "" {
				results = append(results, "LTE: unlocked (auto)")
			} else {
				display := "B" + strings.ReplaceAll(parsed, ":", "/B")
				results = append(results, fmt.Sprintf("LTE: locked to %s", display))
			}
		} else {
			results = append(results, "LTE: command failed")
		}
	}

	if nrBandInput, ok := optMap["nr_bands"]; ok {
		parsed := parseBandOption(nrBandInput)
		atVal := parsed
		if atVal == "" {
			atVal = "0"
		}
		_, cmdOK := runQcmd(fmt.Sprintf(`AT+QNWPREFCFG="nr5g_band",%s`, atVal))
		if cmdOK {
			if parsed == "" {
				results = append(results, "NR: unlocked (auto)")
			} else {
				display := "n" + strings.ReplaceAll(parsed, ":", "/n")
				results = append(results, fmt.Sprintf("NR: locked to %s", display))
			}
		} else {
			results = append(results, "NR: command failed")
		}
	}

	if len(results) == 0 {
		results = append(results, "No bands specified. Use lte_bands and/or nr_bands options.")
	}

	content := "🔒 Band lock result:\n" + strings.Join(results, "\n")
	_, errEdit := s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{Content: &content})
	if errEdit != nil {
		log.Printf("InteractionResponseEdit error (lock-band): %v", errEdit)
	}
}

func handleNetworkMode(s *discordgo.Session, i *discordgo.InteractionCreate) {
	if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseDeferredChannelMessageWithSource,
	}); err != nil {
		log.Printf("InteractionRespond error (network-mode defer): %v", err)
	}

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
	_, errEdit := s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{Content: &content})
	if errEdit != nil {
		log.Printf("InteractionResponseEdit error (network-mode): %v", errEdit)
	}
}

// embedForSource routes a source string from a custom ID to a freshly-built
// embed of that type. Unknown sources return nil. Note: "events" is NOT
// routed here because buildEventsEmbed needs different inputs (events list
// + severity counts) than *ModemStatus alone — see handleRefreshOrNav for
// the events-specific branch.
func embedForSource(source string, s *ModemStatus) *discordgo.MessageEmbed {
	switch source {
	case "signal":
		return buildSignalEmbed(s)
	case "bands":
		return buildBandsEmbed(s)
	case "status":
		return buildStatusEmbed(s)
	case "device":
		return buildDeviceEmbed(s)
	case "sim":
		return buildSimEmbed(s)
	case "watchcat":
		return buildWatchcatEmbed(s)
	}
	return nil
}

// rawSliceFor returns the JSON subset relevant to a given source, used by
// the Copy raw button. raw is the bytes from /tmp/qmanager_status.json.
func rawSliceFor(source string, raw []byte) ([]byte, error) {
	var full map[string]json.RawMessage
	if err := json.Unmarshal(raw, &full); err != nil {
		return nil, err
	}
	keys := map[string][]string{
		"signal":   {"signal_per_antenna", "lte", "nr"},
		"bands":    {"network", "lte", "nr"},
		"status":   {"connectivity", "device", "network", "watchcat"},
		"device":   {"device"},
		"sim":      {"network", "device"},
		"watchcat": {"watchcat"},
		"events":   {},
	}
	wanted, ok := keys[source]
	if !ok {
		return raw, nil
	}
	out := make(map[string]json.RawMessage, len(wanted))
	for _, k := range wanted {
		if v, ok := full[k]; ok {
			out[k] = v
		}
	}
	return json.MarshalIndent(out, "", "  ")
}

const maxRawLen = 3900 // leave room for ```json fences (Discord cap is 4000)

// respondEmbedWithButtons sends an initial embed response with the action row
// for `source`, then schedules the auto-disable timer.
func respondEmbedWithButtons(s *discordgo.Session, i *discordgo.InteractionCreate, embed *discordgo.MessageEmbed, source string) {
	row := buildActionRow(source)
	start := time.Now()
	err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Embeds:     []*discordgo.MessageEmbed{embed},
			Components: []discordgo.MessageComponent{row},
		},
	})
	log.Printf("[interaction] respond source=%s elapsed=%s err=%v", source, time.Since(start), err)
	if err != nil {
		return
	}
	scheduleButtonExpiry(s, i.Interaction, source, embed)
}

// respondEmbedEphemeral is like respondEmbedWithButtons but sets the
// ephemeral flag. Used by /sim.
func respondEmbedEphemeral(s *discordgo.Session, i *discordgo.InteractionCreate, embed *discordgo.MessageEmbed, source string) {
	row := buildActionRow(source)
	start := time.Now()
	err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Embeds:     []*discordgo.MessageEmbed{embed},
			Components: []discordgo.MessageComponent{row},
			Flags:      discordgo.MessageFlagsEphemeral,
		},
	})
	log.Printf("[interaction] respond ephemeral source=%s elapsed=%s err=%v", source, time.Since(start), err)
	if err != nil {
		return
	}
	scheduleButtonExpiry(s, i.Interaction, source, embed)
}

// dispatchQmComponent handles "qm:<action>:<source>" component clicks.
// Returns true if the click was a qm: ID (handled), false if not.
func dispatchQmComponent(s *discordgo.Session, i *discordgo.InteractionCreate) bool {
	action, source, ok := parseCustomID(i.MessageComponentData().CustomID)
	if !ok {
		return false
	}
	switch action {
	case "refresh", "nav":
		handleRefreshOrNav(s, i, source)
	case "raw":
		handleCopyRaw(s, i, source)
	default:
		log.Printf("dispatchQmComponent: unknown action %q (source=%q)", action, source)
		_ = s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseChannelMessageWithSource,
			Data: &discordgo.InteractionResponseData{
				Content: "❌ Unknown button action. Try running the command again.",
				Flags:   discordgo.MessageFlagsEphemeral,
			},
		})
	}
	return true
}

func handleRefreshOrNav(s *discordgo.Session, i *discordgo.InteractionCreate, source string) {
	if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseDeferredMessageUpdate,
	}); err != nil {
		log.Printf("defer error: %v", err)
		return
	}
	ms, err := readStatus(statusCachePath)
	if err != nil && source != "events" {
		failTitle := capitalize(source)
		if failTitle == "" {
			failTitle = "Refresh"
		}
		failEmbed := &discordgo.MessageEmbed{
			Title:       failTitle,
			Description: emoji.Down + " Refresh failed — cache unreadable",
			Color:       colorRed,
		}
		row := buildActionRow(source)
		_, _ = s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
			Embeds:     &[]*discordgo.MessageEmbed{failEmbed},
			Components: &[]discordgo.MessageComponent{row},
		})
		return
	}
	var embed *discordgo.MessageEmbed
	if source == "events" {
		events, _ := readEvents(eventsCachePath)
		if events == nil {
			events = []Event{}
		}
		crit, warn, info, total, _ := readEventCounts(eventsCachePath)
		embed = buildEventsEmbed(events, crit, warn, info, total)
	} else {
		embed = embedForSource(source, ms)
	}
	if embed == nil {
		log.Printf("handleRefreshOrNav: unknown source %q", source)
		failEmbed := &discordgo.MessageEmbed{
			Title:       "Refresh",
			Description: emoji.Down + " Unknown view — cannot refresh.",
			Color:       colorRed,
		}
		row := buildActionRow(source) // builds a row even for unknown source — harmless
		_, _ = s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
			Embeds:     &[]*discordgo.MessageEmbed{failEmbed},
			Components: &[]discordgo.MessageComponent{row},
		})
		return
	}
	row := buildActionRow(source)
	if _, err := s.InteractionResponseEdit(i.Interaction, &discordgo.WebhookEdit{
		Embeds:     &[]*discordgo.MessageEmbed{embed},
		Components: &[]discordgo.MessageComponent{row},
	}); err != nil {
		log.Printf("InteractionResponseEdit error (%s/%s): %v", "refresh-or-nav", source, err)
	}
}

func handleCopyRaw(s *discordgo.Session, i *discordgo.InteractionCreate, source string) {
	raw, err := os.ReadFile(statusCachePath)
	if err != nil {
		_ = s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseChannelMessageWithSource,
			Data: &discordgo.InteractionResponseData{
				Content: "❌ Could not read cache file.",
				Flags:   discordgo.MessageFlagsEphemeral,
			},
		})
		return
	}
	slice, err := rawSliceFor(source, raw)
	if err != nil {
		slice = raw
	}
	body := string(slice)
	truncated := ""
	if len(body) > maxRawLen {
		body = body[:maxRawLen]
		truncated = "\n… (truncated)"
	}
	content := "```json\n" + body + "\n```" + truncated
	if err := s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseChannelMessageWithSource,
		Data: &discordgo.InteractionResponseData{
			Content: content,
			Flags:   discordgo.MessageFlagsEphemeral,
		},
	}); err != nil {
		log.Printf("InteractionRespond error (raw %s): %v", source, err)
	}
}

func buildDeviceEmbed(s *ModemStatus) *discordgo.MessageEmbed {
	descr := strings.TrimSpace(strings.Join([]string{s.Model, s.Firmware, "Cat " + s.LteCategory}, " · "))
	if s.LteCategory == "" {
		descr = strings.TrimSpace(strings.Join([]string{s.Model, s.Firmware}, " · "))
	}
	fields := []*discordgo.MessageEmbedField{
		{Name: "Model", Value: ifEmpty(s.Model, "—"), Inline: true},
		{Name: "Manufacturer", Value: ifEmpty(s.Manufacturer, "—"), Inline: true},
		{Name: "IMEI", Value: ifEmpty(s.IMEI, "—"), Inline: true},
		{Name: "Firmware", Value: ifEmpty(s.Firmware, "—"), Inline: true},
		{Name: "Build date", Value: ifEmpty(s.BuildDate, "—"), Inline: true},
		{Name: "MIMO config", Value: ifEmpty(s.MIMO, "—"), Inline: true},
		{Name: "Supported LTE bands", Value: ifEmpty(s.SupportedLteBands, "—"), Inline: false},
		{Name: "Supported NR (NSA)", Value: ifEmpty(s.SupportedNsaBands, "—"), Inline: false},
		{Name: "Supported NR (SA)", Value: ifEmpty(s.SupportedSaBands, "—"), Inline: false},
	}
	return &discordgo.MessageEmbed{
		Author:      authorBlock(s),
		Title:       "Device Info",
		Description: descr,
		Color:       embedColor(s),
		Fields:      fields,
		Footer:      footerBlock(s),
		Timestamp:   time.Unix(s.CacheTime, 0).Format(time.RFC3339),
	}
}

func handleDevice(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ms, err := readStatus(statusCachePath)
	if err != nil {
		respondError(s, i, "Could not read modem status cache.")
		return
	}
	respondEmbedWithButtons(s, i, buildDeviceEmbed(ms), "device")
}

func buildSimEmbed(s *ModemStatus) *discordgo.MessageEmbed {
	descr := fmt.Sprintf("SIM %s · %s · APN %s",
		ifEmpty(s.SimSlot, "?"), ifEmpty(s.Operator, "?"), ifEmpty(s.APN, "?"))
	fields := []*discordgo.MessageEmbedField{
		{Name: "Slot", Value: ifEmpty(s.SimSlot, "—"), Inline: true},
		{Name: "Carrier", Value: ifEmpty(s.Operator, "—"), Inline: true},
		{Name: "APN", Value: ifEmpty(s.APN, "—"), Inline: true},
		{Name: "ICCID", Value: ifEmpty(s.ICCID, "—"), Inline: true},
		{Name: "IMSI", Value: ifEmpty(s.IMSI, "—"), Inline: true},
		{Name: "Phone", Value: ifEmpty(s.PhoneNumber, "—"), Inline: true},
	}
	return &discordgo.MessageEmbed{
		Author:      authorBlock(s),
		Title:       "SIM Details",
		Description: descr,
		Color:       embedColor(s),
		Fields:      fields,
		Footer:      footerBlock(s),
		Timestamp:   time.Unix(s.CacheTime, 0).Format(time.RFC3339),
	}
}

func handleSim(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ms, err := readStatus(statusCachePath)
	if err != nil {
		respondError(s, i, "Could not read modem status cache.")
		return
	}
	respondEmbedEphemeral(s, i, buildSimEmbed(ms), "sim")
}

func buildWatchcatEmbed(s *ModemStatus) *discordgo.MessageEmbed {
	state := ifEmpty(s.WatchcatState, "unknown")
	tier := ifEmpty(s.WatchcatTier, "?")
	failures := ifEmpty(s.WatchcatFailures, "0")
	stateEmoji := emoji.Ok
	switch s.WatchcatState {
	case "escalated":
		stateEmoji = emoji.Down
	case "monitoring":
		stateEmoji = emoji.Warn
	}
	descr := fmt.Sprintf("%s Watchcat %s · Tier %s · %s failures",
		stateEmoji, state, tier, failures)

	last := "Never"
	if s.WatchcatLastTime != "" && s.WatchcatLastTime != "0" {
		if ts, err := strconv.ParseInt(s.WatchcatLastTime, 10, 64); err == nil && ts > 0 {
			last = relativeTime(ts)
		}
	}

	fields := []*discordgo.MessageEmbedField{
		{Name: "Enabled", Value: yesNo(s.WatchcatEnabled), Inline: true},
		{Name: "State", Value: state, Inline: true},
		{Name: "Current tier", Value: tier, Inline: true},
		{Name: "Failure count", Value: failures, Inline: true},
		{Name: "Total recoveries", Value: ifEmpty(s.WatchcatTotal, "0"), Inline: true},
		{Name: "Last recovery", Value: last, Inline: true},
	}
	if s.WatchcatLastTime != "" && s.WatchcatLastTime != "0" && s.WatchcatLastTier != "" {
		fields = append(fields, &discordgo.MessageEmbedField{
			Name: "Last recovery tier", Value: s.WatchcatLastTier, Inline: false,
		})
	}

	return &discordgo.MessageEmbed{
		Author:      authorBlock(s),
		Title:       "Watchcat Status",
		Description: descr,
		Color:       embedColor(s),
		Fields:      fields,
		Footer:      footerBlock(s),
		Timestamp:   time.Unix(s.CacheTime, 0).Format(time.RFC3339),
	}
}

func yesNo(b string) string {
	if b == "true" {
		return "Yes"
	}
	return "No"
}

func handleWatchcat(s *discordgo.Session, i *discordgo.InteractionCreate) {
	ms, err := readStatus(statusCachePath)
	if err != nil {
		respondError(s, i, "Could not read modem status cache.")
		return
	}
	respondEmbedWithButtons(s, i, buildWatchcatEmbed(ms), "watchcat")
}
