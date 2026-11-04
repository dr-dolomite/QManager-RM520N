//! QMI service message codec (ported from qmi_probe/src/qrtr.rs).
//!
//! Over QRTR there is no QMUX header: a datagram is the 7-byte service header
//! `kind:u8 txn:u16 msg_id:u16 len:u16` (little endian) and `len` bytes of
//! TLVs, each `type:u8 len:u16 value`.

use super::error::QmiError;

pub const KIND_REQ: u8 = 0x00;
pub const KIND_RESP: u8 = 0x02;
pub const KIND_IND: u8 = 0x04;

pub const HDR_LEN: usize = 7;
/// The result TLV every response carries: `status:u16 error:u16`.
pub const TLV_RESULT: u8 = 0x02;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tlv {
    pub t: u8,
    pub v: Vec<u8>,
}

impl Tlv {
    #[allow(dead_code)] // request builder for the indication registration
    pub fn new(t: u8, v: &[u8]) -> Tlv {
        Tlv { t, v: v.to_vec() }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Msg {
    pub kind: u8,
    pub txn: u16,
    pub id: u16,
    pub tlvs: Vec<Tlv>,
}

/// What the result TLV says.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QmiResult {
    Ok,
    Err(u16),
    Missing,
}

impl Msg {
    pub fn tlv(&self, t: u8) -> Option<&[u8]> {
        self.tlvs.iter().find(|x| x.t == t).map(|x| x.v.as_slice())
    }

    pub fn result(&self) -> QmiResult {
        match self.tlv(TLV_RESULT) {
            Some(v) if v.len() >= 4 => {
                let st = u16::from_le_bytes([v[0], v[1]]);
                let ec = u16::from_le_bytes([v[2], v[3]]);
                if st == 0 {
                    QmiResult::Ok
                } else {
                    QmiResult::Err(ec)
                }
            }
            _ => QmiResult::Missing,
        }
    }

    /// The response itself when the result TLV says success, else the typed
    /// error.
    pub fn into_result(self) -> Result<Msg, QmiError> {
        match self.result() {
            QmiResult::Ok => Ok(self),
            QmiResult::Err(ec) => Err(QmiError::from_qmi(ec)),
            QmiResult::Missing => Err(QmiError::CommandFailed(None)),
        }
    }
}

/// Encoded size of a TLV list's body.
pub fn tlvs_len(tlvs: &[Tlv]) -> usize {
    tlvs.iter().map(|t| 3 + t.v.len()).sum()
}

/// Encodes one message. Callers bound the body (the registry caps requests
/// far below u16::MAX).
pub fn encode(kind: u8, txn: u16, id: u16, tlvs: &[Tlv]) -> Vec<u8> {
    let body = tlvs_len(tlvs);
    let mut pkt = Vec::with_capacity(HDR_LEN + body);
    pkt.push(kind);
    pkt.extend_from_slice(&txn.to_le_bytes());
    pkt.extend_from_slice(&id.to_le_bytes());
    pkt.extend_from_slice(&(body as u16).to_le_bytes());
    for t in tlvs {
        pkt.push(t.t);
        pkt.extend_from_slice(&(t.v.len() as u16).to_le_bytes());
        pkt.extend_from_slice(&t.v);
    }
    pkt
}

/// Decodes one datagram. None when the header or its length is short; a
/// truncated trailing TLV is dropped, like the probe.
pub fn parse(b: &[u8]) -> Option<Msg> {
    if b.len() < HDR_LEN {
        return None;
    }
    let len = u16::from_le_bytes([b[5], b[6]]) as usize;
    let mut p = b.get(HDR_LEN..HDR_LEN + len)?;
    let mut tlvs = Vec::new();
    while p.len() >= 3 {
        let tl = u16::from_le_bytes([p[1], p[2]]) as usize;
        if 3 + tl > p.len() {
            break;
        }
        tlvs.push(Tlv { t: p[0], v: p[3..3 + tl].to_vec() });
        p = &p[3 + tl..];
    }
    Some(Msg {
        kind: b[0],
        txn: u16::from_le_bytes([b[1], b[2]]),
        id: u16::from_le_bytes([b[3], b[4]]),
        tlvs,
    })
}

/// A result TLV: success (None), or failure with error code `ec`.
#[allow(dead_code)] // response builder used by the fakes
pub fn result_tlv(ec: Option<u16>) -> Tlv {
    let (st, ec) = match ec {
        None => (0u16, 0u16),
        Some(ec) => (1, ec),
    };
    let mut v = st.to_le_bytes().to_vec();
    v.extend_from_slice(&ec.to_le_bytes());
    Tlv { t: TLV_RESULT, v }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_and_parse_round_trip() {
        let tlvs = vec![Tlv::new(0x01, &[0x08]), Tlv::new(0x10, &[1, 2, 3])];
        let b = encode(KIND_REQ, 0x1234, 0x005A, &tlvs);
        assert_eq!(&b[..7], &[0x00, 0x34, 0x12, 0x5A, 0x00, 10, 0]);
        let m = parse(&b).unwrap();
        assert_eq!((m.kind, m.txn, m.id), (KIND_REQ, 0x1234, 0x005A));
        assert_eq!(m.tlvs, tlvs);
        assert_eq!(m.tlv(0x10), Some(&[1u8, 2, 3][..]));
        assert_eq!(m.tlv(0x11), None);
    }

    #[test]
    fn short_or_truncated_datagrams() {
        assert!(parse(&[0x02, 1, 0, 0x24, 0]).is_none());
        // Declared length past the end of the buffer.
        assert!(parse(&[0x02, 1, 0, 0x24, 0, 9, 0, 1, 1, 0]).is_none());
        // A trailing TLV that claims more than is left is dropped.
        let m = parse(&[0x02, 1, 0, 0x24, 0, 7, 0, 0x01, 1, 0, 0xAA, 0x10, 9, 0]).unwrap();
        assert_eq!(m.tlvs, vec![Tlv::new(0x01, &[0xAA])]);
    }

    #[test]
    fn result_tlv_decoding() {
        let ok = parse(&encode(KIND_RESP, 1, 0x24, &[result_tlv(None)])).unwrap();
        assert_eq!(ok.result(), QmiResult::Ok);
        assert!(ok.into_result().is_ok());
        let bad = parse(&encode(KIND_RESP, 1, 0x24, &[result_tlv(Some(0x004A))])).unwrap();
        assert_eq!(bad.result(), QmiResult::Err(0x004A));
        assert_eq!(bad.into_result().unwrap_err(), QmiError::ModemNotReady(Some(0x004A)));
        let none = parse(&encode(KIND_RESP, 1, 0x24, &[Tlv::new(0x02, &[0, 0])])).unwrap();
        assert_eq!(none.result(), QmiResult::Missing);
        assert_eq!(none.into_result().unwrap_err(), QmiError::CommandFailed(None));
    }
}
