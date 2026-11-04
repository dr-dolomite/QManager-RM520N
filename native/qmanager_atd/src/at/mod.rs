//! The AT path: the smd11 channel, the executor that serialises exchanges
//! under the modem lock, command classification and the qcmd output contract.

pub mod channel;
pub mod classify;
pub mod exec;
pub mod output;
pub mod qcmap;

use channel::{open_smd, Channel};

const SMD_PATH: &str = "/dev/smd11";

pub(crate) fn new_channel() -> Channel<std::fs::File> {
    Channel::new(Box::new(|| open_smd(SMD_PATH)))
}
