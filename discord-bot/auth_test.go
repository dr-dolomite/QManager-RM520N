package main

import (
	"testing"

	"github.com/bwmarrin/discordgo"
)

func interactionFrom(user, member *discordgo.User) *discordgo.InteractionCreate {
	in := &discordgo.Interaction{User: user}
	if member != nil {
		in.Member = &discordgo.Member{User: member}
	}
	return &discordgo.InteractionCreate{Interaction: in}
}

func TestIsOwner(t *testing.T) {
	const owner = "111"
	cases := []struct {
		name    string
		i       *discordgo.InteractionCreate
		ownerID string
		want    bool
	}{
		{"owner in DM", interactionFrom(&discordgo.User{ID: owner}, nil), owner, true},
		{"owner in guild", interactionFrom(nil, &discordgo.User{ID: owner}), owner, true},
		{"stranger in DM", interactionFrom(&discordgo.User{ID: "222"}, nil), owner, false},
		{"stranger in guild", interactionFrom(nil, &discordgo.User{ID: "222"}), owner, false},
		{"no user at all", interactionFrom(nil, nil), owner, false},
		{"member without user", &discordgo.InteractionCreate{Interaction: &discordgo.Interaction{Member: &discordgo.Member{}}}, owner, false},
		{"empty user ID", interactionFrom(&discordgo.User{ID: ""}, nil), owner, false},
		{"empty owner ID fails closed", interactionFrom(&discordgo.User{ID: ""}, nil), "", false},
		{"empty owner, real user", interactionFrom(&discordgo.User{ID: "222"}, nil), "", false},
	}
	for _, c := range cases {
		if got := isOwner(c.i, c.ownerID); got != c.want {
			t.Errorf("%s: isOwner = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestInteractionUserID_PrefersUserOverMember(t *testing.T) {
	i := interactionFrom(&discordgo.User{ID: "dm"}, &discordgo.User{ID: "guild"})
	if got := interactionUserID(i); got != "dm" {
		t.Errorf("got %q, want %q", got, "dm")
	}
}

func modeOpt(v string) []*discordgo.ApplicationCommandInteractionDataOption {
	return []*discordgo.ApplicationCommandInteractionDataOption{
		{Name: "mode", Type: discordgo.ApplicationCommandOptionString, Value: v},
	}
}

func TestNetworkModeOption_AllowsOnlyChoices(t *testing.T) {
	for _, m := range []string{"AUTO", "LTE", "NR5G", "NR5G:LTE"} {
		if got, ok := networkModeOption(modeOpt(m)); !ok || got != m {
			t.Errorf("%q: got (%q, %v), want accepted", m, got, ok)
		}
	}
	for _, m := range []string{"", "auto", "LTE;AT+QPOWD=1", "AUTO\r\nAT+CFUN=0", "NR5G:LTE:WCDMA"} {
		if _, ok := networkModeOption(modeOpt(m)); ok {
			t.Errorf("%q: accepted, want rejected", m)
		}
	}
}

func TestNetworkModeOption_MissingOrWrongType(t *testing.T) {
	if _, ok := networkModeOption(nil); ok {
		t.Error("nil options accepted")
	}
	opts := []*discordgo.ApplicationCommandInteractionDataOption{
		{Name: "mode", Type: discordgo.ApplicationCommandOptionInteger, Value: float64(1)},
	}
	if _, ok := networkModeOption(opts); ok {
		t.Error("integer option accepted")
	}
}

func TestIsAutoBandInput(t *testing.T) {
	for _, in := range []string{"auto", "AUTO", " Auto "} {
		if !isAutoBandInput(in) {
			t.Errorf("%q: want auto", in)
		}
	}
	// Junk that parses to "" must not count as an unlock request.
	for _, in := range []string{"", "Bxx,Nyy", "autox", ","} {
		if isAutoBandInput(in) {
			t.Errorf("%q: want not auto", in)
		}
	}
}
