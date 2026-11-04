//! UIM (service 11) decoders. Fixtures from the RM551E, 2026-10-22.
//!
//! - 0x002F Get Card Status   TLV 0x10 (cards and their apps). The other
//!   TLVs (0x11..0x1A: hot-swap, ATR, eUICC flags) are not decoded.
//! - 0x0047 Get Slots Status  TLV 0x10 (physical slots). TLVs 0x11..0x13
//!   (ATR, EID, extended info) are not decoded.

use super::Rd;
use crate::qmi::msg::Msg;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CardState {
    Absent,
    Present,
    Error,
    Unknown,
}

impl CardState {
    pub fn as_str(self) -> &'static str {
        match self {
            CardState::Absent => "absent",
            CardState::Present => "present",
            CardState::Error => "error",
            CardState::Unknown => "unknown",
        }
    }
}

/// One application on a card. `app_type`: 1 SIM, 2 USIM, 3 RUIM, 4 CSIM,
/// 5 ISIM. `state`: 2 PIN required, 3 PUK required, 5 PIN1 blocked,
/// 7 ready (7 seen on device). `pin1_state`: 1 enabled-not-verified,
/// 2 enabled-verified, 3 disabled, 4 blocked, 5 permanently blocked.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct App {
    pub app_type: u8,
    pub state: u8,
    pub pin1_state: u8,
}

impl App {
    pub fn type_str(&self) -> &'static str {
        match self.app_type {
            1 => "sim",
            2 => "usim",
            3 => "ruim",
            4 => "csim",
            5 => "isim",
            _ => "unknown",
        }
    }

    pub fn state_str(&self) -> &'static str {
        match self.state {
            1 => "detected",
            2 => "pin_required",
            3 => "puk_required",
            4 => "personalization",
            5 => "pin_blocked",
            6 => "illegal",
            7 => "ready",
            _ => "unknown",
        }
    }

    pub fn pin1_str(&self) -> &'static str {
        match self.pin1_state {
            1 => "enabled_not_verified",
            2 => "enabled_verified",
            3 => "disabled",
            4 => "blocked",
            5 => "permanently_blocked",
            _ => "unknown",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Card {
    pub state: CardState,
    /// Raw error code, meaningful when `state` is Error.
    pub error_code: u8,
    pub apps: Vec<App>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CardStatus {
    pub cards: Vec<Card>,
}

pub fn card_status(m: &Msg) -> CardStatus {
    let mut out = CardStatus::default();
    let v = match m.tlv(0x10) {
        Some(v) => v,
        None => return out,
    };
    let mut r = Rd::new(v);
    // primary / secondary GW and 1x application indexes, then the count.
    let n = match (r.skip(8), r.u8()) {
        (Some(()), Some(n)) => n,
        _ => return out,
    };
    for _ in 0..n {
        let card = (|| {
            let state = match r.u8()? {
                0 => CardState::Absent,
                1 => CardState::Present,
                2 => CardState::Error,
                _ => CardState::Unknown,
            };
            r.skip(3)?; // UPIN state, UPIN retries, UPUK retries
            let error_code = r.u8()?;
            let na = r.u8()?;
            let mut apps = Vec::new();
            for _ in 0..na {
                let app_type = r.u8()?;
                let state = r.u8()?;
                r.skip(4)?; // perso state, feature, retries, unblock retries
                let aid = r.u8()? as usize;
                r.skip(aid)?;
                r.skip(1)?; // universal PIN
                let pin1_state = r.u8()?;
                r.skip(5)?; // pin1 retries, puk1 retries, pin2 state/retries/puk2
                apps.push(App { app_type, state, pin1_state });
            }
            Some(Card { state, error_code, apps })
        })();
        match card {
            Some(c) => out.cards.push(c),
            None => break,
        }
    }
    out
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Slot {
    /// 0 unknown, 1 absent, 2 present.
    pub card_state: u32,
    pub active: bool,
    pub logical_slot: u8,
    pub iccid: Option<String>,
}

impl Slot {
    pub fn card_str(&self) -> &'static str {
        match self.card_state {
            1 => "absent",
            2 => "present",
            _ => "unknown",
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SlotsStatus {
    pub slots: Vec<Slot>,
}

/// ICCID: swapped-nibble BCD, low nibble first, 0xF filler at the end.
/// None when empty or malformed.
pub fn iccid(b: &[u8]) -> Option<String> {
    let mut s = String::new();
    'o: for byte in b {
        for nib in [byte & 0xf, byte >> 4] {
            match nib {
                0..=9 => s.push((b'0' + nib) as char),
                0xf => break 'o,
                _ => return None,
            }
        }
    }
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

pub fn slots_status(m: &Msg) -> SlotsStatus {
    let mut out = SlotsStatus::default();
    let v = match m.tlv(0x10) {
        Some(v) => v,
        None => return out,
    };
    let mut r = Rd::new(v);
    let n = r.u8().unwrap_or(0);
    for _ in 0..n {
        let s = (|| {
            let card_state = r.u32()?;
            let slot_state = r.u32()?;
            let logical_slot = r.u8()?;
            let l = r.u8()? as usize;
            let id = r.take(l)?;
            Some(Slot { card_state, active: slot_state == 1, logical_slot, iccid: iccid(id) })
        })();
        match s {
            Some(s) => out.slots.push(s),
            None => break,
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::qmi::codec::testfix::{fx, mangled};

    #[test]
    fn card_status_fixture() {
        let c = card_status(&fx!("r1_11_0x002F"));
        assert_eq!(c.cards.len(), 1);
        assert_eq!(c.cards[0].state, CardState::Present);
        assert_eq!(c.cards[0].error_code, 0);
        let a = c.cards[0].apps[0];
        assert_eq!((a.type_str(), a.state_str(), a.pin1_str()), ("usim", "ready", "disabled"));
    }

    #[test]
    fn slots_fixture() {
        // The ICCID is synthetic in the committed fixture.
        let s = slots_status(&fx!("r1_11_0x0047"));
        assert_eq!(s.slots.len(), 2);
        assert_eq!(s.slots[0].card_str(), "present");
        assert!(s.slots[0].active);
        assert_eq!(s.slots[0].iccid.as_deref(), Some("89630300000000000015"));
        assert_eq!(s.slots[1].card_str(), "absent");
        assert!(!s.slots[1].active);
        assert_eq!(s.slots[1].iccid, None);
    }

    #[test]
    fn iccid_decoding() {
        assert_eq!(iccid(&[0x98, 0x36, 0x30]).as_deref(), Some("896303"));
        // 19 digits: the filler nibble ends it.
        assert_eq!(iccid(&[0x98, 0x36, 0xf3]).as_deref(), Some("89633"));
        assert_eq!(iccid(&[0x9a]), None);
        assert_eq!(iccid(&[]), None);
    }

    #[test]
    fn truncated_tlvs_never_panic() {
        for base in crate::qmi::codec::testfix::all() {
            for m in mangled(&base) {
                let _ = card_status(&m);
                let _ = slots_status(&m);
            }
        }
    }
}
